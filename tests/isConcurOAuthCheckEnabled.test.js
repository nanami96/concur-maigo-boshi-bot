import { describe, it, expect } from "vitest";
import { isConcurOAuthCheckEnabled } from "../supabase/functions/check-concur-oauth/isConcurOAuthCheckEnabled.js";

describe("isConcurOAuthCheckEnabled", () => {
  it("CONCUR_OAUTH_CHECK_ENABLED未設定の場合はfalse（安全側デフォルト）", () => {
    expect(isConcurOAuthCheckEnabled({})).toBe(false);
    expect(isConcurOAuthCheckEnabled(undefined)).toBe(false);
  });

  it("文字列\"false\"の場合はfalse", () => {
    expect(isConcurOAuthCheckEnabled({ CONCUR_OAUTH_CHECK_ENABLED: "false" })).toBe(false);
  });

  it("大文字小文字違い（\"TRUE\"）は一致とみなさずfalse", () => {
    expect(isConcurOAuthCheckEnabled({ CONCUR_OAUTH_CHECK_ENABLED: "TRUE" })).toBe(false);
  });

  it("真偽値true（文字列でない）はfalse", () => {
    expect(isConcurOAuthCheckEnabled({ CONCUR_OAUTH_CHECK_ENABLED: true })).toBe(false);
  });

  it("文字列\"true\"の場合だけtrue", () => {
    expect(isConcurOAuthCheckEnabled({ CONCUR_OAUTH_CHECK_ENABLED: "true" })).toBe(true);
  });
});
