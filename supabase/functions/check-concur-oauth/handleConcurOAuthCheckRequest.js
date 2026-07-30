// check-concur-oauth（Deno.serveハンドラーはindex.ts）から、Deno固有のAPIを
// 切り離した処理本体。supabase/functions/create-concur-quick-expense/
// handleQuickExpenseRequest.jsと同じ「呼び出し元がI/Oを注入する」パターンを
// 踏襲し、Deno無しにNode/vitestから直接テストできる。
//
// 処理順序：
//   1. HTTPメソッド確認（POST以外はmethod_not_allowed）
//   2. 認証・権限確認（resolveConcurOAuthCheckAuthorization.js）
//      - 未認証 → unauthorized（401）
//      - platform_adminでない → forbidden（403）。この時点でVault関連の
//        getRefreshTokenForEdge/completeOAuthRefreshは一切呼ばれない。
//   3. 安全ゲート確認（isConcurOAuthCheckEnabled.js）
//      CONCUR_OAUTH_CHECK_ENABLEDが厳密に"true"でない場合は、
//      Vault RPC・refreshConcurAccessToken()を一切呼ばず、
//      { connected: false, status: "disabled" } を返す（200）。
//   4. getRefreshTokenForEdge()（get_concur_refresh_token_for_edge RPC相当）で
//      現在のRefresh Token・connection_id・lease_idを取得する。取得できない
//      場合（未接続・ロック中のいずれか。理由は区別しない）は
//      concur_oauth_not_connectedを返す。token endpointへは通信しない。
//   5. refreshConcurAccessToken()でtoken endpointへRefresh Token Grantを
//      実行する。
//   6. 失敗した場合：completeOAuthRefresh({success:false, errorCode})を
//      呼んでリースを解放し（ベストエフォート）、元のエラーコードを返す。
//   7. 成功した場合：completeOAuthRefresh({success:true, newRefreshToken})を
//      呼ぶ（rotated:falseならnewRefreshTokenはnull）。
//      - trueが返れば、保存成功として初めてconnected:trueを返す
//      - falseが返れば（lease不一致＝リースが既に別処理へ引き継がれていた）
//        concur_oauth_completion_failedを返す
//      - 例外が発生すれば（Vault更新自体が失敗）concur_oauth_storage_failed
//        を返す
//   8. 保存成功後、evaluateConcurRequiredScopes.jsでAccess Tokenのscopeに
//      quickexpense.writeonly／user.read／identity.user.ids.readが実際に
//      含まれているかを真偽値だけで判定し、成功レスポンスへ含める
//      （Quick Expense API・Identity APIへの実通信前チェック。scope全文・
//      他のスコープ名は一切含めない）。
//
// request bodyは一切読み取らない・使わない（認証情報・token URL・Refresh
// Tokenは全てSecrets/Vault由来であり、フロントから送られた値を信用する
// 余地自体が存在しない）。
//
// このFunctionが返しうるエラーコード：
//   - method_not_allowed              … POST以外のメソッド
//   - unauthorized                    … 未認証
//   - forbidden                       … platform_adminでない
//   - concur_not_configured           … 必須Secrets不足、またはrefreshToken未取得
//   - concur_oauth_timeout            … token endpointのタイムアウト
//   - concur_oauth_network_error      … 通信失敗
//   - concur_oauth_rejected           … 認証情報・Refresh Tokenが拒否された
//   - concur_oauth_rate_limited       … 429
//   - concur_oauth_service_error      … 5xx
//   - concur_oauth_invalid_response   … 2xxだが形式不正
//   - concur_oauth_not_connected      … 対象接続が無い、またはロック中（区別しない）
//   - concur_oauth_completion_failed  … 完了RPCがfalse（lease不一致。想定外の競合）
//   - concur_oauth_storage_failed     … 完了RPCが例外（Vault更新自体が失敗）
//   - internal_error                  … 上記以外の予期しない例外
import { resolveConcurOAuthCheckAuthorization } from "./resolveConcurOAuthCheckAuthorization.js";
import { isConcurOAuthCheckEnabled } from "./isConcurOAuthCheckEnabled.js";
import {
  buildConcurOAuthCheckError,
  buildConcurOAuthCheckSuccessResponse,
  buildConcurOAuthCheckErrorResponse,
} from "./buildConcurOAuthCheckResponse.js";
import { refreshConcurAccessToken } from "../_shared/concur-oauth/refreshConcurAccessToken.js";
import { evaluateConcurRequiredScopes } from "../_shared/concur-oauth/evaluateConcurRequiredScopes.js";

function errorBody(code, message) {
  return { result: null, error: { code, message } };
}

