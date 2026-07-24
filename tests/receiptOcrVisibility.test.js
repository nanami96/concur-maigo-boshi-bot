import { describe, it, expect } from "vitest";
import { shouldShowReceiptOcr } from "../src/lib/receiptOcrVisibility";

describe("shouldShowReceiptOcr", () => {
  it("enableReceiptOcrがfalseなら、receiptRequiredの値に関わらず常に非表示", () => {
    expect(shouldShowReceiptOcr({ enableReceiptOcr: false, receiptRequired: true })).toBe(false);
    expect(shouldShowReceiptOcr({ enableReceiptOcr: false, receiptRequired: false })).toBe(false);
    expect(shouldShowReceiptOcr({ enableReceiptOcr: false, receiptRequired: null })).toBe(false);
  });

  it("領収書「必要」（true）の場合は表示する", () => {
    expect(shouldShowReceiptOcr({ enableReceiptOcr: true, receiptRequired: true })).toBe(true);
  });

  it("領収書「不要」（false）の場合は非表示にする", () => {
    expect(shouldShowReceiptOcr({ enableReceiptOcr: true, receiptRequired: false })).toBe(false);
  });

  it("未設定（null/undefined）の場合は安全側に倒して表示する（勝手に不要とみなさない）", () => {
    expect(shouldShowReceiptOcr({ enableReceiptOcr: true, receiptRequired: null })).toBe(true);
    expect(shouldShowReceiptOcr({ enableReceiptOcr: true, receiptRequired: undefined })).toBe(true);
  });

  it("想定外の値（文字列等）の場合も安全側に倒して表示する", () => {
    expect(shouldShowReceiptOcr({ enableReceiptOcr: true, receiptRequired: "unknown" })).toBe(true);
  });
});
