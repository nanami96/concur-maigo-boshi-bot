// lookup-concur-user（Deno.serveハンドラーはindex.ts）から、Deno固有のAPIを
// 切り離した処理本体。supabase/functions/check-concur-oauth/
// handleConcurOAuthCheckRequest.jsと同じ「呼び出し元がI/Oを注入する」
// パターンを踏襲し、Deno無しにNode/vitestから直接テストできる。
//
// 処理順序（要件どおり）：
//   1. HTTPメソッド確認（POST以外はmethod_not_allowed）
//   2. 認証・権限確認（resolveLookupConcurUserAuthorization.js）
//      - 未認証 → unauthorized（401）
//      - platform_adminでない → forbidden（403）。この時点でVault関連の
//        getRefreshTokenForEdge/completeOAuthRefresh・Identity API呼び出しの
//        いずれも一切呼ばれない。
//   3. 安全ゲート確認（isConcurIdentityLookupEnabled.js）
//      CONCUR_IDENTITY_LOOKUP_ENABLEDが厳密に"true"でない場合は、
//      Vault RPC・OAuth・Identity APIのいずれも一切呼ばず、
//      { found: false, status: "disabled" } を返す（200）。
//   4. リクエスト本文検証（validateConcurIdentityLookupRequest.js）。
//      不正な場合はVault RPC等を一切呼ばずconcur_identity_invalid_requestを返す
//      （無駄なリース取得・OAuth通信を避けるため、安全ゲードの直後・
//      Vault呼び出しの前に検証する）。
//   5. getRefreshTokenForEdge()（get_concur_refresh_token_for_edge RPC相当）で
//      現在のRefresh Token・connection_id・lease_idを取得する。取得できない
//      場合（未接続・ロック中のいずれか。理由は区別しない）は
//      concur_oauth_not_connectedを返す。token endpointへは通信しない。
//   6. refreshConcurAccessToken()でtoken endpointへRefresh Token Grantを
//      実行する。
//   7. 失敗した場合：completeOAuthRefresh({success:false, errorCode})を
//      呼んでリースを解放し（ベストエフォート）、元のエラーコードを返す。
//      Identity APIへは一切進まない。
//   8. 成功した場合：completeOAuthRefresh({success:true, newRefreshToken})を
//      呼ぶ（rotated:falseならnewRefreshTokenはnull）。
//      - falseが返れば（lease不一致）concur_oauth_completion_failedを返す。
//        Identity APIへは一切進まない。
//      - 例外が発生すれば（Vault更新自体が失敗）concur_oauth_storage_failed
//        を返す。Identity APIへは一切進まない。
//      - trueが返った場合（＝保存成功後）にのみ、Identity APIへ進む。
//   9. lookupConcurUser()でIdentity APIへ利用者検索リクエストを送る。
//      Access Tokenはこの呼び出しにだけ使われ、この関数のローカル変数
//      （accessToken）としてのみ存在し、DB・Vault・Secretsのいずれにも
//      保存しない。この関数の処理が終わればスコープを抜けて破棄される。
//  10. 検索結果に応じてfound/hasUserId/multipleMatches、またはエラーコード
//      （concur_user_not_found・concur_user_ambiguous・concur_identity_*）を返す。
//
// request bodyのuserName以外の項目は一切読み取らない・使わない。
//
// このFunctionが返しうるエラーコード：
//   - method_not_allowed                 … POST以外のメソッド
//   - unauthorized                       … 未認証
//   - forbidden                          … platform_adminでない
//   - concur_identity_invalid_request    … userNameが無効（必須・文字列・
//                                           trim後非空・長さ・禁止文字）
//   - concur_not_configured              … 必須Secrets（Client ID/Secret/Token URL）不足
//   - concur_oauth_timeout               … token endpointのタイムアウト
//   - concur_oauth_network_error         … token endpointへの通信失敗
//   - concur_oauth_rejected              … 認証情報・Refresh Tokenが拒否された
//   - concur_oauth_rate_limited          … token endpointが429
//   - concur_oauth_service_error         … token endpointが5xx
//   - concur_oauth_invalid_response      … token endpointの応答形式が不正
//   - concur_oauth_not_connected         … 対象接続が無い、またはロック中
//   - concur_oauth_completion_failed     … 完了RPCがfalse（lease不一致）
//   - concur_oauth_storage_failed        … 完了RPCが例外（Vault更新自体が失敗）
//   - concur_identity_geolocation_missing … token応答にgeolocationが無い
//   - concur_user_not_found              … 検索結果0件
//   - concur_user_ambiguous              … 検索結果複数件
//   - concur_identity_invalid_response   … Identity API応答の形式が不正・userID欠落
//   - concur_identity_rejected           … Identity APIが401/403
//   - concur_identity_rate_limited       … Identity APIが429
//   - concur_identity_service_error      … Identity APIが5xx
//   - concur_identity_timeout            … Identity APIのタイムアウト
//   - concur_identity_network_error      … Identity APIへの通信失敗
//   - internal_error                     … 上記以外の予期しない例外
import { resolveLookupConcurUserAuthorization } from "./resolveLookupConcurUserAuthorization.js";
import { isConcurIdentityLookupEnabled } from "./isConcurIdentityLookupEnabled.js";
import {
  buildLookupConcurUserError,
  buildLookupConcurUserSuccessResponse,
  buildLookupConcurUserErrorResponse,
} from "./buildLookupConcurUserResponse.js";
import { validateConcurIdentityLookupRequest } from "../_shared/concur-identity/validateConcurIdentityLookupRequest.js";
import { buildConcurIdentityLookupError } from "../_shared/concur-identity/classifyConcurIdentityLookupError.js";
import { lookupConcurUser } from "../_shared/concur-identity/lookupConcurUser.js";
import { refreshConcurAccessToken } from "../_shared/concur-oauth/refreshConcurAccessToken.js";
import { buildSafeConcurOAuthScopeDiagnosticLog } from "../_shared/concur-identity/buildSafeConcurOAuthScopeDiagnosticLog.js";