const UNAUTHORIZED_MESSAGE = "ログインの有効期限が切れている可能性があります。再度ログインしてください。";
const FORBIDDEN_MESSAGE = "この操作を行う権限がありません。";

function respondWithLocalCode(code) {
  return buildConcurOAuthCheckErrorResponse(buildConcurOAuthCheckError(code));
}

// OAuth失敗時・予期しない例外時にリースを解放するためのベストエフォート呼び出し。
// ここでの失敗（completeOAuthRefresh自体が例外を投げる等）は、呼び出し元へ
// 返す本来のエラー（元の失敗理由）より優先しない（リースはlock_expires_atの
// 期限切れにより自己修復されるため、ここでの二次的な失敗は致命的ではない）。
async function safeCompleteFailure(completeOAuthRefresh, connectionId, leaseId, errorCode) {
  if (!completeOAuthRefresh) {
    return;
  }
  try {
    await completeOAuthRefresh({ connectionId, leaseId, success: false, newRefreshToken: null, errorCode });
  } catch {
    // ベストエフォート。詳細は握りつぶす（Token値・例外メッセージを外部へ
    // 一切出さない方針を、この二次的な呼び出しでも一貫させる）。
  }
}

/**
 * @param {object} input
 * @param {string} input.method
 * @param {string|null} input.authHeader
 * @param {(authHeader: string) => Promise<object|null>} input.fetchUser
 * @param {(user: object) => Promise<boolean>} input.isPlatformAdmin
 * @param {Record<string, string|undefined>} input.env
 * @param {string|null} [input.companyId] 対象会社（現時点では常にnull＝既定接続）。
 * @param {(input: { companyId: string|null }) => Promise<{ connectionId: string, leaseId: string, refreshToken: string } | null>} input.getRefreshTokenForEdge
 *   get_concur_refresh_token_for_edge RPC相当。service_role専用クライアントで呼ぶこと
 *   （index.ts参照。呼び出し元JWTクライアントからは呼ばない）。
 * @param {(input: { connectionId: string, leaseId: string, success: boolean, newRefreshToken: string|null, errorCode: string|null }) => Promise<boolean>} input.completeOAuthRefresh
 *   complete_concur_oauth_refresh RPC相当。同じくservice_role専用クライアントで呼ぶ。
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
  companyId = null,
  getRefreshTokenForEdge,
  completeOAuthRefresh,
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

  let lease = null;
  try {
    lease = await getRefreshTokenForEdge({ companyId });
  } catch {
    return respondWithLocalCode("internal_error");
  }

  if (!lease || !lease.refreshToken || !lease.connectionId || !lease.leaseId) {
    // 未接続・ロック中のいずれも区別せず統合する（buildConcurOAuthCheckResponse.js
    // 冒頭コメント参照）。token endpointへは通信しない。
    return respondWithLocalCode("concur_oauth_not_connected");
  }

  const { connectionId, leaseId, refreshToken } = lease;

  let oauthResult;
  try {
    oauthResult = await refreshAccessToken({ env, refreshToken, fetchImpl });
  } catch {
    await safeCompleteFailure(completeOAuthRefresh, connectionId, leaseId, "internal_error");
    return respondWithLocalCode("internal_error");
  }

  if (!oauthResult.ok) {
    await safeCompleteFailure(completeOAuthRefresh, connectionId, leaseId, oauthResult.error.code);
    return buildConcurOAuthCheckErrorResponse(oauthResult.error);
  }

  const newRefreshToken = oauthResult.rotated ? oauthResult.tokens.refreshToken : null;

  let completeOk = false;
  try {
    completeOk = await completeOAuthRefresh({ connectionId, leaseId, success: true, newRefreshToken, errorCode: null });
  } catch {
    // Vault更新自体が失敗した場合。新しいRefresh Tokenはここで破棄され、
    // これ以降どこにも保存されない（メモリ上の値としてリクエスト終了とともに
    // 失われる）。成功として扱わない。
    return respondWithLocalCode("concur_oauth_storage_failed");
  }

  if (!completeOk) {
    // connection_id・lease_idの組み合わせが現在のリースと一致しなかった
    // （既に他の処理が引き継いでいた等）。この場合もVaultへは書き込まれて
    // いないため、成功として扱わない。
    return respondWithLocalCode("concur_oauth_completion_failed");
  }

  const scopeCheck = evaluateConcurRequiredScopes(oauthResult.tokens?.scope);

  return buildConcurOAuthCheckSuccessResponse({
    hasGeolocation: oauthResult.logSummary?.hasGeolocation,
    expiresInPresent: oauthResult.logSummary?.expiresInPresent,
    rotated: Boolean(newRefreshToken),
    ...scopeCheck,
  });
}
