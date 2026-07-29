// check-concur-oauth（Deno.serveハンドラーはindex.ts）から、Deno固有のAPIを
// 切り離した処理本体。supabase/functions/create-concur-quick-expense/
// handleQuickExpenseRequest.jsと同じ「呼び出し元がI/Oを注入する」パターンを
// 踏襲し、Deno無しにNode/vitestから直接テストできる。
//
// 処理順序：
//   1. HTTPメソッド確認（POST以外はmethod_not_allowed）
//   2. 認証・権限確認（resolveConcurOAuthCheckAuthorization.js）
//      - 未認証 → unauthorized（401）
//      - platform_adminでない → forbidden（403）
//   3. 安全ゲート確認（isConcurOAuthCheckEnabled.js）
//      CONCUR_OAUTH_CHECK_ENABLEDが厳密に"true"でない場合は、
//      refreshConcurAccessToken()を一切呼ばず、
//      { connected: false, status: "disabled" } を返す（200）。
//   4. 安全ゲートを通過した場合のみ、refreshConcurAccessToken()
//      （supabase/functions/_shared/concur-oauth/）を呼び出し、
//      buildConcurOAuthCheckResponse.jsで安全な形へ変換して返す。
//
// request bodyは一切読み取らない・使わない（認証情報・token URLは全て
// Secrets由来のenvから読む設計のため、フロントから送られた値を信用する
// 余地自体が存在しない）。
//
// このFunctionが返しうるエラーコード：
//   - method_not_allowed              … POST以外のメソッド
//   - unauthorized                    … 未認証
//   - forbidden                       … platform_adminでない
//   - concur_not_configured           … 必須Secrets不足（安全ゲート通過後）
//   - concur_oauth_timeout            … token endpointのタイムアウト
//   - concur_oauth_network_error      … 通信失敗
//   - concur_oauth_rejected           … 認証情報・Refresh Tokenが拒否された
//   - concur_oauth_rate_limited       … 429
//   - concur_oauth_service_error      … 5xx
//   - concur_oauth_invalid_response   … 2xxだが形式不正
//   - concur_oauth_rotation_unsupported … 新しいrefresh_tokenが返ったが保存できない
//   - internal_error                  … 上記以外の予期しない例外
import { resolveConcurOAuthCheckAuthorization } from "./resolveConcurOAuthCheckAuthorization.js";
import { isConcurOAuthCheckEnabled } from "./isConcurOAuthCheckEnabled.js";
import { buildConcurOAuthCheckResponse } from "./buildConcurOAuthCheckResponse.js";
import { refreshConcurAccessToken } from "../_shared/concur-oauth/refreshConcurAccessToken.js";

function errorBody(code, message) {
  return { result: null, error: { code, message } };
}

const UNAUTHORIZED_MESSAGE = "ログインの有効期限が切れている可能性があります。再度ログインしてください。";
const FORBIDDEN_MESSAGE = "この操作を行う権限がありません。";

/**
 * @param {object} input
 * @param {string} input.method
 * @param {string|null} input.authHeader
 * @param {(authHeader: string) => Promise<object|null>} input.fetchUser
 * @param {(user: object) => Promise<boolean>} input.isPlatformAdmin
 * @param {Record<string, string|undefined>} input.env
 * @param {typeof resolveConcurOAuthCheckAuthorization} [input.resolveAuthorization]
 * @param {typeof refreshConcurAccessToken} [input.refreshAccessToken]
 * @param {typeof fetch} [input.fetchImpl] テスト用の差し替え（refreshAccessTokenへ素通しする）。
 * @returns {Promise<{ status: number, body: { result: object|null, error: object|null } }>}
 */
export async function handleConcurOAuthCheckRequest({
  method,
  authHeader,
  fetchUser,
  isPlatformAdmin,
  env,
  resolveAuthorization = resolveConcurOAuthCheckAuthorization,
  refreshAccessToken = refreshConcurAccessToken,
  fetchImpl,
}) {
  // OPTIONS（CORSプリフライト）は実運用では index.ts の Deno.serve が
  // このハンドラーへ渡す前に204で応答済みのため、ここに到達することはない。
  // この関数だけを直接呼ぶテストのために、POST以外（OPTIONSを含む）は
  // 一律method_not_allowedとして扱う。
  if (method !== "POST") {
    return { status: 405, body: errorBody("method_not_allowed", "許可されていないメソッドです。") };
  }

  const authResult = await resolveAuthorization({ authHeader, fetchUser, isPlatformAdmin });

  if (authResult.outcome === "unauthorized") {
    return { status: 401, body: errorBody("unauthorized", UNAUTHORIZED_MESSAGE) };
  }

  if (authResult.outcome === "forbidden") {
    return { status: 403, body: errorBody("forbidden", FORBIDDEN_MESSAGE) };
  }

  // 200を返す理由：認証・認可は正しく通過しており、リクエスト自体は正常に
  // 処理できている。「安全ゲートが無効なので疎通確認していない」という
  // 正しい状態を返しているだけであり、リクエスト側の誤り（4xx）でも
  // サーバー側の障害（5xx）でもない。error: nullのresultとして返すことで、
  // このプロジェクト全体の{result, error}という統一レスポンス形式とも
  // 整合させ、connected:trueの成功時と明確に区別できるようにしている。
  if (!isConcurOAuthCheckEnabled(env)) {
    return { status: 200, body: { result: { connected: false, status: "disabled" }, error: null } };
  }

  let oauthResult;
  try {
    oauthResult = await refreshAccessToken({ env, ...(fetchImpl ? { fetchImpl } : {}) });
  } catch {
    // refreshConcurAccessToken()自体は例外を投げない設計だが、万一の場合も
    // 例外の詳細（メッセージ・スタック）は一切外部へ渡さない。
    return { status: 500, body: errorBody("internal_error", "処理中にエラーが発生しました。") };
  }

  return buildConcurOAuthCheckResponse(oauthResult);
}
