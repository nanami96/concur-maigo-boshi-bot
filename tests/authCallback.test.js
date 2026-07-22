import { describe, it, expect } from "vitest";
import { hasPendingAuthCallback } from "../src/admin/authCallback";

describe("hasPendingAuthCallback", () => {
  it("PKCE flowの?code=クエリがある場合はtrue", () => {
    expect(hasPendingAuthCallback({ search: "?code=abc123", hash: "" })).toBe(true);
  });

  it("implicit flowの#access_token=がhashにある場合もtrue（保険）", () => {
    expect(hasPendingAuthCallback({ search: "", hash: "#access_token=xyz&type=magiclink" })).toBe(
      true,
    );
  });

  it("#adminだけの通常の管理画面遷移はfalse", () => {
    expect(hasPendingAuthCallback({ search: "", hash: "#admin" })).toBe(false);
  });

  it("codeでもtokenでもない別のクエリ・ハッシュはfalse", () => {
    expect(hasPendingAuthCallback({ search: "?foo=bar", hash: "#admin" })).toBe(false);
  });

  it("search・hashが省略された場合もエラーにならずfalse", () => {
    expect(hasPendingAuthCallback()).toBe(false);
    expect(hasPendingAuthCallback({})).toBe(false);
  });
});
