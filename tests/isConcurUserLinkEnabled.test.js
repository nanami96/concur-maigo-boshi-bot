import { describe, it, expect } from "vitest";
import { isConcurUserLinkEnabled } from "../supabase/functions/link-concur-user/isConcurUserLinkEnabled.js";

describe("isConcurUserLinkEnabled", () => {
  it("CONCUR_USER_LINK_ENABLED未設定の場合はfalse（安全側デフォルト）", () => {
    expect(isConcurUserLinkEnabled({})).toBe(false);
    expect(isConcurUserLinkEnabled(undefined)).toBe(false);
  });

  it("文字列\"false\"の場合はfalse", () => {
    expect(isConcurUserLinkEnabled({ CONCUR_USER_LINK_ENABLED: "false" })).toBe(false);
  });

  it("大文字小文字違い（\"TRUE\"）は一致とみなさずfalse", () => {
    expect(isConcurUserLinkEnabled({ CONCUR_USER_LINK_ENABLED: "TRUE" })).toBe(false);
  });

  it("真偽値true（文字列でない）はfalse", () => {
    expect(isConcurUserLinkEnabled({ CONCUR_USER_LINK_ENABLED: true })).toBe(false);
  });

  it("文字列\"true\"の場合だけtrue", () => {
    expect(isConcurUserLinkEnabled({ CONCUR_USER_LINK_ENABLED: "true" })).toBe(true);
  });

  it("CONCUR_QUICK_EXPENSE_ENABLED・CONCUR_IDENTITY_LOOKUP_ENABLEDが\"true\"でも、このFunction専用のフラグとは無関係（流用しない）", () => {
    expect(isConcurUserLinkEnabled({ CONCUR_QUICK_EXPENSE_ENABLED: "true" })).toBe(false);
    expect(isConcurUserLinkEnabled({ CONCUR_IDENTITY_LOOKUP_ENABLED: "true" })).toBe(false);
  });
});
