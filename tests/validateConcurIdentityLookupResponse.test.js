import { describe, it, expect } from "vitest";
import { validateConcurIdentityLookupResponse } from "../supabase/functions/_shared/concur-identity/validateConcurIdentityLookupResponse.js";

const VALID_USER_ID = "3df11695-e8bb-40ff-8e98-c85913ab2789";

function listResponse(resources) {
  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: resources.length,
    startIndex: 1,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

describe("validateConcurIdentityLookupResponse", () => {
  it("0件（Resources: []）はconcur_user_not_found", () => {
    const result = validateConcurIdentityLookupResponse(listResponse([]));
    expect(result).toEqual({ ok: false, code: "concur_user_not_found" });
  });

  it("1件かつidが有効な場合は成功しuserIdを返す", () => {
    const result = validateConcurIdentityLookupResponse(
      listResponse([{ id: VALID_USER_ID, userName: "user@example.com" }]),
    );
    expect(result).toEqual({ ok: true, userId: VALID_USER_ID });
  });

  it("複数件はconcur_user_ambiguous", () => {
    const result = validateConcurIdentityLookupResponse(
      listResponse([
        { id: VALID_USER_ID, userName: "user@example.com" },
        { id: "another-uuid", userName: "user2@example.com" },
      ]),
    );
    expect(result).toEqual({ ok: false, code: "concur_user_ambiguous" });
  });

  it("1件だがidが欠落している場合はconcur_identity_invalid_response（userID欠落）", () => {
    const result = validateConcurIdentityLookupResponse(listResponse([{ userName: "user@example.com" }]));
    expect(result).toEqual({ ok: false, code: "concur_identity_invalid_response" });
  });

  it("1件だがidが空文字の場合もconcur_identity_invalid_response", () => {
    const result = validateConcurIdentityLookupResponse(listResponse([{ id: "", userName: "user@example.com" }]));
    expect(result).toEqual({ ok: false, code: "concur_identity_invalid_response" });
  });

  it("Resourcesが配列でない場合はconcur_identity_invalid_response（resources配列不正）", () => {
    const result = validateConcurIdentityLookupResponse({ Resources: "not-an-array" });
    expect(result).toEqual({ ok: false, code: "concur_identity_invalid_response" });
  });

  it("Resources自体が存在しない場合もconcur_identity_invalid_response（0件と誤認しない）", () => {
    const result = validateConcurIdentityLookupResponse({ totalResults: 0 });
    expect(result).toEqual({ ok: false, code: "concur_identity_invalid_response" });
  });

  it("bodyがオブジェクトでない場合はconcur_identity_invalid_response", () => {
    expect(validateConcurIdentityLookupResponse(null)).toEqual({ ok: false, code: "concur_identity_invalid_response" });
    expect(validateConcurIdentityLookupResponse("string")).toEqual({ ok: false, code: "concur_identity_invalid_response" });
    expect(validateConcurIdentityLookupResponse(42)).toEqual({ ok: false, code: "concur_identity_invalid_response" });
  });

  it("bodyが配列そのものの場合もconcur_identity_invalid_response", () => {
    expect(validateConcurIdentityLookupResponse([])).toEqual({ ok: false, code: "concur_identity_invalid_response" });
  });

  it("1件のResources内オブジェクトがnullの場合もconcur_identity_invalid_response", () => {
    const result = validateConcurIdentityLookupResponse(listResponse([null]));
    expect(result).toEqual({ ok: false, code: "concur_identity_invalid_response" });
  });
});
