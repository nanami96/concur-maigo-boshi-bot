import { describe, it, expect } from "vitest";
import { generateConcurCorrelationId } from "../supabase/functions/_shared/concur-quick-expense/generateConcurCorrelationId.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("generateConcurCorrelationId", () => {
  it("RFC4122形式のUUIDを返す", () => {
    expect(generateConcurCorrelationId()).toMatch(UUID_PATTERN);
  });

  it("呼び出すたびに異なる値を返す（リクエストごとに新しいUUID）", () => {
    const first = generateConcurCorrelationId();
    const second = generateConcurCorrelationId();
    expect(first).not.toBe(second);
  });

  it("userID・経費内容・Access Token等を一切含まない（単なるランダムなUUID）", () => {
    const value = generateConcurCorrelationId();
    expect(value.length).toBe(36);
    expect(value).not.toMatch(/[^0-9a-f-]/i);
  });
});
