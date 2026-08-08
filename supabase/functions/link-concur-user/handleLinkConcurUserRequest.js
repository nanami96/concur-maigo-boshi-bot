// link-concur-user（Deno.serveハンドラーはindex.ts）から、Deno固有のAPIを
// 切り離した処理本体。他のConcur関連Edge Function（check-concur-oauth・
// lookup-concur-user・create-concur-quick-expense）と同じ「呼び出し元がI/Oを
// 注入する」パターンを踏襲し、Deno無しにNode/vitestから直接テストできる。
//
// 【位置づけ・重要（Phase 13）】
// 一般利用者（company_membersに所属する本人）が、自分自身のConcurログインID
// を「Identity APIで実在確認済み」の状態でuser_id×company_id単位で保存する
// ための専用Edge Function。既存のlookup-concur-user（platform_admin専用の
// 診断ツール）とは責務を分離し、一般ユーザー向けの保存APIとして混同しない
// （ファイル冒頭の設計判断どおり）。lookup-concur-user自体はこのFunctionから
// 呼ばない・変更しない。
//
// 処理順序（既存のlookup-concur-user・create-concur-quick-expenseと同じ
// Vault/OAuth/Identityパイプラインを踏襲）：
//   1. HTTPメソッド確認（POST以外はmethod_not_allowed）
//   2. 本人確認（resolveLinkConcurUserAuthorization.js）
//      - 未認証 → unauthorized（401）
//   3. 安全ゲート確認（isConcurUserLinkEnabled.js）
//      CONCUR_USER_LINK_ENABLEDが厳密に"true"でない場合は、入力検証・
//      resolveOAuthCompanyId・Vault RPC・OAuth・Identity API・DB保存の
//      いずれも一切呼ばず、{ linked: false, status: "disabled" } を返す
//      （200。lookup-concur-userのdisabled応答と同じ考え方）。
//   4. リクエスト本文検証（validateLinkConcurUserRequest.js）。
//      companyCode・concurLoginIdが必須。不正な場合はVault RPC等を一切
//      呼ばずconcur_user_link_invalid_requestを返す。
//   5. resolveOAuthCompanyId({ userId, companyCode })
//      （service_role専用RPC resolve_concur_oauth_company_id。既存の
//      create-concur-quick-expense・check-concur-oauth・lookup-concur-userと
//      同一のRPCをそのまま再利用する。新しい会社解決方式は作らない）で、
//      認証済みユーザーが実際にcompanyCodeの会社へ所属しているかを確認する。
//      未解決（未所属・存在しない会社）の場合はforbiddenを返す（会社の
//      存在有無を区別しない）。
//   6. getRefreshTokenForEdge({ companyId: 解決したUUID })で現在のRefresh
//      Token・connection_id・lease_idを取得する。取得できない場合（未接続・
//      ロック中のいずれか。理由は区別しない）はconcur_oauth_not_connectedを
//      返す。token endpointへは通信しない。
//   7. refreshConcurAccessToken()でtoken endpointへRefresh Token Grantを
//      実行する。
//   8. 失敗した場合：completeOAuthRefresh({success:false, errorCode})を
//      呼んでリースを解放し（ベストエフォート）、元のエラーコードを返す。
//      Identity APIへは一切進まない。
//   9. 成功した場合：completeOAuthRefresh({success:true, newRefreshToken})を
//      呼ぶ（rotated:falseならnewRefreshTokenはnull）。falseが返れば
//      concur_oauth_completion_failed、例外が発生すればconcur_oauth_storage_
//      failedを返し、いずれもIdentity APIへは進まない。
//  10. 成功した場合（＝保存成功確定後）にのみ、lookupConcurUser()でIdentity
//      APIへ利用者検索リクエストを送る。0件・複数件・401/403・timeout等の
//      場合は既存の固定エラーコード（concur_user_not_found等）を返し、
//      concur_user_linksへの保存は一切行わない。
//  11. Identity APIが「1件だけヒットし、userIDを含む」と確認できた場合
//      （lookupConcurUser()がok:trueを返した場合。この関数の設計上、
//      ok:trueは常にfound=true・hasUserId=true・multipleMatches=falseを
//      意味する。_shared/concur-identity/validateConcurIdentityLookupResponse.js
//      参照）にのみ、saveConcurUserLink({ userId, companyId, concurLoginId })
//      （service_role専用RPC save_concur_user_link）を呼び、確認済みの
//      concurLoginIdだけをDBへ保存する。Concur側のuserID（UUID）自体は
//      保存しない（引数として渡さない。この関数のローカル変数としてすら
//      保持しない）。保存に失敗した場合はconcur_user_link_save_failedを返す。
//  12. 保存成功後、{ linked: true } を返す（200）。
//
// このFunctionが返しうるエラーコード：
//   - method_not_allowed              … POST以外のメソッド
//   - unauthorized                    … 未認証
//   - concur_user_link_invalid_request … companyCodeまたはconcurLoginIdが無効
//   - forbidden                       … 対象会社への所属が確認できない
//   - concur_not_configured           … 必須Secrets（Client ID/Secret/Token URL）不足
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
//   - concur_user_link_save_failed    … Identity確認は成功したがDB保存に失敗
//   - internal_error                  … 上記以外の予期しない例外
import { resolveLinkConcurUserAuthorization } from "./resolveLinkConcurUserAuthorization.js";
import { isConcurUserLinkEnabled } from "./isConcurUserLinkEnabled.js";
import { validateLinkConcurUserRequest } from "./validateLinkConcurUserRequest.js";
import {
  buildLinkConcurUserError,
  buildLinkConcurUserSuccessResponse,
  buildLinkConcurUserErrorResponse,
} from "./buildLinkConcurUserResponse.js";
import { refreshConcurAccessToken } from "../_shared/concur-oauth/refreshConcurAccessToken.js";
import { lookupConcurUser } from "../_shared/concur-identity/lookupConcurUser.js";

