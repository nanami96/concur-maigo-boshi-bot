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
import { buildSafeIdentityRejectedDebugLog } from "./buildSafeIdentityRejectedDebugLog.js";

function failure(code) {
  return { ok: false, error: buildConcurIdentityLookupError(code) };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// 【一時的なデバッグログ・要削除】concur_identity_rejected（Identity APIが
// 401/403を返した場合）の原因調査のためだけに、buildSafeIdentityRejectedDebugLog.js
// で組み立てた「error・error_descriptionの2フィールドだけを安全に抽出した情報」
// を構造化オブジェクトとしてログへ渡す。デバッグが終わったら、この関数呼び出し
// 箇所ごと削除すること（下記lookupConcurUser()内の呼び出し箇所、およびこの
// 関数自体）。
//
// 【安全性について】ここで渡すのはstatus・bodyTextだけであり、こちらが送信した
// Access Token・Refresh Token・Client Secret・Authorizationヘッダーの値は
// 引数として一切渡していない・参照していない。bodyText自体（レスポンス本文の
// 生の値）はログへは出さず、buildSafeIdentityRejectedDebugLog.js内部で
// JSON解析・error/error_descriptionフィールドの抽出・サニタイズ（メール
// アドレス・UUID・長いトークンらしい部分文字列のredact等）にのみ使い、
// 抽出後の安全な値だけをログへ渡す。
function logRejectedIdentityLookupForDebug(log, status, bodyText, headers) {
  if (typeof log !== "function") {
    return;
  }
  try {
    const safeDetails = buildSafeIdentityRejectedDebugLog({ status, bodyText, headers });
    log("[DEBUG][concur_identity_rejected 一時デバッグ・要削除]", safeDetails);
  } catch {
    // ログ出力自体の失敗は本処理へ影響させない。
  }
}

/**
 * @param {object} input
 * @param {string} input.geolocation OAuth token応答のgeolocation値（Identity APIのベースURL）。
 * @param {string} input.accessToken 取得済みのAccess Token。
 * @param {string} input.userName 検索対象のConcurログインID（呼び出し元で検証済みであること）。
 * @param {typeof fetch} [input.fetchImpl] テスト用の差し替え。既定はグローバルfetch。
 * @param {number} [input.timeoutMs] token endpointへのfetchのタイムアウト（ミリ秒）。
 * @param {(message: string, details?: object) => void} [input.log] 【一時的なデバッグログ・要削除】
 *   concur_identity_rejected発生時に、安全に抽出・サニタイズ済みの情報
 *   （status・error・errorDescription等。buildSafeIdentityRejectedDebugLog.js参照）
 *   だけを構造化オブジェクトとして記録するために使う。指定しない場合は
 *   何もログ出力しない。
 * @returns {Promise<
 *   | { ok: true, userId: string }
 *   | { ok: false, error: { code: string, message: string } }
 * >}
 */
export async function lookupConcurUser({ geolocation, accessToken, userName, fetchImpl, timeoutMs, log }) {
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
    // 【一時的なデバッグログ・要削除】concur_identity_rejected（401/403）の
    // 場合だけ、原因調査のため許可リスト済みの安全な情報だけを記録する。
    // レスポンス本文自体は下のbuildSafeIdentityRejectedDebugLog()内でJSON解析・
    // サニタイズにのみ使い、ログへは出さない。
    // Access Token・Refresh Token・Client Secret等はここで一切参照しない。
    if (httpErrorCode === "concur_identity_rejected") {
      const responseHeaders = fetchResult.response.headers;
      try {
        const debugBodyText = await fetchResult.response.text();
        logRejectedIdentityLookupForDebug(log, fetchResult.response.status, debugBodyText, responseHeaders);
      } catch {
        logRejectedIdentityLookupForDebug(log, fetchResult.response.status, undefined, responseHeaders);
      }
    }
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
