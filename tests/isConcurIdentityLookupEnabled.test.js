import { describe, it, expect } from "vitest";
import { isConcurIdentityLookupEnabled } from "../supabase/functions/lookup-concur-user/isConcurIdentityLookupEnabled.js";

describe("isConcurIdentityLookupEnabled", () => {
  it("CONCUR_IDENTITY_LOOKUP_ENABLED未設定の場合はfalse（安全側デフォルト）", () => {
    expect(isConcurIdentityLookupEnabled({})).toBe(false);
    expect(isConcurIdentityLookupEnabled(undefined)).toBe(false);
  });

  it("文字列\"false\"の場合はfalse", () => {
    expect(isConcurIdentityLookupEnabled({ CONCUR_IDENTITY_LOOKUP_ENABLED: "false" })).toBe(false);
  });

  it("大文字小文字違い（\"TRUE\"）は一致とみなさずfalse", () => {
    expect(isConcurIdentityLookupEnabled({ CONCUR_IDENTITY_LOOKUP_ENABLED: "TRUE" })).toBe(false);
  });

  it("真偽値true（文字列でない）はfalse", () => {
    expect(isConcurIdentityLookupEnabled({ CONCUR_IDENTITY_LOOKUP_ENABLED: true })).toBe(false);
  });

  it("文字列\"true\"の場合だけtrue", () => {
    expect(isConcurIdentityLookupEnabled({ CONCUR_IDENTITY_LOOKUP_ENABLED: "true" })).toBe(true);
  });

  it("CONCUR_OAUTH_CHECK_ENABLEDが\"true\"でも、このFunction専用のフラグとは無関係（流用しない）", () => {
    expect(isConcurIdentityLookupEnabled({ CONCUR_OAUTH_CHECK_ENABLED: "true" })).toBe(false);
  });
});