function respondWithLocalCode(code) {
  return buildLookupConcurUserErrorResponse(buildLookupConcurUserError(code));
}

// 【一時的なデバッグログ・要削除】concur_identity_rejected（401）の原因切り分けの
// ため、実際に付与されたscopeにidentity.user.ids.readが含まれるかどうかの
// 真偽値だけを記録する。scopeの生値・件数・他のscope名、Access Token・
// Refresh Token・Client Secret・userName・userIDはここでは一切参照しない
// （buildSafeConcurOAuthScopeDiagnosticLog.js参照）。このハンドラ自体が
// platform_admin専用（resolveLookupConcurUserAuthorization.js）のため、
// ここに到達する時点で「platform_adminによるIdentity検索」であることが
// 保証されている。デバッグが終わったら、この関数呼び出し箇所ごと削除すること。
function logConcurOAuthScopeDiagnosticForDebug(log, scope) {
  if (typeof log !== "function") {
    return;
  }
  try {
    log(
      "[DEBUG][concur_oauth_scope_diagnostic 一時デバッグ・要削除]",
      buildSafeConcurOAuthScopeDiagnosticLog({ scope }),
    );
  } catch {
    // ログ出力自体の失敗は本処理へ影響させない。
  }
}

// OAuth失敗時・予期しない例外時にリースを解放するためのベストエフォート呼び出し。
// handleConcurOAuthCheckRequest.jsのsafeCompleteFailure()と同じ考え方
// （ここでの二次的な失敗は、lock_expires_atの期限切れによる自己修復に委ねる）。
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
 * @param {string} input.method
 * @param {string|null} input.authHeader
 * @param {unknown} input.body リクエスト本文（JSON.parse済み、またはparse失敗時はnull）。
 * @param {(authHeader: string) => Promise<object|null>} input.fetchUser
 * @param {(user: object) => Promise<boolean>} input.isPlatformAdmin
 * @param {Record<string, string|undefined>} input.env
 * @param {string|null} [input.companyId] 対象会社（現時点では常にnull＝既定接続）。
 * @param {(input: { companyId: string|null }) => Promise<{ connectionId: string, leaseId: string, refreshToken: string } | null>} input.getRefreshTokenForEdge
 * @param {(input: { connectionId: string, leaseId: string, success: boolean, newRefreshToken: string|null, errorCode: string|null }) => Promise<boolean>} input.completeOAuthRefresh
 * @param {typeof resolveLookupConcurUserAuthorization} [input.resolveAuthorization]
 * @param {typeof refreshConcurAccessToken} [input.refreshAccessToken]
 * @param {typeof lookupConcurUser} [input.lookupUser]
 * @param {typeof fetch} [input.fetchImpl] テスト用の差し替え（refreshAccessToken・lookupUserへ素通しする）。
 * @param {(message: string, details?: object) => void} [input.log] 【一時的なデバッグログ・要削除】
 *   concur_identity_rejected発生時の調査用。lookupUser()へそのまま渡すだけで、
 *   この関数自身はログ出力しない（detailsは許可リスト済みの安全な構造化情報のみ）。
 *   加えて、この関数自身がOAuth Tokenのscope診断（concur_oauth_scope_diagnostic。
 *   identity.user.ids.readの有無の真偽値のみ）を1回だけ記録する
 *   （logConcurOAuthScopeDiagnosticForDebug参照）。
 * @returns {Promise<{ status: number, body: { result: object|null, error: object|null } }>}
 */
