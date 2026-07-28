import { describe, it, expect } from "vitest";
import { validateQuickExpenseRequest } from "../supabase/functions/create-concur-quick-expense/validateQuickExpenseRequest.js";

function buildValidBody(overrides = {}) {
  return {
    companyId: "company-a",
    policyId: "policy-x",
    botExpenseTypeId: "taxi",
    concurExpenseTypeId: "CONCUR_TAXI_A_X",
    transactionDate: "2026-07-28",
    amount: 1000,
    currencyCode: "JPY",
    receiptRequired: true,
    ...overrides,
  };
}

describe("validateQuickExpenseRequest", () => {
  it("必須項目がすべて揃っていれば正規化した内容をresultで返す", () => {
    const { result, error } = validateQuickExpenseRequest(buildValidBody());

    expect(error).toBeNull();
    expect(result).toEqual({
      companyId: "company-a",
      policyId: "policy-x",
      botExpenseTypeId: "taxi",
      concurExpenseTypeId: "CONCUR_TAXI_A_X",
      transactionDate: "2026-07-28",
      amount: 1000,
      currencyCode: "JPY",
      receiptRequired: true,
      vendorName: null,
      memo: null,
    });
  });

  it("任意項目(vendorName・memo)が未指定でも正常に処理でき、指定されていれば結果に含まれる", () => {
    const withoutOptional = validateQuickExpenseRequest(buildValidBody());
    expect(withoutOptional.error).toBeNull();
    expect(withoutOptional.result.vendorName).toBeNull();
    expect(withoutOptional.result.memo).toBeNull();

    const withOptional = validateQuickExpenseRequest(
      buildValidBody({ vendorName: "株式会社あんしんネット21", memo: "タクシー代" }),
    );
    expect(withOptional.error).toBeNull();
    expect(withOptional.result.vendorName).toBe("株式会社あんしんネット21");
    expect(withOptional.result.memo).toBe("タクシー代");
  });

  it.each(["companyId", "policyId", "botExpenseTypeId", "concurExpenseTypeId"])(
    "%sが空文字の場合はvalidation_error（requiredの詳細付き）",
    (field) => {
      const { result, error } = validateQuickExpenseRequest(buildValidBody({ [field]: "" }));

      expect(result).toBeNull();
      expect(error.code).toBe("validation_error");
      expect(error.details).toContainEqual({ field, reason: "required" });
    },
  );

  it("transactionDateが無い場合はrequired", () => {
    const { error } = validateQuickExpenseRequest(buildValidBody({ transactionDate: undefined }));
    expect(error.details).toContainEqual({ field: "transactionDate", reason: "required" });
  });

  it.each(["2026/07/28", "07-28-2026", "2026-7-28", "2026-13-40", "not-a-date"])(
    "transactionDateの形式が不正(%s)な場合はinvalid_format",
    (invalidDate) => {
      const { error } = validateQuickExpenseRequest(buildValidBody({ transactionDate: invalidDate }));
      expect(error.details).toContainEqual({ field: "transactionDate", reason: "invalid_format" });
    },
  );

  it("amountが無い場合はrequired", () => {
    const { error } = validateQuickExpenseRequest(buildValidBody({ amount: undefined }));
    expect(error.details).toContainEqual({ field: "amount", reason: "required" });
  });

  it("amountが文字列の場合はinvalid_type", () => {
    const { error } = validateQuickExpenseRequest(buildValidBody({ amount: "1000" }));
    expect(error.details).toContainEqual({ field: "amount", reason: "invalid_type" });
  });

  it("amountがNaNの場合はinvalid_type", () => {
    const { error } = validateQuickExpenseRequest(buildValidBody({ amount: Number.NaN }));
    expect(error.details).toContainEqual({ field: "amount", reason: "invalid_type" });
  });

  it.each([0, -500])("amountが0以下(%i)の場合はinvalid_range", (amount) => {
    const { error } = validateQuickExpenseRequest(buildValidBody({ amount }));
    expect(error.details).toContainEqual({ field: "amount", reason: "invalid_range" });
  });

  it.each(["jpy", "JP", "JPY1", ""])("currencyCodeの形式が不正(%s)な場合はエラー", (currencyCode) => {
    const { error } = validateQuickExpenseRequest(buildValidBody({ currencyCode }));
    expect(error.code).toBe("validation_error");
    const detail = error.details.find((item) => item.field === "currencyCode");
    expect(detail).toBeDefined();
  });

  it("receiptRequiredが真偽値でない場合はrequired扱い", () => {
    const { error } = validateQuickExpenseRequest(buildValidBody({ receiptRequired: "true" }));
    expect(error.details).toContainEqual({ field: "receiptRequired", reason: "required" });
  });

  it("receiptRequiredがfalseでも正常に処理できる（falsyでも必須違反にしない）", () => {
    const { result, error } = validateQuickExpenseRequest(buildValidBody({ receiptRequired: false }));
    expect(error).toBeNull();
    expect(result.receiptRequired).toBe(false);
  });

  it("vendorName・memoが文字列以外の場合はinvalid_type", () => {
    const { error } = validateQuickExpenseRequest(buildValidBody({ vendorName: 123, memo: 456 }));
    expect(error.details).toContainEqual({ field: "vendorName", reason: "invalid_type" });
    expect(error.details).toContainEqual({ field: "memo", reason: "invalid_type" });
  });

  it("複数の問題が同時にある場合はdetailsにすべて含める", () => {
    const { error } = validateQuickExpenseRequest({ amount: 0, currencyCode: "jpy" });

    expect(error.code).toBe("validation_error");
    const fields = error.details.map((item) => item.field);
    expect(fields).toContain("companyId");
    expect(fields).toContain("policyId");
    expect(fields).toContain("botExpenseTypeId");
    expect(fields).toContain("concurExpenseTypeId");
    expect(fields).toContain("transactionDate");
    expect(fields).toContain("amount");
    expect(fields).toContain("currencyCode");
    expect(fields).toContain("receiptRequired");
  });

  it("本文がnull・配列・文字列など想定外の形でも例外にならない", () => {
    expect(validateQuickExpenseRequest(null).error.code).toBe("validation_error");
    expect(validateQuickExpenseRequest(undefined).error.code).toBe("validation_error");
    expect(validateQuickExpenseRequest([]).error.code).toBe("validation_error");
    expect(validateQuickExpenseRequest("not an object").error.code).toBe("validation_error");
  });

  it("入力値や内部情報をエラーメッセージにそのまま含めない", () => {
    const secretLike = "SECRET_VALUE_SHOULD_NOT_LEAK";
    const { error } = validateQuickExpenseRequest(buildValidBody({ currencyCode: secretLike }));

    expect(error.message).not.toContain(secretLike);
    expect(JSON.stringify(error.details)).not.toContain(secretLike);
  });
});
