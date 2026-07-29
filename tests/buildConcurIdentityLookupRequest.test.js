import { describe, it, expect } from "vitest";
import { buildConcurIdentityLookupRequest } from "../supabase/functions/_shared/concur-identity/buildConcurIdentityLookupRequest.js";

describe("buildConcurIdentityLookupRequest", () => {
  it("正式なIdentity v4のURL（/profile/identity/v4/Users）を組み立てる", () => {
    const request = buildConcurIdentityLookupRequest({
      geolocation: "https://us.api.concursolutions.com",
      accessToken: "dummy-access-token",
      userName: "user@example.com",
    });

    const url = new URL(request.url);
    expect(url.origin).toBe("https://us.api.concursolutions.com");
    expect(url.pathname).toBe("/profile/identity/v4/Users");
  });

  it("geolocationの末尾スラッシュを二重にしない", () => {
    const request = buildConcurIdentityLookupRequest({
      geolocation: "https://us.api.concursolutions.com/",
      accessToken: "dummy-access-token",
      userName: "user@example.com",
    });

    expect(request.url.startsWith("https://us.api.concursolutions.com/profile/identity/v4/Users?")).toBe(true);
    expect(request.url).not.toContain("com//profile");
  });

  it("methodはGET", () => {
    const request = buildConcurIdentityLookupRequest({
      geolocation: "https://us.api.concursolutions.com",
      accessToken: "dummy-access-token",
      userName: "user@example.com",
    });

    expect(request.method).toBe("GET");
  });

  it("Authorization: Bearer {token}ヘッダーを組み立てる", () => {
    const request = buildConcurIdentityLookupRequest({
      geolocation: "https://us.api.concursolutions.com",
      accessToken: "dummy-access-token-value",
      userName: "user@example.com",
    });

    expect(request.headers.Authorization).toBe("Bearer dummy-access-token-value");
  });

  it("filter=userName eq \"value\"をURLSearchParams経由で安全にエンコードする", () => {
    const request = buildConcurIdentityLookupRequest({
      geolocation: "https://us.api.concursolutions.com",
      accessToken: "dummy-access-token",
      userName: "user@example.com",
    });

    const url = new URL(request.url);
    expect(url.searchParams.get("filter")).toBe('userName eq "user@example.com"');
  });

  it("attributes=idを指定し、Concur側からidだけを返させる（不要なPIIを要求しない）", () => {
    const request = buildConcurIdentityLookupRequest({
      geolocation: "https://us.api.concursolutions.com",
      accessToken: "dummy-access-token",
      userName: "user@example.com",
    });

    const url = new URL(request.url);
    expect(url.searchParams.get("attributes")).toBe("id");
  });

  it("count=2を指定する（複数件ヒットの検出のため、1件に丸めない）", () => {
    const request = buildConcurIdentityLookupRequest({
      geolocation: "https://us.api.concursolutions.com",
      accessToken: "dummy-access-token",
      userName: "user@example.com",
    });

    const url = new URL(request.url);
    expect(url.searchParams.get("count")).toBe("2");
  });

  it("userName値にダブルクォート・バックスラッシュが含まれる場合、SCIM filter構文としてエスケープする", () => {
    const request = buildConcurIdentityLookupRequest({
      geolocation: "https://us.api.concursolutions.com",
      accessToken: "dummy-access-token",
      userName: 'weird"name\\value',
    });

    const url = new URL(request.url);
    expect(url.searchParams.get("filter")).toBe('userName eq "weird\\"name\\\\value"');
  });

  it("生成したURLは手動文字列連結によるインジェクションが起きない（URLとして正しくパースできる）", () => {
    const request = buildConcurIdentityLookupRequest({
      geolocation: "https://us.api.concursolutions.com",
      accessToken: "dummy-access-token",
      userName: '" or 1=1 --',
    });

    // URLコンストラクタが例外を投げない＝有効なURLとして構築できていることを確認する。
    expect(() => new URL(request.url)).not.toThrow();
    const url = new URL(request.url);
    expect(url.searchParams.get("filter")).toBe('userName eq "\\" or 1=1 --"');
  });

  it("Access Token実値がURLへ含まれない（ヘッダーだけに載る）", () => {
    const request = buildConcurIdentityLookupRequest({
      geolocation: "https://us.api.concursolutions.com",
      accessToken: "SHOULD_NOT_APPEAR_IN_URL",
      userName: "user@example.com",
    });

    expect(request.url).not.toContain("SHOULD_NOT_APPEAR_IN_URL");
  });
});
