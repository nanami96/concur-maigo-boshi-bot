// Identity API（GET /profile/identity/v4/Users）が2xxで返したJSON本文
// （パース済み）を検証し、「0件／1件／複数件」を判定する純粋関数。
//
// 【根拠（公式ドキュメントのみ、v4.identity.md）】
// 一覧応答の形（引用）：
//   {
//     "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
//     "totalResults": 107705,
//     "startIndex": 1,
//     "itemsPerPage": 20,
//     "Resources": [ {User 1 …}, {User 2…}, … ]
//   }
// 各利用者オブジェクトのユニークID：
//   "id"|"string"|-|"**Read Only** Unique identifier for the user, also
//   known as the UUID."
//
// 本関数はResources配列の件数だけを見て判定する（totalResultsは参考情報
// として存在するが、実際に返ってきた配列の件数を正とする。もし
// totalResultsとResources.lengthが食い違う応答が来ても、実際に読める
// データ（Resources）だけを信用する）。
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * @param {unknown} body Identity APIレスポンスをJSON.parseした値。
 * @returns {
 *   | { ok: true, userId: string }
 *   | { ok: false, code: "concur_user_not_found" | "concur_user_ambiguous" | "concur_identity_invalid_response" }
 * }
 */
export function validateConcurIdentityLookupResponse(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, code: "concur_identity_invalid_response" };
  }

  const resources = body.Resources;
  if (!Array.isArray(resources)) {
    return { ok: false, code: "concur_identity_invalid_response" };
  }

  if (resources.length === 0) {
    return { ok: false, code: "concur_user_not_found" };
  }

  if (resources.length > 1) {
    return { ok: false, code: "concur_user_ambiguous" };
  }

  const [resource] = resources;
  if (!resource || typeof resource !== "object" || !isNonEmptyString(resource.id)) {
    return { ok: false, code: "concur_identity_invalid_response" };
  }

  return { ok: true, userId: resource.id };
}
