import { describe, it, expect, vi, afterEach } from "vitest";
import { createQuickExpenseStub } from "../supabase/functions/create-concur-quick-expense/createQuickExpenseStub.js";

describe("createQuickExpenseStub", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("固定のダミー結果を返す（result.statusに'stubbed'を含み、本物のAPI応答に見えない）", async () => {
    const { result, error } = await createQuickExpenseStub({
      companyId: "company-a",
      policyId: "policy-x",
      botExpenseTypeId: "taxi",
      concurExpenseTypeId: "CONCUR_TAXI_A_X",
      transactionDate: "2026-07-28",
      amount: 1000,
      currencyCode: "JPY",
      receiptRequired: false,
      vendorName: null,
      memo: null,
    });

    expect(error).toBeNull();
    expect(result).toEqual({ quickExpenseId: "stub_quick_expense_id", status: "stubbed" });
  });

  it("引数を渡さなくても例外にならない", async () => {
    const { result, error } = await createQuickExpenseStub(undefined);
    expect(error).toBeNull();
    expect(result.status).toBe("stubbed");
  });

  it("外部通信(fetch)を一切発生させない", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await createQuickExpenseStub({ companyId: "company-a" });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
