// index.ts（Deno.serveハンドラー）から、Deno固有のAPI（Deno.serve/Deno.env/
// リクエストボディの実際の読み取り・Supabaseクライアントの生成）を切り離した、
// リクエスト処理本体。supabase/functions/ocr-receipt/resolveOcrAuthorization.js
// と同じ「呼び出し元がI/Oを注入する」パターンを踏襲し、method文字列・
// Authorizationヘッダー・リクエストボディを読み取る非同期関数・認証確認用の
// fetchUser/fetchCompanyMembershipだけを受け取ることで、Deno無しに
// Node/vitestから直接テストできる。
//
// 処理順序（【複数社所属対応・Commit 1で変更】以前は「認証確認（本人確認＋
// 所属会社の解決）→本文解析」の順だったが、1ユーザーが複数の会社へ所属できる
// ようになったため、「どの会社への所属を確認するか」は本文のcompanyIdが
// 分からないと決められない。そのため、本人確認（fetchUser）だけは従来どおり
// 本文の読み取りより前に行い（ocr-receipt/index.tsと同じ「不正な呼び出しに
// 余計な処理をさせない」方針を、認証ヘッダーの検証部分についてだけ維持する）、
// 会社所属の確認は本文検証の後に、本文が申告するcompanyIdをそのまま
// fetchCompanyMembershipへ渡して行う）：
//   1. HTTPメソッド確認
//   2. 本人確認（resolveQuickExpenseAuthorization.js）
//      - 未認証 → unauthorized（401）。ここでは所属会社の判定は行わない。
//   3. リクエスト本文のJSON解析
//   4. 入力検証（validateQuickExpenseRequest.js）
//   5. 本文で申告されたcompanyId（company_code）について、認証済みユーザーが
//      実際にその会社へ所属しているかをfetchCompanyMembership(user, companyId)
//      で確認する（フロントから渡された値を無条件に信用しない。
//      サーバー側でauth.uid()とcompanyIdの両方に一致するcompany_members行が
//      存在する場合にのみmembershipを取得する設計。index.ts・
//      resolveMembershipFromPublicConfigRow.js参照）。所属していなければ
//      forbidden（403）。以前あった「resolveAuthorizationが返した
//      membership.company_codeと本文のcompanyIdが一致するか」という別々に
//      解決した2値を比較するチェックは廃止した（fetchCompanyMembership自体が
//      companyIdで絞り込むため、返ってきたmembershipは必ずその会社のものであり、
//      比較の必要が無い。むしろ「双方が別々にdata[0]的な解決をして偶然一致する」
//      という設計を避けるためにこの形にした）。
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
//      【重要・会社境界（複数社対応・設計レビューにより最終決定）】ここで渡す
//      companyId（Vault接続の識別子。concur_oauth_connections.company_id）は、
//      resolveOAuthCompanyId({ userId, companyCode })（service_role専用の
//      resolve_concur_oauth_company_id RPC相当。supabase/schema.sql参照）が、
//      authResult.user.id（手順2で検証済み）とvalidated.companyId（手順5で
//      所属確認済みのcompany_code）から解決したcompanies.idだけを使う。
//      クライアントがcompany UUIDを送ってくる経路は無い（リクエストスキーマに
//      そのようなフィールドは存在しない。validateQuickExpenseRequest.js
//      参照）ため、信用できるのはこの解決結果以外にない。
//      【設計レビューの経緯】当初はget_my_public_config(p_company_code)の
//      戻り値へcompany_id列を追加し、fetchCompanyMembershipが返す
//      membership.company_idを使う案を検討したが、利用者向けの汎用RPCへ
//      Edge Function内部専用の値を持ち込むべきではないと判断し、
//      resolveOAuthCompanyId（service_role専用の別RPC呼び出し。ブラウザから
//      直接呼び出す経路が無い）へ分離した（get_my_public_configは無変更）。
//      以前はcompanyIdを解決する手段自体が無く、常にnull（＝既定接続）を
//      渡していたため、複数社対応後は「A社のリクエストなのにB社（または
//      共有の既定接続）のConcur OAuth接続を使ってしまう」cross-company混在
//      のリスクがあった。resolveOAuthCompanyId()の呼び出しは安全ゲート
//      （手順7）の内側で行う（ゲートOFFなら呼ばれない）。解決できない場合
//      （未所属・存在しない会社・本番未適用でRPC自体が無い場合を含む）は、
//      既定接続へフォールバックせずfail-closedでconcur_oauth_not_connected
//      を返す（Vaultリース取得自体を行わない）。
//   9. refreshConcurAccessToken()でtoken endpointへRefresh Token Grantを実行する。
//      失敗した場合：completeOAuthRefresh({success:false, errorCode})でリースを
//      解放し（ベストエフォート）、Concur側最終呼び出し・Identity APIへは進まない。
//  10. 成功した場合：completeOAuthRefresh({success:true, newRefreshToken})を
//      呼ぶ。falseが返れば（lease不一致）concur_oauth_completion_failedを、
//      例外が発生すれば（Vault更新自体が失敗）concur_oauth_storage_failedを
//      返し、いずれもConcur側最終呼び出し・Identity APIへは進まない。
//  11. ここまでで「Refresh Tokenの保存成功」が確定した場合にのみ、
//      【Phase 13で変更】getConcurUserLink({ userId, companyId })
//      （service_role専用RPC get_concur_user_link_for_edge。supabase/
//      schema.sql参照）で、link-concur-user Edge Functionが事前にIdentity
//      APIで実在確認・保存したConcurログインIDを取得する。クライアントは
//      もうconcurLoginIdを送ってこない（validateQuickExpenseRequest.js
//      からこのフィールド自体を削除済み）。未紐付け（該当行が無い）の場合は
//      既定接続的なフォールバックをせずfail-closedでconcur_user_link_
//      not_foundを返し、Identity APIへは進まない。
//      取得できた場合にのみ、lookupConcurUser()（_shared/concur-identity、
//      lookup-concur-userと同じ共有モジュール）でそのConcurログインIDから
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
// companyIdの値空間について（重要・2種類のcompanyIdを混同しないこと）：
//   本文のcompanyId・fetchCompanyMembershipが返すmembership.company_codeは、
//   いずれもcompanies.company_code（人が識別するためのスラッグ）であり、
//   company_members.company_id（Supabase内部UUID）ではない。
//   fetchCompanyMembership(user, companyId)がこのcompany_codeをどう解決するかは
//   index.ts・resolveMembershipFromPublicConfigRow.js参照（複数社所属対応後は
//   get_my_public_config(p_company_code)へcompanyIdをそのまま渡し、
//   auth.uid()とcompanyIdの両方に一致する所属だけを解決する）。
//   get_my_public_config()はこの所属確認・経費タイプ検証専用の責務のみを持ち、
//   company UUIDは一切返さない（設計レビューにより、Vault会社境界解決とは
//   明確に分離した。下記resolveOAuthCompanyId参照）。
//
//   一方、getRefreshTokenForEdge()へ渡すcompanyId（Vault接続の識別子。
//   concur_oauth_connections.company_id）は全く別の値空間で、
//   companies.id（Supabase内部UUID）そのもの。この値はクライアントから
//   受け取らず、またmembership（fetchCompanyMembershipの戻り値）からも
//   取り出さない。必ずresolveOAuthCompanyId({ userId, companyCode })
//   （service_role専用のresolve_concur_oauth_company_id RPC。
//   supabase/schema.sql参照）を、authResult.user.id（fetchUserで検証済み）と
//   validated.companyId（company_code）で呼び出し、その戻り値だけを使う
//   （外部から渡せる入力パラメータとしてのcompanyIdはこの関数には存在せず、
//   常にこのRPC呼び出し結果からのみ得られる）。
//
// このEdge Functionが返しうるエラーコード：
//   - method_not_allowed        … POST以外のメソッド
//   - unauthorized              … Authorizationヘッダーが無い、または
//                                  Supabaseユーザーとして解決できない
//                                  （トークンが不正・期限切れ等）
//   - forbidden                 … 認証は成功したが、本文のcompanyIdで指定された
//                                  会社への所属が確認できない（未所属・
//                                  存在しない会社・所属確認自体の失敗を含む）
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
//   - concur_user_link_not_found      … 【Phase 13で追加】保存済みのConcur
//                                        ログインID紐付け（concur_user_links）
//                                        が無い（link-concur-userで先に
//                                        紐付けを完了する必要がある）
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
 * @param {(user: object, companyCode: string) => Promise<{ company_code: string, role: string, expenseTypes: Array, expenseTypeIdMode: string|null }|null>} input.fetchCompanyMembership
 *   【複数社所属対応・Commit 1で変更】本文検証後に呼ばれる（本文のcompanyId
 *   （company_code）が確定してから呼ぶ必要があるため）。解決したuserが
 *   companyCodeで指定された会社へ実際に所属している場合だけmembership
 *   （company_code・role・所属会社が公開している経費タイプ一覧expenseTypes・
 *   expenseTypeIdMode）を返す。所属していなければnull。company UUIDは
 *   含まない（get_my_public_config()は所属確認・経費タイプ検証専用の責務の
 *   ため。Vault会社境界の解決はresolveOAuthCompanyId参照）。
 * @param {typeof resolveQuickExpenseAuthorization} [input.resolveAuthorization]
 *   本人確認（fetchUserのみ）のロジック本体。既定はresolveQuickExpenseAuthorization
 *   （実運用の呼び出し元・index.tsは指定不要。テストでの差し替え用）。
 *   【複数社所属対応・Commit 1で変更】以前はここで所属会社の解決も行っていたが、
 *   companyIdが本文検証後にしか分からないため、この関数の責務からは外した
 *   （resolveQuickExpenseAuthorization.js参照）。
 * @param {(payload: unknown, context: { accessToken: string, geolocation: string, userId: string }|undefined) => Promise<{ result: object|null, error: object|null }>} [input.createQuickExpense]
 *   Concur側の最終呼び出し。明示的に渡された場合は常にそれを使う（テスト用の
 *   差し替え）。省略した場合は、isConcurQuickExpenseEnabled(env)がtrueなら
 *   createQuickExpenseViaConcur（実際にConcur Quick Expense API・OAuth・
 *   Identity APIへ通信する）、falseならcreateQuickExpenseStub（contextを
 *   一切参照しない安全なスタブ応答）を内部で自動的に選ぶ。index.tsは
 *   この選択に一切関与しない（ファイル冒頭コメント・最終報告参照）。
 * @param {Record<string, string|undefined>} [input.env] CONCUR_CLIENT_ID等のSecret名をキーとした値の集合。
 * @param {(input: { userId: string, companyCode: string }) => Promise<string|null>} [input.resolveOAuthCompanyId]
 *   Concur OAuth Vault接続の会社境界（concur_oauth_connections.company_id）を
 *   解決する、service_role専用RPC（resolve_concur_oauth_company_id。
 *   supabase/schema.sql参照）の呼び出し。安全ゲート（isConcurQuickExpenseEnabled）
 *   がtrueの場合だけ呼ばれる。userIdはauthResult.user.id（fetchUserで検証
 *   済み）、companyCodeはvalidated.companyId（手順5で所属確認済み）を渡す。
 *   対象の所属が無ければnullを返す想定（RPC自体が0行→NULLを返す設計）。
 *   この関数の外部入力パラメータとしてのcompanyId（Vault接続識別子そのもの）は
 *   存在しない（以前は呼び出し元がcompanyIdを直接渡せたが、常にnull固定で
 *   呼ばれており、複数社対応後にcross-company接続混在のリスクがあったため
 *   廃止した）。常にこの関数の戻り値だけをgetRefreshTokenForEdgeへ渡す。
 * @param {(input: { companyId: string|null }) => Promise<{ connectionId: string, leaseId: string, refreshToken: string } | null>} [input.getRefreshTokenForEdge]
 * @param {(input: { connectionId: string, leaseId: string, success: boolean, newRefreshToken: string|null, errorCode: string|null }) => Promise<boolean>} [input.completeOAuthRefresh]
 * @param {(input: { userId: string, companyId: string }) => Promise<string|null>} [input.getConcurUserLink]
 *   【Phase 13で追加】link-concur-user Edge Functionが事前にIdentity APIで
 *   実在確認・保存したConcurログインIDを取得する、service_role専用RPC
 *   （get_concur_user_link_for_edge。supabase/schema.sql参照）の呼び出し。
 *   安全ゲートがtrueの場合だけ呼ばれる。userIdはauthResult.user.id
 *   （手順2で検証済み）、companyIdはresolveOAuthCompanyIdが解決した
 *   companies.idを渡す。該当行が無ければnullを返す想定（既定接続への
 *   フォールバックはしない）。
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
  resolveOAuthCompanyId,
  getRefreshTokenForEdge,
  completeOAuthRefresh,
  getConcurUserLink,
  refreshAccessToken = refreshConcurAccessToken,
  lookupUser = lookupConcurUser,
  fetchImpl,
}) {
  if (method !== "POST") {
    return { status: 405, body: errorBody("method_not_allowed", "許可されていないメソッドです。") };
  }

  const authResult = await resolveAuthorization({ authHeader, fetchUser });

  if (authResult.outcome === "unauthorized") {
    return { status: 401, body: errorBody("unauthorized", UNAUTHORIZED_MESSAGE) };
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

  // 【複数社所属対応・Commit 1で変更】本文で申告されたcompanyId（company_code）を
  // そのままfetchCompanyMembershipへ渡し、「認証済みユーザーが実際にこの会社へ
  // 所属しているか」をここで初めてサーバー側に確認させる（フロントから渡された
  // companyIdだけを信用して処理を進めない）。fetchCompanyMembershipはuser_id・
  // companyIdの両方に一致するcompany_members行が存在する場合にのみ非nullの
  // membershipを返す設計のため（index.ts参照）、返ってきたmembershipは必ず
  // validated.companyIdそのものの所属情報であり、追加の一致確認は不要になった
  // （フロントとバックエンドがそれぞれ別々に「先頭の所属」を解決し、たまたま
  // 一致したから通る、という設計を避けるため）。
  let membership;
  try {
    membership = await fetchCompanyMembership(authResult.user, validated.companyId);
  } catch {
    // 所属確認自体が失敗した場合（DB接続エラー等）は、安全側に倒して
    // 「所属なし」と同じforbidden扱いにする（fail-closed）。
    return { status: 403, body: errorBody("forbidden", FORBIDDEN_MESSAGE) };
  }

  if (!membership) {
    return { status: 403, body: errorBody("forbidden", FORBIDDEN_MESSAGE) };
  }

  // フロントから送られたpolicyId・expenseTypeId（＝Concur EXP_KEY）を
  // そのまま信用せず、validated.companyId（＝上で所属確認済みの会社）が
  // 実際に公開している経費タイプ一覧に、指定された組み合わせが実在するかを
  // 確認する（要件：フロントの値を認証・実行の根拠にしない）。エラー本文には
  // 経費タイプ一覧やconfig_snapshotを一切含めない（固定のメッセージ・理由を
  // 区別しないcodeのみ）。他社（validated.companyId以外）のconfig_snapshotは
  // ここでも一切参照しない（membership自体がvalidated.companyIdだけに
  // 絞り込まれているため、cross-company参照は構造上発生し得ない）。
  const expenseTypeCheck = verifyExpenseTypeForQuickExpense({
    expenseTypeIdMode: membership.expenseTypeIdMode,
    expenseTypes: membership.expenseTypes,
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
    // 会社境界（重要）：Vaultから取得するRefresh Tokenの対象会社は、必ず
    // resolveOAuthCompanyId({ userId, companyCode })（service_role専用の
    // resolve_concur_oauth_company_id RPC相当）が、authResult.user.id
    // （手順2で検証済み）とvalidated.companyId（手順5で所属確認済みの
    // company_code）から解決したcompanies.idだけを使う。クライアントは
    // company UUIDを一切送ってこない（リクエストスキーマにそのような
    // フィールドは存在しない。validateQuickExpenseRequest.js参照）ため、
    // ここで信用できるのはこのRPCの解決結果以外にない。get_my_public_config
    // 経由のmembershipオブジェクトはcompany UUIDを持たない（設計レビューに
    // より、利用者向けRPCとVault会社境界解決の責務を分離したため）。
    // 未解決（未所属・存在しない会社・本番未適用でRPC自体が無い場合を含む）
    // の場合は、既定接続（company_id IS NULLの共有接続）へフォールバックせず、
    // Vaultリース取得自体を行わずfail-closedにする（他社・既定接続の
    // Refresh Tokenを誤って使う経路を構造的に無くす）。
    let vaultCompanyId = null;
    try {
      vaultCompanyId = await resolveOAuthCompanyId({ userId: authResult.user.id, companyCode: validated.companyId });
    } catch {
      return { status: 500, body: errorBody("internal_error", "処理中にエラーが発生しました。") };
    }

    if (typeof vaultCompanyId !== "string" || vaultCompanyId.trim() === "") {
      return { status: 503, body: errorBody("concur_oauth_not_connected", "現在Concurとの接続情報を利用できません。") };
    }

    let lease = null;
    try {
      lease = await getRefreshTokenForEdge({ companyId: vaultCompanyId });
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

    // 【Phase 13で変更】ConcurログインIDはもうクライアントから受け取らない
    // （validateQuickExpenseRequest.jsからconcurLoginIdフィールド自体を削除
    // 済み）。代わりに、link-concur-user Edge Functionが事前にIdentity APIで
    // 実在確認・保存したConcurログインIDを、user_id×company_id単位で
    // getConcurUserLink()（service_role専用RPC get_concur_user_link_for_edge）
    // から取得する。未紐付け（該当行が無い）の場合は、既定接続的なフォール
    // バックをせずfail-closedでconcur_user_link_not_foundを返す（Identity API
    // へは一切進まない）。
    let linkedConcurLoginId = null;
    try {
      linkedConcurLoginId = await getConcurUserLink({ userId: authResult.user.id, companyId: vaultCompanyId });
    } catch {
      return { status: 500, body: errorBody("internal_error", "処理中にエラーが発生しました。") };
    }

    if (typeof linkedConcurLoginId !== "string" || linkedConcurLoginId.trim() === "") {
      return {
        status: 503,
        body: errorBody("concur_user_link_not_found", "Concurアカウントとの紐付けが必要です。"),
      };
    }

    let lookupResult;
    try {
      lookupResult = await lookupUser({ geolocation, accessToken, userName: linkedConcurLoginId, fetchImpl });
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