export async function handleLookupConcurUserRequest({
  method,
  authHeader,
  body,
  fetchUser,
  isPlatformAdmin,
  env,
  companyId = null,
  getRefreshTokenForEdge,
  completeOAuthRefresh,
  resolveAuthorization = resolveLookupConcurUserAuthorization,
  refreshAccessToken = refreshConcurAccessToken,
  lookupUser = lookupConcurUser,
  fetchImpl,
  log,
}) {
  if (method !== "POST") {
    return { status: 405, body: { result: null, error: { code: "method_not_allowed", message: "許可されていないメソッドです。" } } };
  }

  const authResult = await resolveAuthorization({ authHeader, fetchUser, isPlatformAdmin });

  if (authResult.outcome === "unauthorized") {
    return {
      status: 401,
      body: {
        result: null,
        error: { code: "unauthorized", message: "ログインの有効期限が切れている可能性があります。再度ログインしてください。" },
      },
    };
  }

  if (authResult.outcome === "forbidden") {
    return { status: 403, body: { result: null, error: { code: "forbidden", message: "この操作を行う権限がありません。" } } };
  }

  if (!isConcurIdentityLookupEnabled(env)) {
    return { status: 200, body: { result: { found: false, status: "disabled" }, error: null } };
  }

  const inputValidation = validateConcurIdentityLookupRequest(body);
  if (!inputValidation.ok) {
    const error = buildConcurIdentityLookupError("concur_identity_invalid_request");
    return buildLookupConcurUserErrorResponse(error);
  }
  const { userName } = inputValidation;

  let lease = null;
  try {
    lease = await getRefreshTokenForEdge({ companyId });
  } catch {
    return respondWithLocalCode("internal_error");
  }

  if (!lease || !lease.refreshToken || !lease.connectionId || !lease.leaseId) {
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
    return buildLookupConcurUserErrorResponse(oauthResult.error);
  }

  const newRefreshToken = oauthResult.rotated ? oauthResult.tokens.refreshToken : null;

  let completeOk = false;
  try {
    completeOk = await completeOAuthRefresh({ connectionId, leaseId, success: true, newRefreshToken, errorCode: null });
  } catch {
    // Vault更新自体が失敗した場合。新しいRefresh Tokenはここで破棄され、
    // これ以降どこにも保存されない。成功として扱わず、Identity APIへは進まない。
    return respondWithLocalCode("concur_oauth_storage_failed");
  }

  if (!completeOk) {
    // connection_id・lease_idの組み合わせが現在のリースと一致しなかった。
    // Vaultへは書き込まれていないため、Identity APIへは進まない。
    return respondWithLocalCode("concur_oauth_completion_failed");
  }

  // ここまでで「Refresh Tokenの保存成功」が確定した場合にのみ、Identity APIへ進む。
  const { accessToken, geolocation, scope } = oauthResult.tokens;

  logConcurOAuthScopeDiagnosticForDebug(log, scope);

  let lookupResult;
  try {
    // logは【一時的なデバッグログ・要削除】concur_identity_rejected発生時の
    // 調査用にlookupUser()内部だけで使われる（ここではAccess Token等を
    // 一切渡していない）。
    lookupResult = await lookupUser({ geolocation, accessToken, userName, fetchImpl, log });
  } catch {
    return respondWithLocalCode("internal_error");
  }
  // Access Tokenはこの関数のローカル変数（accessToken）としてのみ存在し、
  // ここから先は一切参照しない（処理終了とともに破棄される）。

  if (!lookupResult.ok) {
    return buildLookupConcurUserErrorResponse(lookupResult.error);
  }

  return buildLookupConcurUserSuccessResponse({
    found: true,
    hasUserId: Boolean(lookupResult.userId),
    multipleMatches: false,
  });
}
