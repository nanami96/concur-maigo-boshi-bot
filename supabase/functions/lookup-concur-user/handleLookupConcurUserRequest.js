// lookup-concur-user（Deno.serveハンドラーはindex.ts）から、Deno固有のAPIを
// 切り離した処理本体。supabase/functions/check-concur-oauth/
// handleConcurOAuthCheckRequest.jsと同じ「呼び出し元がI/Oを注入する」
// パターンを踏襲し、Deno無しにNode/vitestから直接テストできる。
//
// 処理順序（要件どおり。【会社別OAuth接続対応で変更】）：
//   1. HTTPメソッド確認（POST以外はmethod_not_allowed）
//   2. 認証・権限確認（resolveLookupConcurUserAuthorization.js）
//      - 未認証 → unauthorized（401）
//      - platform_adminでない → forbidden（403）。この時点でVault関連の
//        getRefreshTokenForEdge/completeOAuthRefresh・Identity API呼び出しの
//        いずれも一切呼ばれない。
//   3. 安全ゲート確認（isConcurIdentityLookupEnabled.js）
//      CONCUR_IDENTITY_LOOKUP_ENABLEDが厳密に"true"でない場合は、
//      resolveOAuthCompanyId・Vault RPC・OAuth・Identity APIのいずれも
//      一切呼ばず、{ found: false, status: "disabled" } を返す（200）。
//   4. リクエスト本文検証（validateConcurIdentityLookupRequest.js）。
//      userNameに加えてcompanyCode（company_code）も必須項目として検証する。
//      不正な場合はVault RPC等を一切呼ばずconcur_identity_invalid_requestを返す
//      （無駄なリース取得・OAuth通信を避けるため、安全ゲードの直後・
//      Vault呼び出しの前に検証する）。
//   5. resolveOAuthCompanyId({ userId, companyCode })
//      （service_role専用RPC resolve_concur_oauth_company_id相当。
//      supabase/schema.sql参照）で、手順2で検証済みのauthResult.user.idと
//      手順4で検証済みのcompanyCodeから、対象会社のConcur OAuth Vault接続
//      識別子（concur_oauth_connections.company_id、Supabase内部UUID）を
//      解決する。クライアントからcompany UUIDを直接受け取る経路は無い。
//      未解決（platform_adminがその会社のcompany_membersに存在しない場合を
//      含む。理由は区別しない）の場合はconcur_oauth_not_connectedを返し、
//      getRefreshTokenForEdge以降には一切進まない（既定接続company_id IS
//      NULLへのフォールバックはしない）。
//   6. getRefreshTokenForEdge({ companyId: 解決したUUID })
//      （get_concur_refresh_token_for_edge RPC相当）で現在のRefresh Token・
//      connection_id・lease_idを取得する。取得できない場合（未接続・ロック中の
//      いずれか。理由は区別しない）はconcur_oauth_not_connectedを返す。
//      token endpointへは通信しない。
//   7. refreshConcurAccessToken()でtoken endpointへRefresh Token Grantを
//      実行する。
//   8. 失敗した場合：completeOAuthRefresh({success:false, errorCode})を
//      呼んでリースを解放し（ベストエフォート）、元のエラーコードを返す。
//      Identity APIへは一切進まない。
//   9. 成功した場合：completeOAuthRefresh({success:true, newRefreshToken})を
//      呼ぶ（rotated:falseならnewRefreshTokenはnull）。
//      - falseが返れば（lease不一致）concur_oauth_completion_failedを返す。
//        Identity APIへは一切進まない。
//      - 例外が発生すれば（Vault更新自体が失敗）concur_oauth_storage_failed
//        を返す。Identity APIへは一切進まない。
//      - trueが返った場合（＝保存成功後）にのみ、Identity APIへ進む。
//  10. lookupConcurUser()でIdentity APIへ利用者検索リクエストを送る。
//      Access Tokenはこの呼び出しにだけ使われ、この関数のローカル変数
//      （accessToken）としてのみ存在し、DB・Vault・Secretsのいずれにも
//      保存しない。この関数の処理が終わればスコープを抜けて破棄される。
//  11. 検索結果に応じてfound/hasUserId/multipleMatches、またはエラーコード
//      （concur_user_not_found・concur_user_ambiguous・concur_identity_*）を返す。
//
// request bodyのuserName・companyCode以外の項目は一切読み取らない・使わない。
//
// このFunctionが返しうるエラーコード：
//   - method_not_allowed                 … POST以外のメソッド
//   - unauthorized                       … 未認証
//   - forbidden                          … platform_adminでない
//   - concur_identity_invalid_request    … userNameまたはcompanyCodeが無効
//                                           （必須・文字列・trim後非空・
//                                           userNameは長さ・禁止文字も検証）
//   - concur_not_configured              … 必須Secrets（Client ID/Secret/Token URL）不足
//   - concur_oauth_timeout               … token endpointのタイムアウト
//   - concur_oauth_network_error         … token endpointへの通信失敗
//   - concur_oauth_rejected              … 認証情報・Refresh Tokenが拒否された
//   - concur_oauth_rate_limited          … token endpointが429
//   - concur_oauth_service_error         … token endpointが5xx
//   - concur_oauth_invalid_response      … token endpointの応答形式が不正
//   - concur_oauth_not_connected         … 対象会社UUIDが未解決、対象接続が無い、
//                                           またはロック中（いずれも区別しない）
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