function respondWithLocalCode(code) {
  return buildLinkConcurUserErrorResponse(buildLinkConcurUserError(code));
}

// OAuth失敗時・予期しない例外時にリースを解放するためのベストエフォート呼び出し。
// 他のConcur関連Edge FunctionのsafeCompleteFailure()と全く同じ考え方。
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
 * @param {() => Promise<unknown>} input.parseBody
 * @param {(authHeader: string) => Promise<object|null>} input.fetchUser
 * @param {Record<string, string|undefined>} input.env
 * @param {(input: { userId: string, companyCode: string }) => Promise<string|null>} input.resolveOAuthCompanyId
 *   resolve_concur_oauth_company_id RPC相当（既存3 Functionと共有する同一RPC）。
 * @param {(input: { companyId: string|null }) => Promise<{ connectionId: string, leaseId: string, refreshToken: string } | null>} input.getRefreshTokenForEdge
 * @param {(input: { connectionId: string, leaseId: string, success: boolean, newRefreshToken: string|null, errorCode: string|null }) => Promise<boolean>} input.completeOAuthRefresh
 * @param {(input: { userId: string, companyId: string, concurLoginId: string }) => Promise<void>} input.saveConcurUserLink
 *   save_concur_user_link RPC相当（service_role専用）。Identity API確認成功後にのみ呼ばれる。
 * @param {typeof resolveLinkConcurUserAuthorization} [input.resolveAuthorization]
 * @param {typeof refreshConcurAccessToken} [input.refreshAccessToken]
 * @param {typeof lookupConcurUser} [input.lookupUser]
 * @param {typeof fetch} [input.fetchImpl] テスト用の差し替え。
 * @returns {Promise<{ status: number, body: { result: object|null, error: object|null } }>}
 */
