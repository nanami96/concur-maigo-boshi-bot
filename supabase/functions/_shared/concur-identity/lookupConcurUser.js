// Concur Identity API（GET /profile/identity/v4/Users）でuserNameを条件に
// 利用者を検索する処理を1本化する呼び出し口。
// buildConcurIdentityLookupRequest.js（リクエスト組み立て）→
// fetchConcurIdentityLookupResponse.js（タイムアウト付きfetch）→
// classifyConcurIdentityHttpStatus.js（HTTPレスポンス分類）→
// validateConcurIdentityLookupResponse.js（レスポンス本文の検証・件数判定）
// の順で処理する（supabase/functions/_shared/concur-oauth/
// refreshConcurAccessToken.jsと同じ構成）。
//
// 【重要・Access Tokenの扱い】この関数はaccessTokenを引数として受け取るだけで、
// 保存・ログ出力は一切行わない。呼び出し元（lookup-concur-userの
// handleLookupConcurUserRequest.js）がConcur OAuthのRefresh Token Grantで
// 取得した一時的な値を渡し、この関数の呼び出しが終わればスコープを抜けて
// 破棄される（DB・Vault・Secretsのいずれにも保存しない）。
//
// 【重要・geolocationの扱い】Identity APIのベースURLは、OAuth token
// レスポンスのgeolocation値（例："https://us.api.concursolutions.com"）を
// そのまま使う。公式ドキュメント（OAuth2 apidoc.markdown）の記載どおり
// geolocationは「grant typeによっては返らない場合がある」任意項目のため、
// 値が無い場合はConcur側と一切通信せず、安全に失敗させる
// （concur_identity_geolocation_missing。本番運用時にこの状態が続く場合は
// OAuthアプリ設定・token応答の内容を確認する必要がある）。
import { buildConcurIdentityLookupRequest } from "./buildConcurIdentityLookupRequest.js";
import { fetchConcurIdentityLookupResponse } from "./fetchConcurIdentityLookupResponse.js";
import { classifyConcurIdentityHttpStatus } from "./classifyConcurIdentityHttpStatus.js";
import { validateConcurIdentityLookupResponse } from "./validateConcurIdentityLookupResponse.js";
import { buildConcurIdentityLookupError } from "./classifyConcurIdentityLookupError.js";

function failure(code) {
  return { ok: false, error: buildConcurIdentityLookupError(code) };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * @param {object} input
 * @param {string} input.geolocation OAuth token応答のgeolocation値（Identity APIのベースURL）。
 * @param {string} input.accessToken 取得済みのAccess Token。
 * @param {string} input.userName 検索対象のConcurログインID（呼び出し元で検証済みであること）。
 * @param {typeof fetch} [input.fetchImpl] テスト用の差し替え。既定はグローバルfetch。
 * @param {number} [input.timeoutMs] token endpointへのfetchのタイムアウト（ミリ秒）。
 * @returns {Promise<
 *   | { ok: true, userId: string }
 *   | { ok: false, error: { code: string, message: string } }
 * >}
 */
export async function lookupConcurUser({ geolocation, accessToken, userName, fetchImpl, timeoutMs }) {
  if (!isNonEmptyString(geolocation)) {
    return failure("concur_identity_geolocation_missing");
  }

  const request = buildConcurIdentityLookupRequest({ geolocation, accessToken, userName });

  const fetchResult = await fetchConcurIdentityLookupResponse({
    request,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  });

  if (fetchResult.outcome === "timeout") {
    return failure("concur_identity_timeout");
  }

  if (fetchResult.outcome === "network_error") {
    return failure("concur_identity_network_error");
  }

  const httpErrorCode = classifyConcurIdentityHttpStatus(fetchResult.response.status);
  if (httpErrorCode) {
    return failure(httpErrorCode);
  }

  let rawBody;
  try {
    rawBody = await fetchResult.response.json();
  } catch {
    // レスポンス本文がJSONとして解析できない場合。生の本文はログへ出さない。
    return failure("concur_identity_invalid_response");
  }

  const validation = validateConcurIdentityLookupResponse(rawBody);
  if (!validation.ok) {
    return failure(validation.code);
  }

  return { ok: true, userId: validation.userId };
}
