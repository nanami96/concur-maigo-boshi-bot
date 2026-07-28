import { describe, it, expect } from "vitest";
import { describeAuthHeaderForLogging } from "../supabase/functions/create-concur-quick-expense/describeAuthHeaderForLogging.js";

describe("describeAuthHeaderForLogging", () => {
  it("ヘッダーが無い場合はその旨だけを返す", () => {
    expect(describeAuthHeaderForLogging(null)).toBe("Authorizationヘッダーなし");
    expect(describeAuthHeaderForLogging(undefined)).toBe("Authorizationヘッダーなし");
    expect(describeAuthHeaderForLogging("")).toBe("Authorizationヘッダーなし");
  });

  it("Bearer形式のトークンの場合、有無・形式・文字数だけを返し、トークン本体は含まない", () => {
    const secretToken = "eyJhbGciOiJIUzI1NiJ9.SECRET_PAYLOAD_SHOULD_NOT_LEAK.signature";
    const description = describeAuthHeaderForLogging(`Bearer ${secretToken}`);

    expect(description).toContain("Authorizationヘッダーあり");
    expect(description).toContain("Bearer形式=true");
    expect(description).toContain(`トークン長=${secretToken.length}`);
    expect(description).not.toContain(secretToken);
    expect(description).not.toContain("SECRET_PAYLOAD_SHOULD_NOT_LEAK");
  });

  it("Bearer形式でない場合はBearer形式=falseを返し、値自体は含まない", () => {
    const rawValue = "sb_publishable_SOME_OPAQUE_VALUE";
    const description = describeAuthHeaderForLogging(rawValue);

    expect(description).toContain("Bearer形式=false");
    expect(description).not.toContain(rawValue);
    expect(description).not.toContain("SOME_OPAQUE_VALUE");
  });
});