function respondWithLocalCode(code) {
  return buildLookupConcurUserErrorResponse(buildLookupConcurUserError(code));
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
 * @param {(input: { userId: string, companyCode: string }) => Promise<string|null>} input.resolveOAuthCompanyId
 *   Concur OAuth Vault接続の会社境界（concur_oauth_connections.company_id）を
 *   解決する、service_role専用RPC（resolve_concur_oauth_company_id。
 *   supabase/schema.sql参照）の呼び出し。安全ゲートがtrueかつ入力検証を
 *   通過した場合だけ呼ばれる。userIdはauthResult.user.id（fetchUserで検証
 *   済み）、companyCodeはvalidateConcurIdentityLookupRequestで検証済みの
 *   値を渡す。対象の所属が無ければnullを返す想定。この関数の外部入力
 *   パラメータとしてのcompanyId（Vault接続識別子そのもの）は存在しない
 *   （以前は呼び出し元がcompanyIdを直接渡せたが、常にnull固定で呼ばれており、
 *   会社別接続対応後はcross-company接続混在のリスクがあったため廃止した）。
 * @param {(input: { companyId: string|null }) => Promise<{ connectionId: string, leaseId: string, refreshToken: string } | null>} input.getRefreshTokenForEdge
 * @param {(input: { connectionId: string, leaseId: string, success: boolean, newRefreshToken: string|null, errorCode: string|null }) => Promise<boolean>} input.completeOAuthRefresh
 * @param {typeof resolveLookupConcurUserAuthorization} [input.resolveAuthorization]
 * @param {typeof refreshConcurAccessToken} [input.refreshAccessToken]
 * @param {typeof lookupConcurUser} [input.lookupUser]
 * @param {typeof fetch} [input.fetchImpl] テスト用の差し替え（refreshAccessToken・lookupUserへ素通しする）。
 * @returns {Promise<{ status: number, body: { result: object|null, error: object|null } }>}
 */
export async function handleLookupConcurUserRequest({
  method,
  authHeader,
  body,
  fetchUser,
  isPlatformAdmin,
  env,
  resolveOAuthCompanyId,
  getRefreshTokenForEdge,
  completeOAuthRefresh,
  resolveAuthorization = resolveLookupConcurUserAuthorization,
  refreshAccessToken = refreshConcurAccessToken,
  lookupUser = lookupConcurUser,
  fetchImpl,
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
  const { userName, companyCode } = inputValidation;

  // 会社境界（重要）：Vaultから取得するRefresh Tokenの対象会社は、必ず
  // resolveOAuthCompanyId({ userId, companyCode })が、authResult.user.id
  // （手順2で検証済み）とcompanyCode（手順4で検証済み）から解決した
  // companies.idだけを使う。クライアントはcompany UUIDを一切送ってこない
  // ため、信用できるのはこのRPCの解決結果以外にない。未解決（platform_admin
  // がその会社のcompany_membersに存在しない場合を含む）の場合は、既定接続
  // （company_id IS NULLの共有接続）へフォールバックせず、Vaultリース取得
  // 自体を行わずfail-closedにする。
  let vaultCompanyId = null;
  try {
    vaultCompanyId = await resolveOAuthCompanyId({ userId: authResult.user.id, companyCode });
  } catch {
    return respondWithLocalCode("internal_error");
  }

  if (typeof vaultCompanyId !== "string" || vaultCompanyId.trim() === "") {
    return respondWithLocalCode("concur_oauth_not_connected");
  }

  let lease = null;
  try {
    lease = await getRefreshTokenForEdge({ companyId: vaultCompanyId });
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
  const { accessToken, geolocation } = oauthResult.tokens;

  let lookupResult;
  try {
    lookupResult = await lookupUser({ geolocation, accessToken, userName, fetchImpl });
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
