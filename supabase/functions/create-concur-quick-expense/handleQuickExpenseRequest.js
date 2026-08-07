// index.ts（Deno.serveハンドラー）から、Deno固有のAPI（Deno.serve/Deno.env/
// リクエストボディの実際の読み取り・Supabaseクライアントの生成）を切り離した、
// リクエスト処理本体。supabase/functions/ocr-receipt/resolveOcrAuthorization.js
// と同じ「呼び出し元がI/Oを注入する」パターンを踏襲し、method文字列・
// Authorizationヘッダー・リクエストボディを読み取る非同期関数・認証確認用の
// fetchUser/fetchCompanyMembershipだけを受け取ることで、Deno無しに
// Node/vitestから直接テストできる。
//
// 処理順序（認証をmethod確認の直後・本文の読み取りより前に行う理由：
// ocr-receipt/index.tsと同じ「不正な呼び出しに余計な処理をさせない」方針。
// 認証情報の確認自体は本文を必要としないため、先に済ませる）：
//   1. HTTPメソッド確認
//   2. 認証確認（resolveQuickExpenseAuthorization.js）
//      - 未認証 → unauthorized（401）
//      - 認証済みだが所属会社なし → forbidden（403）
//   3. リクエスト本文のJSON解析
//   4. 入力検証（validateQuickExpenseRequest.js）
//   5. 認証済みユーザーが実際に所属する会社（company_code）と、本文で申告
//      された companyId（フロントも一貫してcompany_codeを送る。
//      src/lib/concurRegistrationData.js参照）が一致するかを確認する
//      （フロントから渡された値を認証の根拠にしない。ステップ2で取得済みの
//      membershipをそのまま使うため、DB問い合わせは追加で発生しない）
//      → 不一致なら forbidden（403）
//   6. 経費タイプの検証（verifyExpenseTypeForQuickExpense.js）
//      … フロントから送られたpolicyId・expenseTypeId（＝Concur EXP_KEY）を
//      そのまま信用せず、認証済みユーザーの所属会社が実際に公開している
//      経費タイプ一覧（membership.expenseTypes、公開済みconfig_snapshot由来）
//      に、指定されたexpenseTypeIdが存在し、policyIdが一致し、使用停止で
//      ないことを確認する。さらに、その会社が経費タイプID＝Concur EXP_KEY
//      方式へ移行済みであること（membership.expenseTypeIdMode ===
//      "concur_exp_key"、公開済みconfig_snapshot由来）も確認する。未移行の
//      会社（このコミット時点では全社）は、上記条件を満たしていても拒否する
//      （経費タイプIDがまだ旧Bot内部スラッグのままであり、誤登録につながるため）
//      → 条件を満たさなければ forbidden（403）
//   7. 【安全ゲート】isConcurQuickExpenseEnabled(env)がtrue（Secret
//      CONCUR_QUICK_EXPENSE_ENABLEDが厳密に文字列"true"）の場合だけ、
//      手順8〜11（Vaultリース取得〜Identity検索）を実行する。false（未設定・
//      それ以外の値）の場合はこれらを一切実行せず、そのまま手順12（既存の
//      createQuickExpenseStub呼び出し）へ進む。ゲート判定はindex.tsではなく
//      このファイル1箇所だけで行う（index.tsはCONCUR_QUICK_EXPENSE_ENABLEDの
//      値をenvへ転記するだけで、判断ロジックを持たない）。
//   8. getRefreshTokenForEdge()（get_concur_refresh_token_for_edge RPC相当）で
//      現在のRefresh Token・connection_id・lease_idを取得する（supabase/
//      functions/lookup-concur-user/handleLookupConcurUserRequest.jsと同じ
//      Vaultリース手順）。取得できない場合はconcur_oauth_not_connectedを返す。
//      token endpointへは通信しない。
//   9. refreshConcurAccessToken()でtoken endpointへRefresh Token Grantを実行する。
//      失敗した場合：completeOAuthRefresh({success:false, errorCode})でリースを
//      解放し（ベストエフォート）、Concur側最終呼び出し・Identity APIへは進まない。
//  10. 成功した場合：completeOAuthRefresh({success:true, newRefreshToken})を
//      呼ぶ。falseが返れば（lease不一致）concur_oauth_completion_failedを、
//      例外が発生すれば（Vault更新自体が失敗）concur_oauth_storage_failedを
//      返し、いずれもConcur側最終呼び出し・Identity APIへは進まない。
//  11. ここまでで「Refresh Tokenの保存成功」が確定した場合にのみ、
//      lookupConcurUser()（_shared/concur-identity、lookup-concur-userと
//      同じ共有モジュール）でConcurログインID（concurLoginId）から
//      userIDを解決する。lookup-concur-user Edge Function自体はHTTP経由で
//      呼び出さない（認証情報を余計に経由させないため、共有モジュールを
//      直接呼ぶ）。解決したuserIDはこの関数のローカル変数としてのみ存在し、
//      DB・Vault・Secrets・レスポンス・ログのいずれにも出さない。
//      0件・複数件・401/403・timeout等の場合はconcur_user_not_found等の
//      既存の固定エラーコードを返し、Concur側最終呼び出しへは進まない。
//  12. Concur側の最終呼び出し。DI優先順位は
//      (1) createQuickExpenseが明示的に渡された場合はそれを使う（テスト用）
//      (2) 明示DIが無く、ゲートON（手順7）の場合はcreateQuickExpenseViaConcur.js
//          （accessToken・geolocation・userIdを実際に使う）
//      (3) 明示DIが無く、ゲートOFFの場合はcreateQuickExpenseStub.js
//          （contextを一切参照しない安全なスタブ応答）
//      の順。ただし「Vault/OAuth/Identityパイプラインを実行するかどうか」
//      （手順7）自体はこのDI優先順位とは無関係に、常にisConcurQuickExpenseEnabled(env)
//      だけで独立に判定する（明示DIがあってもゲートOFFならパイプラインは動かない）。
//  13. 成功結果を返す
//
// companyIdの値空間について（重要）：
//   membership.company_code・本文のcompanyIdは、いずれも
//   companies.company_code（人が識別するためのスラッグ）であり、
//   company_members.company_id（Supabase内部UUID）ではない。
//   fetchCompanyMembership()がこのcompany_codeをどう解決するかは
//   index.ts・resolveMembershipFromPublicConfigRow.js参照。
//
// このEdge Functionが返しうるエラーコード：
//   - method_not_allowed        … POST以外のメソッド
//   - unauthorized              … Authorizationヘッダーが無い、または
//                                  Supabaseユーザーとして解決できない
//                                  （トークンが不正・期限切れ等）
//   - forbidden                 … 認証は成功したが、所属会社が無い、または
//                                  本文のcompanyIdが実際の所属と一致しない
//   - invalid_json              … リクエストボディがJSONとして解析できない
//   - validation_error          … 必須項目の不足・型/形式の不正
//                                  （validateQuickExpenseRequest.js参照）
//   - expense_type_not_found    … expenseTypeId・policyIdの組み合わせが、
//                                  所属会社の公開済み経費タイプ一覧に存在
//                                  しない、またはpolicyIdが一致しない、
//                                  または使用停止の経費タイプである
//   - internal_error            … 上記以外の予期しない例外
//   - concur_not_configured     … 必須Secrets（Client ID/Secret/Token URL）不足
//   - concur_oauth_timeout            … token endpointのタイムアウト
//   - concur_oauth_network_error      … token endpointへの通信失敗
//   - concur_oauth_rejected           … 認証情報・Refresh Tokenが拒否された
//   - concur_oauth_rate_limited       … token endpointが429
//   - concur_oauth_service_error      … token endpointが5xx
//   - concur_oauth_invalid_response   … token endpointの応答形式が不正
//   - concur_oauth_not_connected      … 対象接続が無い、またはロック中
//   - concur_oauth_completion_failed  … 完了RPCがfalse（lease不一致）
//   - concur_oauth_storage_failed     … 完了RPCが例外（Vault更新自体が失敗）
//   - concur_identity_geolocation_missing … token応答にgeolocationが無い
//   - concur_user_not_found           … ConcurログインIDの検索結果0件
//   - concur_user_ambiguous           … ConcurログインIDの検索結果複数件
//   - concur_identity_invalid_response … Identity API応答の形式が不正・userID欠落
//   - concur_identity_rejected        … Identity APIが401/403
//   - concur_identity_rate_limited    … Identity APIが429
//   - concur_identity_service_error   … Identity APIが5xx
//   - concur_identity_timeout         … Identity APIのタイムアウト
//   - concur_identity_network_error   … Identity APIへの通信失敗
//   （上記のOAuth／Identity系コードは、supabase/functions/lookup-concur-user/
//   handleLookupConcurUserRequest.jsが返しうるコードと同じ意味・同じ固定
//   メッセージを使う。実際の{code,message}生成は_shared/concur-oauth/
//   classifyConcurOAuthError.js・_shared/concur-identity/
//   classifyConcurIdentityLookupError.jsに委ね、このFunctionはHTTP
//   ステータスへの対応表（buildQuickExpenseUpstreamErrorResponse.js）だけを持つ）
//
// 戻り値は { status, body } で、呼び出し元（index.ts）はこれをそのまま
// new Response(JSON.stringify(body), { status, headers: corsHeaders }) へ
// 渡すだけでよい。bodyは常に { result, error } の形（成功時はerror: null、
// 失敗時はresult: null）。
import { validateQuickExpenseRequest } from "./validateQuickExpenseRequest.js";
import { createQuickExpenseStub } from "./createQuickExpenseStub.js";
import { createQuickExpenseViaConcur } from "./createQuickExpenseViaConcur.js";
import { isConcurQuickExpenseEnabled } from "./isConcurQuickExpenseEnabled.js";
import { resolveQuickExpenseAuthorization } from "./resolveQuickExpenseAuthorization.js";
import { verifyExpenseTypeForQuickExpense } from "./verifyExpenseTypeForQuickExpense.js";
import { buildQuickExpenseUpstreamErrorResponse } from "./buildQuickExpenseUpstreamErrorResponse.js";
import { refreshConcurAccessToken } from "../_shared/concur-oauth/refreshConcurAccessToken.js";
import { lookupConcurUser } from "../_shared/concur-identity/lookupConcurUser.js";

