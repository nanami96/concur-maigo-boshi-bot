// SAP Concur Quick Expense v4 API（画像無し版：
// POST /quickexpense/v4/users/{userID}/context/{contextType}/quickexpenses）の
// リクエストを組み立てる純粋関数。fetchは行わない
// （fetchConcurQuickExpenseResponse.jsの責務）。
//
// 【対象外について】
// 画像添付版（POST .../quickexpenses/image、multipart/form-data）は
// 今回の実装対象外（このモジュール・本ディレクトリはJSON本文のみの
// バリアントだけを扱う）。
//
// 【根拠（公式ドキュメントのみ）】
// SAP-docs/preview.developer.concur.com
// api-reference/expense/quick-expense/v4.quick-expense.md：
//   - エンドポイント: `POST https://{datacenterURI}/quickexpense/v4/users/{userID}/context/{contextType}/quickexpenses`
//   - Authorizationヘッダー: "Bearer Token that identifies the caller.
//     This is the Company or User access token."
//   - Headers節にContent-Type（RFC 7231）が汎用的に記載されているが、
//     具体的な値までは明記されていない。本文がJSONであるため、この実装では
//     application/jsonを明示する（Concur固有の要求ではなく、JSON本文を
//     送る際の標準的なHTTP実装判断）。
//   - ベースURL（geolocation）: OAuth token応答のgeolocation値をそのまま
//     使う（他のConcur API呼び出し（Identity等）と同じ方針。固定のURLを
//     決め打ちしない）。
//
// userID・contextTypeはパスセグメントへ直接埋め込むため、念のため
// encodeURIComponentでエスケープする（公式ドキュメントが要求している
// わけではないが、パス injectionを防ぐ一般的な実装上の配慮）。
function stripTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/**
 * @param {object} input
 * @param {string} input.geolocation OAuth token応答のgeolocation値（Quick Expense APIのベースURL）。
 * @param {string} input.accessToken 取得済みのAccess Token。
 * @param {string} input.userId 呼び出し元が解決済みのConcur userID（このモジュールは検証・取得を行わない）。
 * @param {string} input.contextType validateConcurQuickExpenseRequest.jsが返す値（現時点で唯一"TRAVELER"）。
 * @param {object} input.quickExpenseBody validateConcurQuickExpenseRequest.jsが返す、公式Request Body形式のオブジェクト。
 * @returns {{ url: string, method: "POST", headers: Record<string,string>, body: string }}
 */
export function buildConcurQuickExpenseRequest({ geolocation, accessToken, userId, contextType, quickExpenseBody }) {
  const encodedUserId = encodeURIComponent(userId);
  const encodedContextType = encodeURIComponent(contextType);
  const url = `${stripTrailingSlash(geolocation)}/quickexpense/v4/users/${encodedUserId}/context/${encodedContextType}/quickexpenses`;

  return {
    url,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(quickExpenseBody),
  };
}