export async function handleLinkConcurUserRequest({
  method,
  authHeader,
  parseBody,
  fetchUser,
  env,
  resolveOAuthCompanyId,
  getRefreshTokenForEdge,
  completeOAuthRefresh,
  saveConcurUserLink,
  resolveAuthorization = resolveLinkConcurUserAuthorization,
  refreshAccessToken = refreshConcurAccessToken,
  lookupUser = lookupConcurUser,
  fetchImpl,
}) {
  if (method !== "POST") {
    return { status: 405, body: { result: null, error: { code: "method_not_allowed", message: "許可されていないメソッドです。" } } };
  }

  const authResult = await resolveAuthorization({ authHeader, fetchUser });

  if (authResult.outcome === "unauthorized") {
    return {
      status: 401,
      body: {
        result: null,
        error: { code: "unauthorized", message: "ログインの有効期限が切れている可能性があります。再度ログインしてください。" },
      },
    };
  }

  if (!isConcurUserLinkEnabled(env)) {
    return { status: 200, body: { result: { linked: false, status: "disabled" }, error: null } };
  }

  let rawBody;
  try {
    rawBody = await parseBody();
  } catch {
    return respondWithLocalCode("invalid_json");
  }

  const inputValidation = validateLinkConcurUserRequest(rawBody);
  if (!inputValidation.ok) {
    return respondWithLocalCode("concur_user_link_invalid_request");
  }
  const { companyCode, concurLoginId } = inputValidation;

  // 会社境界（重要）：他のConcur関連Edge Functionと全く同じ考え方。
  // クライアントはcompany UUIDを一切送ってこないため、信用できるのは
  // このRPCの解決結果以外にない。未解決（未所属・存在しない会社）の場合は
  // fail-closedでforbiddenを返す（既定接続へのフォールバックはしない）。
  let vaultCompanyId = null;
  try {
    vaultCompanyId = await resolveOAuthCompanyId({ userId: authResult.user.id, companyCode });
  } catch {
    return respondWithLocalCode("internal_error");
  }

  if (typeof vaultCompanyId !== "string" || vaultCompanyId.trim() === "") {
    return { status: 403, body: { result: null, error: { code: "forbidden", message: "この操作を行う権限がありません。" } } };
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
    return buildLinkConcurUserErrorResponse(oauthResult.error);
  }

  const newRefreshToken = oauthResult.rotated ? oauthResult.tokens.refreshToken : null;

  let completeOk = false;
  try {
    completeOk = await completeOAuthRefresh({ connectionId, leaseId, success: true, newRefreshToken, errorCode: null });
  } catch {
    return respondWithLocalCode("concur_oauth_storage_failed");
  }

  if (!completeOk) {
    return respondWithLocalCode("concur_oauth_completion_failed");
  }

  // ここまでで「Refresh Tokenの保存成功」が確定した場合にのみ、Identity APIへ進む。
  const { accessToken, geolocation } = oauthResult.tokens;

  let lookupResult;
  try {
    lookupResult = await lookupUser({ geolocation, accessToken, userName: concurLoginId, fetchImpl });
  } catch {
    return respondWithLocalCode("internal_error");
  }

  if (!lookupResult.ok) {
    // 0件（concur_user_not_found）・複数件（concur_user_ambiguous）を含め、
    // concur_user_linksへの保存は一切行わない。
    return buildLinkConcurUserErrorResponse(lookupResult.error);
  }

  // lookupUser()がok:trueを返す時点で、Identity APIが「1件だけヒットし、
  // userIDを含む」ことは既に保証されている
  // （_shared/concur-identity/validateConcurIdentityLookupResponse.js参照）。
  // Concur側のuserID（UUID）自体はここでも一切参照しない（保存対象は
  // concurLoginIdだけ）。
  try {
    await saveConcurUserLink({ userId: authResult.user.id, companyId: vaultCompanyId, concurLoginId });
  } catch {
    return respondWithLocalCode("concur_user_link_save_failed");
  }

  return buildLinkConcurUserSuccessResponse({ linked: true });
}