function errorBody(code, message, details = []) {
  return { result: null, error: { code, message, details } };
}

const UNAUTHORIZED_MESSAGE = "ログインの有効期限が切れている可能性があります。再度ログインしてください。";
const FORBIDDEN_MESSAGE = "この操作を行う権限がありません。";

// OAuth失敗時・予期しない例外時にリースを解放するためのベストエフォート呼び出し。
// supabase/functions/lookup-concur-user/handleLookupConcurUserRequest.jsの
// safeCompleteFailure()と全く同じ考え方（ここでの二次的な失敗は、
// lock_expires_atの期限切れによる自己修復に委ねる）。
async function safeCompleteFailure(completeOAuthRefresh, connectionId, leaseId, errorCode) {
  if (!completeOAuthRefresh) {
    return;
  }
  try {
    await completeOAuthRefresh({ connectionId, leaseId, success: false, newRefreshToken: null, errorCode });
  } catch {
    // ベストエフォート。詳細は握りつぶす。
  }
}

/**
 * @param {object} input
 * @param {string} input.method リクエストのHTTPメソッド（req.method）。
 * @param {string|null} input.authHeader リクエストのAuthorizationヘッダーの値
 *   （Denoでは req.headers.get("authorization")）。
 * @param {() => Promise<unknown>} input.parseBody リクエストボディをJSONとして
 *   読み取る非同期関数（Denoでは () => req.json()）。JSONとして解析できない
 *   場合は例外を投げる想定。
 * @param {(authHeader: string) => Promise<object|null>} input.fetchUser
 *   Authorizationヘッダーから呼び出し元ユーザーを解決する関数
 *   （Denoでは supabase.auth.getUser() 経由。解決できない場合はnullを返す想定）。
 * @param {(user: object) => Promise<{ company_code: string, role: string, expenseTypes: Array }|null>} input.fetchCompanyMembership
 *   解決したユーザーの所属会社（company_code。Supabase内部UUIDではない。
 *   index.ts参照）・role・所属会社が公開している経費タイプ一覧
 *   （expenseTypes。無ければ空配列）を取得する関数。未所属ならnull。
 * @param {typeof resolveQuickExpenseAuthorization} [input.resolveAuthorization]
 *   認証・所属確認のロジック本体。既定はresolveQuickExpenseAuthorization
 *   （実運用の呼び出し元・index.tsは指定不要。テストでの差し替え用）。
 * @param {(payload: unknown, context: { accessToken: string, geolocation: string, userId: string }|undefined) => Promise<{ result: object|null, error: object|null }>} [input.createQuickExpense]
 *   Concur側の最終呼び出し。明示的に渡された場合は常にそれを使う（テスト用の
 *   差し替え）。省略した場合は、isConcurQuickExpenseEnabled(env)がtrueなら
 *   createQuickExpenseViaConcur（実際にConcur Quick Expense API・OAuth・
 *   Identity APIへ通信する）、falseならcreateQuickExpenseStub（contextを
 *   一切参照しない安全なスタブ応答）を内部で自動的に選ぶ。index.tsは
 *   この選択に一切関与しない（ファイル冒頭コメント・最終報告参照）。
 * @param {Record<string, string|undefined>} [input.env] CONCUR_CLIENT_ID等のSecret名をキーとした値の集合。
 * @param {string|null} [input.companyId] 対象会社（現時点では常にnull＝既定接続）。
 * @param {(input: { companyId: string|null }) => Promise<{ connectionId: string, leaseId: string, refreshToken: string } | null>} [input.getRefreshTokenForEdge]
 * @param {(input: { connectionId: string, leaseId: string, success: boolean, newRefreshToken: string|null, errorCode: string|null }) => Promise<boolean>} [input.completeOAuthRefresh]
 * @param {typeof refreshConcurAccessToken} [input.refreshAccessToken]
 * @param {typeof lookupConcurUser} [input.lookupUser]
 * @param {typeof fetch} [input.fetchImpl] テスト用の差し替え（refreshAccessToken・lookupUserへ素通しする）。
 * @returns {Promise<{ status: number, body: { result: object|null, error: object|null } }>}
 */
