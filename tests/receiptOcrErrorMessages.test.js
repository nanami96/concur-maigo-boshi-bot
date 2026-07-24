import { describe, it, expect } from "vitest";
import { resolveOcrErrorMessage } from "../src/receiptOcrErrorMessages";

describe("resolveOcrErrorMessage", () => {
  it("エラーが無ければnull", () => {
    expect(resolveOcrErrorMessage(null)).toBeNull();
  });

  it("サーバーからmessageが提供されている場合はそれをそのまま使う", () => {
    expect(resolveOcrErrorMessage({ type: "invalid_file", message: "サーバー側のメッセージ" })).toBe(
      "サーバー側のメッセージ",
    );
  });

  it.each([
    "invalid_file",
    "unauthorized",
    "forbidden",
    "azure_error",
    "analysis_failed",
    "timeout",
    "bad_request",
    "method_not_allowed",
    "network",
    "unknown",
  ])("messageが無い場合、種別「%s」に対して空でない日本語メッセージへフォールバックする", (type) => {
    const message = resolveOcrErrorMessage({ type, message: null });
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
  });

  it("未知の種別・messageも無い場合はunknown向けメッセージにフォールバックする", () => {
    expect(resolveOcrErrorMessage({ type: "something-else", message: null })).toBe(
      resolveOcrErrorMessage({ type: "unknown", message: null }),
    );
  });
});
