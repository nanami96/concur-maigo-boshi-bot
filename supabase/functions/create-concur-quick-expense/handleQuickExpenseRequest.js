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
//   6. Concur側スタブ処理の呼び出し
//   7. 成功結果を返す
//
// companyIdの値空間について（重要）：
//   membership.company_code・本文のcompanyIdは、いずれも
//   companies.company_code（人が識別するためのスラッグ）であり、
//   company_members.company_id（Supabase内部UUID）ではない。
//   fetchCompanyMembership()がこのcompany_codeをどう解決するかは
//   index.ts・resolveMembershipFromPublicConfigRow.js参照。
//
// このEdge Functionが返しうるエラーコード：
//   - method_not_allowed      … POST以外のメソッド
//   - unauthorized            … Authorizationヘッダーが無い、またはSupabase
//                                ユーザーとして解決できない（トークンが不正・
//                                期限切れ等）
//   - forbidden               … 認証は成功したが、所属会社が無い、または
//                                本文のcompanyIdが実際の所属と一致しない
//   - invalid_json            … リクエストボディがJSONとして解析できない
//   - validation_error        … 必須項目の不足・型/形式の不正
//                                （validateQuickExpenseRequest.js参照）
//   - internal_error          … 上記以外の予期しない例外
//   - concur_not_configured   … 【予約済み・現時点では未使用】実際にConcurへ
//                                接続するようになった際、Concur側の認証情報
//                                が利用できない場合に使うためのコード
//                                （createQuickExpenseStub.js参照）。
//
// 戻り値は { status, body } で、呼び出し元（index.ts）はこれをそのまま
// new Response(JSON.stringify(body), { status, headers: corsHeaders }) へ
// 渡すだけでよい。bodyは常に { result, error } の形（成功時はerror: null、
// 失敗時はresult: null）。
import { validateQuickExpenseRequest } from "./validateQuickExpenseRequest.js";
import { createQuickExpenseStub } from "./createQuickExpenseStub.js";
import { resolveQuickExpenseAuthorization } from "./resolveQuickExpenseAuthorization.js";

function errorBody(code, message, details = []) {
  return { result: null, error: { code, message, details } };
}

const UNAUTHORIZED_MESSAGE = "ログインの有効期限が切れている可能性があります。再度ログインしてください。";
const FORBIDDEN_MESSAGE = "この操作を行う権限がありません。";

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
 * @param {(user: object) => Promise<{ company_code: string, role: string }|null>} input.fetchCompanyMembership
 *   解決したユーザーの所属会社（company_code。Supabase内部UUIDではない。
 *   index.ts参照）とroleを取得する関数。未所属ならnull。
 * @param {typeof resolveQuickExpenseAuthorization} [input.resolveAuthorization]
 *   認証・所属確認のロジック本体。既定はresolveQuickExpenseAuthorization
 *   （実運用の呼び出し元・index.tsは指定不要。テストでの差し替え用）。
 * @param {(payload: unknown) => Promise<{ result: object|null, error: object|null }>} [input.createQuickExpense]
 *   Concur側スタブ処理の呼び出し。既定はcreateQuickExpenseStub（実運用の
 *   呼び出し元・index.tsは指定不要）。テストで内部例外の発生を再現するため
 *   だけに差し替え可能にしている。
 * @returns {Promise<{ status: number, body: { result: object|null, error: object|null } }>}
 */
export async function handleQuickExpenseRequest({
  method,
  authHeader,
  parseBody,
  fetchUser,
  fetchCompanyMembership,
  resolveAuthorization = resolveQuickExpenseAuthorization,
  createQuickExpense = createQuickExpenseStub,
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

  let stubResult;
  try {
    stubResult = await createQuickExpense(validated);
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