export async function handleQuickExpenseRequest({
  method,
  authHeader,
  parseBody,
  fetchUser,
  fetchCompanyMembership,
  resolveAuthorization = resolveQuickExpenseAuthorization,
  createQuickExpense,
  env,
  companyId = null,
  getRefreshTokenForEdge,
  completeOAuthRefresh,
  refreshAccessToken = refreshConcurAccessToken,
  lookupUser = lookupConcurUser,
  fetchImpl,
}) {
  if (method !== "POST") {
    return { status: 405, body: errorBody("method_not_allowed", "許可されていないメソッドです。") };
  }

  const authResult = await resolveAuthorization({ authHeader, fetchUser, fetchCompanyMembership });

  if (authResult.outcome === "unauthorized") {
    return { status: 401, body: errorBody("unauthorized", UNAUTHORIZED_MESSAGE) };
  }

  if (authResult.outcome === "forbidden") {
    return { status: 403, body: errorBody("forbidden", FORBIDDEN_MESSAGE) };
  }

  let rawBody;
  try {
    rawBody = await parseBody();
  } catch {
    // リクエスト本文自体はログへ出さない（機密情報・個人情報を含みうるため）。
    return { status: 400, body: errorBody("invalid_json", "リクエストの形式が不正です。") };
  }

  const { result: validated, error: validationError } = validateQuickExpenseRequest(rawBody);
  if (validationError) {
    return { status: 400, body: { result: null, error: validationError } };
  }

  // 認証済みユーザーが実際に所属する会社（ステップ2で取得済みのmembership、
  // company_code）と、本文で申告されたcompanyId（同じくcompany_code。
  // ファイル冒頭コメント参照）が一致するかを確認する。フロントから渡された
  // companyIdだけを信用して処理を進めない（要件：フロントの値を認証根拠に
  // 使わない）。
  if (authResult.membership.company_code !== validated.companyId) {
    return { status: 403, body: errorBody("forbidden", FORBIDDEN_MESSAGE) };
  }

  // フロントから送られたpolicyId・expenseTypeId（＝Concur EXP_KEY）を
  // そのまま信用せず、所属会社が実際に公開している経費タイプ一覧に、
  // 指定された組み合わせが実在するかを確認する（要件：フロントの値を認証・
  // 実行の根拠にしない）。エラー本文には経費タイプ一覧やconfig_snapshotを
  // 一切含めない（固定のメッセージ・理由を区別しないcodeのみ）。
  const expenseTypeCheck = verifyExpenseTypeForQuickExpense({
    expenseTypeIdMode: authResult.membership.expenseTypeIdMode,
    expenseTypes: authResult.membership.expenseTypes,
    expenseTypeId: validated.expenseTypeId,
    policyId: validated.policyId,
  });

  if (!expenseTypeCheck.valid) {
    return { status: 403, body: errorBody("expense_type_not_found", FORBIDDEN_MESSAGE) };
  }

  // 【安全ゲート】isConcurQuickExpenseEnabled(env)がtrueの場合だけ、Vault
  // リース取得〜Identity検索（supabase/functions/lookup-concur-user/
  // handleLookupConcurUserRequest.jsと全く同じ手順・同じ安全設計。
  // fail-closed、保存成功確定後にのみ次へ進む）を実行する。falseの場合は
  // このifブロック自体に一切入らず、getRefreshTokenForEdge・
  // refreshAccessToken・completeOAuthRefresh・lookupUserのいずれも呼ばれない
  // （＝Token endpoint・Identity APIへの実通信が発生しない）。この判定は、
  // 下のcreateQuickExpenseのDI優先順位（明示DIの有無）とは完全に独立している。
  let context;
  if (isConcurQuickExpenseEnabled(env)) {
    let lease = null;
    try {
      lease = await getRefreshTokenForEdge({ companyId });
    } catch {
      return { status: 500, body: errorBody("internal_error", "処理中にエラーが発生しました。") };
    }

    if (!lease || !lease.refreshToken || !lease.connectionId || !lease.leaseId) {
      return { status: 503, body: errorBody("concur_oauth_not_connected", "現在Concurとの接続情報を利用できません。") };
    }

    const { connectionId, leaseId, refreshToken } = lease;

    let oauthResult;
    try {
      oauthResult = await refreshAccessToken({ env, refreshToken, fetchImpl });
    } catch {
      await safeCompleteFailure(completeOAuthRefresh, connectionId, leaseId, "internal_error");
      return { status: 500, body: errorBody("internal_error", "処理中にエラーが発生しました。") };
    }

    if (!oauthResult.ok) {
      await safeCompleteFailure(completeOAuthRefresh, connectionId, leaseId, oauthResult.error.code);
      return buildQuickExpenseUpstreamErrorResponse(oauthResult.error);
    }

    const newRefreshToken = oauthResult.rotated ? oauthResult.tokens.refreshToken : null;

    let completeOk = false;
    try {
      completeOk = await completeOAuthRefresh({ connectionId, leaseId, success: true, newRefreshToken, errorCode: null });
    } catch {
      // Vault更新自体が失敗した場合。新しいRefresh Tokenはここで破棄され、
      // これ以降どこにも保存されない。成功として扱わず、Identity API・
      // Concur側最終呼び出しへは進まない。
      return { status: 500, body: errorBody("concur_oauth_storage_failed", "認証情報の保存に失敗しました。もう一度お試しください。") };
    }

    if (!completeOk) {
      // connection_id・lease_idの組み合わせが現在のリースと一致しなかった。
      // Vaultへは書き込まれていないため、Identity API・Concur側最終呼び出しへは進まない。
      return { status: 500, body: errorBody("concur_oauth_completion_failed", "処理を確定できませんでした。もう一度お試しください。") };
    }

    // ここまでで「Refresh Tokenの保存成功」が確定した場合にのみ、Identity APIへ進む。
    const { accessToken, geolocation } = oauthResult.tokens;

    let lookupResult;
    try {
      lookupResult = await lookupUser({ geolocation, accessToken, userName: validated.concurLoginId, fetchImpl });
    } catch {
      return { status: 500, body: errorBody("internal_error", "処理中にエラーが発生しました。") };
    }

    if (!lookupResult.ok) {
      return buildQuickExpenseUpstreamErrorResponse(lookupResult.error);
    }

    // Identity APIで解決したuserIDはこの関数のローカル変数（context経由）
    // としてのみ存在し、DB・Vault・Secrets・レスポンス・ログのいずれにも
    // 出さない（createQuickExpense()への引数としてのみ渡し、処理終了と
    // ともに破棄される）。
    context = { accessToken, geolocation, userId: lookupResult.userId };
  }

  // DI優先順位：(1)明示的に渡されたcreateQuickExpense（テスト用）
  // (2)明示DIが無くゲートON→createQuickExpenseViaConcur
  // (3)明示DIが無くゲートOFF→createQuickExpenseStub。
  // ゲート判定自体は上のifブロックで既に完結しており、ここでの
  // isConcurQuickExpenseEnabled(env)の再評価は「どちらの既定実装を使うか」
  // だけを決める（パイプラインを再実行するわけではない）。
  const resolvedCreateQuickExpense =
    createQuickExpense ?? (isConcurQuickExpenseEnabled(env) ? createQuickExpenseViaConcur : createQuickExpenseStub);

  let stubResult;
  try {
    stubResult = await resolvedCreateQuickExpense(validated, context);
  } catch {
    // 例外の詳細（メッセージ・スタック）はログへも本文へも出さない。
    return { status: 500, body: errorBody("internal_error", "処理中にエラーが発生しました。") };
  }

  if (stubResult?.error) {
    return {
      status: 500,
      body: errorBody(
        stubResult.error.code ?? "internal_error",
        stubResult.error.message ?? "処理中にエラーが発生しました。",
        stubResult.error.details ?? [],
      ),
    };
  }

  return { status: 200, body: { result: stubResult?.result ?? null, error: null } };
}
