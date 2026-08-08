// check-concur-oauth（Deno.serveハンドラーはindex.ts）から、Deno固有のAPIを
// 切り離した処理本体。supabase/functions/create-concur-quick-expense/
// handleQuickExpenseRequest.jsと同じ「呼び出し元がI/Oを注入する」パターンを
// 踏襲し、Deno無しにNode/vitestから直接テストできる。
//
// 処理順序（【会社別OAuth接続対応で変更】）：
//   1. HTTPメソッド確認（POST以外はmethod_not_allowed）
//   2. 認証・権限確認（resolveConcurOAuthCheckAuthorization.js）
//      - 未認証 → unauthorized（401）
//      - platform_adminでない → forbidden（403）。この時点でVault関連の
//        getRefreshTokenForEdge/completeOAuthRefreshは一切呼ばれない。
//   3. リクエスト本文のJSON解析（invalid_json）・companyCode検証
//      （validateConcurOAuthCheckRequest.js。concur_oauth_check_invalid_request）。
//      安全ゲートの確認より前に行う（不正な入力に対して無駄なVault呼び出しを
//      発生させないため。ただし実際のRPC呼び出しはまだ発生しない）。
//   4. 安全ゲート確認（isConcurOAuthCheckEnabled.js）
//      CONCUR_OAUTH_CHECK_ENABLEDが厳密に"true"でない場合は、
//      resolveOAuthCompanyId・Vault RPC・refreshConcurAccessToken()を
//      一切呼ばず、{ connected: false, status: "disabled" } を返す（200）。
//   5. resolveOAuthCompanyId({ userId, companyCode })
//      （service_role専用RPC resolve_concur_oauth_company_id相当。
//      supabase/schema.sql参照）で、手順2で検証済みのauthResult.user.idと
//      手順3で検証済みのcompanyCodeから、対象会社のConcur OAuth Vault接続
//      識別子（concur_oauth_connections.company_id、Supabase内部UUID）を
//      解決する。クライアントからcompany UUIDを直接受け取る経路は無い
//      （リクエストスキーマにそのようなフィールドは存在しない）。未解決
//      （platform_adminがその会社のcompany_membersに存在しない場合を含む。
//      理由は区別しない）の場合はconcur_oauth_not_connectedを返し、
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
//   9. 成功した場合：completeOAuthRefresh({success:true, newRefreshToken})を
//      呼ぶ（rotated:falseならnewRefreshTokenはnull）。
//      - trueが返れば、保存成功として初めてconnected:trueを返す
//      - falseが返れば（lease不一致＝リースが既に別処理へ引き継がれていた）
//        concur_oauth_completion_failedを返す
//      - 例外が発生すれば（Vault更新自体が失敗）concur_oauth_storage_failed
//        を返す
//  10. 保存成功後、evaluateConcurRequiredScopes.jsでAccess Tokenのscopeに
//      quickexpense.writeonly／user.read／identity.user.ids.read／
//      【Phase 14で追加】receipts.writeonly（画像付きQuick Expense作成に
//      必要、公式Scope Usageテーブルで確認済み）が実際に含まれているかを
//      真偽値だけで判定し、成功レスポンスへ含める（Quick Expense API・
//      Identity APIへの実通信前チェック。scope全文・他のスコープ名は
//      一切含めない）。receipts.writeonlyはこの時点ではまだ「確認できる
//      ようにする」だけで、画像添付Quick Expense自体の実装・実通信は
//      まだ行わない。
//
// request bodyはcompanyCode以外一切読み取らない・使わない（認証情報・
// token URL・Refresh Tokenは全てSecrets/Vault由来であり、フロントから
// 送られた値を信用する余地自体が存在しない）。
//
// このFunctionが返しうるエラーコード：
//   - method_not_allowed              … POST以外のメソッド
//   - unauthorized                    … 未認証
//   - forbidden                       … platform_adminでない
//   - invalid_json                    … リクエストボディがJSONとして解析できない
//   - concur_oauth_check_invalid_request … companyCodeが不正・未指定
//   - concur_not_configured           … 必須Secrets不足、またはrefreshToken未取得
//   - concur_oauth_timeout            … token endpointのタイムアウト
//   - concur_oauth_network_error      … 通信失敗
//   - concur_oauth_rejected           … 認証情報・Refresh Tokenが拒否された
//   - concur_oauth_rate_limited       … 429
//   - concur_oauth_service_error      … 5xx
//   - concur_oauth_invalid_response   … 2xxだが形式不正
//   - concur_oauth_not_connected      … 対象会社UUIDが未解決、対象接続が無い、
//                                        またはロック中（いずれも区別しない）
//   - concur_oauth_completion_failed  … 完了RPCがfalse（lease不一致。想定外の競合）
//   - concur_oauth_storage_failed     … 完了RPCが例外（Vault更新自体が失敗）
//   - internal_error                  … 上記以外の予期しない例外
import { resolveConcurOAuthCheckAuthorization } from "./resolveConcurOAuthCheckAuthorization.js";
import { isConcurOAuthCheckEnabled } from "./isConcurOAuthCheckEnabled.js";
import { validateConcurOAuthCheckRequest } from "./validateConcurOAuthCheckRequest.js";
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
 * @param {() => Promise<unknown>} input.parseBody リクエストボディをJSONとして
 *   読み取る非同期関数（Denoでは () => req.json()）。JSONとして解析できない
 *   場合は例外を投げる想定。
 * @param {(authHeader: string) => Promise<object|null>} input.fetchUser
 * @param {(user: object) => Promise<boolean>} input.isPlatformAdmin
 * @param {Record<string, string|undefined>} input.env
 * @param {(input: { userId: string, companyCode: string }) => Promise<string|null>} input.resolveOAuthCompanyId
 *   Concur OAuth Vault接続の会社境界（concur_oauth_connections.company_id）を
 *   解決する、service_role専用RPC（resolve_concur_oauth_company_id。
 *   supabase/schema.sql参照）の呼び出し。安全ゲートがtrueの場合だけ呼ばれる。
 *   userIdはauthResult.user.id（fetchUserで検証済み）、companyCodeは
 *   validateConcurOAuthCheckRequest.jsで検証済みの値を渡す。対象の所属が
 *   無ければnullを返す想定。この関数の外部入力パラメータとしての
 *   companyId（Vault接続識別子そのもの）は存在しない（以前は呼び出し元が
 *   companyIdを直接渡せたが、常にnull固定で呼ばれており、会社別接続対応後は
 *   cross-company接続混在のリスクがあったため廃止した）。
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
  parseBody,
  fetchUser,
  isPlatformAdmin,
  env,
  resolveOAuthCompanyId,
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

  let rawBody;
  try {
    rawBody = await parseBody();
  } catch {
    // リクエスト本文自体はログへ出さない（機密情報を含みうるため）。
    return respondWithLocalCode("invalid_json");
  }

  const inputValidation = validateConcurOAuthCheckRequest(rawBody);
  if (!inputValidation.ok) {
    return respondWithLocalCode("concur_oauth_check_invalid_request");
  }
  const { companyCode } = inputValidation;

  // 200を返す理由：認証・認可は正しく通過しており、リクエスト自体は正常に
  // 処理できている。「安全ゲートが無効なので疎通確認していない」という
  // 正しい状態を返しているだけであり、リクエスト側の誤り（4xx）でも
  // サーバー側の障害（5xx）でもない。error: nullのresultとして返すことで、
  // このプロジェクト全体の{result, error}という統一レスポンス形式とも
  // 整合させ、connected:trueの成功時と明確に区別できるようにしている。
  if (!isConcurOAuthCheckEnabled(env)) {
    return { status: 200, body: { result: { connected: false, status: "disabled" }, error: null } };
  }

  // 会社境界（重要）：Vaultから取得するRefresh Tokenの対象会社は、必ず
  // resolveOAuthCompanyId({ userId, companyCode })が、authResult.user.id
  // （手順2で検証済み）とcompanyCode（手順3で検証済み）から解決した
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
