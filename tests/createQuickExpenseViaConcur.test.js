import { describe, it, expect } from "vitest";
import { createQuickExpenseViaConcur } from "../supabase/functions/create-concur-quick-expense/createQuickExpenseViaConcur.js";

// createQuickExpenseViaConcur()は、_shared/concur-quick-expense/createConcurQuickExpense.js
// （実際にConcur Quick Expense v4 APIへfetchする実装）へのアダプタ。
// index.tsからはまだ注入されていない（createQuickExpenseStub.jsのままである）ため、
// このテストで実fetchが発生することは無い（fetchImplを常にモックへ差し替える）。
const DUMMY_ACCESS_TOKEN = "DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK";
const DUMMY_GEOLOCATION = "https://example-dummy.concursolutions.test";
const DUMMY_USER_ID = "3df11695-e8bb-40ff-8e98-c85913ab2789";
const DUMMY_QUICK_EXPENSE_ID_URI = `${DUMMY_GEOLOCATION}/quickexpense/v4/users/${DUMMY_USER_ID}/context/TRAVELER/quickexpenses/dummy-id`;

function jsonFetch(status, body) {
  return async () => ({ status, json: async () => body });
}

function buildValidatedPayload(overrides = {}) {
  return {
    expenseTypeId: "MEAL",
    transactionDate: "2026-07-28",
    amount: 1000,
    currencyCode: "JPY",
    vendorName: null,
    memo: null,
    ...overrides,
  };
}

function buildContext(overrides = {}) {
  return {
    accessToken: DUMMY_ACCESS_TOKEN,
    geolocation: DUMMY_GEOLOCATION,
    userId: DUMMY_USER_ID,
    ...overrides,
  };
}

describe("createQuickExpenseViaConcur（成功系）", () => {
  it("必要な引数をそのままcreateConcurQuickExpense()へ渡し、成功結果を{quickExpenseId, status}へ変換する", async () => {
    const { result, error } = await createQuickExpenseViaConcur(
      buildValidatedPayload(),
      buildContext({ fetchImpl: jsonFetch(201, { quickExpenseIdUri: DUMMY_QUICK_EXPENSE_ID_URI }) }),
    );

    expect(error).toBeNull();
    expect(result).toEqual({ quickExpenseId: DUMMY_QUICK_EXPENSE_ID_URI, status: "created" });
  });

  it("contextTypeは常にTRAVELERで呼び出す（公式仕様どおり）", async () => {
    let capturedUrl;
    const fetchImpl = async (url) => {
      capturedUrl = url;
      return { status: 201, json: async () => ({ quickExpenseIdUri: DUMMY_QUICK_EXPENSE_ID_URI }) };
    };

    await createQuickExpenseViaConcur(buildValidatedPayload(), buildContext({ fetchImpl }));

    expect(capturedUrl).toContain("/context/TRAVELER/");
  });
});

describe("createQuickExpenseViaConcur（失敗系）", () => {
  it("Identity API/Vault連携由来のエラーコードをそのまま透過する（400→invalid_request）", async () => {
    const { result, error } = await createQuickExpenseViaConcur(
      buildValidatedPayload(),
      buildContext({ fetchImpl: jsonFetch(400, {}) }),
    );

    expect(result).toBeNull();
    expect(error.code).toBe("concur_quick_expense_invalid_request");
  });

  it("403はconcur_quick_expense_rejectedを透過する", async () => {
    const { error } = await createQuickExpenseViaConcur(buildValidatedPayload(), buildContext({ fetchImpl: jsonFetch(403, {}) }));
    expect(error.code).toBe("concur_quick_expense_rejected");
  });

  it("userIdが無い場合はfetchを呼ばずconcur_quick_expense_invalid_requestを返す", async () => {
    let fetchCalled = false;
    const fetchImpl = async () => {
      fetchCalled = true;
      return { status: 201, json: async () => ({ quickExpenseIdUri: DUMMY_QUICK_EXPENSE_ID_URI }) };
    };

    const { error } = await createQuickExpenseViaConcur(buildValidatedPayload(), buildContext({ userId: undefined, fetchImpl }));

    expect(error.code).toBe("concur_quick_expense_invalid_request");
    expect(fetchCalled).toBe(false);
  });
});

describe("createQuickExpenseViaConcur（非露出）", () => {
  it("Access Tokenの値が戻り値へ一切含まれない（成功・失敗いずれも）", async () => {
    const success = await createQuickExpenseViaConcur(
      buildValidatedPayload(),
      buildContext({ fetchImpl: jsonFetch(201, { quickExpenseIdUri: DUMMY_QUICK_EXPENSE_ID_URI }) }),
    );
    const failure = await createQuickExpenseViaConcur(
      buildValidatedPayload({ vendorName: "Should Not Leak Vendor" }),
      buildContext({ fetchImpl: jsonFetch(500, { debug: "RAW_RESPONSE_SHOULD_NOT_LEAK" }) }),
    );

    const serialized = `${JSON.stringify(success)} ${JSON.stringify(failure)}`;
    expect(serialized).not.toContain(DUMMY_ACCESS_TOKEN);
    expect(serialized).not.toContain("RAW_RESPONSE_SHOULD_NOT_LEAK");
    expect(serialized).not.toContain("Should Not Leak Vendor");
  });

  it("失敗結果にはuserId（Concur内部UUID）が含まれない（成功結果のquickExpenseIdはConcur公式仕様どおりuserIdを含むURIのため対象外）", async () => {
    const failure = await createQuickExpenseViaConcur(
      buildValidatedPayload(),
      buildContext({ fetchImpl: jsonFetch(500, { debug: "RAW_RESPONSE_SHOULD_NOT_LEAK" }) }),
    );

    expect(JSON.stringify(failure)).not.toContain(DUMMY_USER_ID);
  });

  it("成功結果にはquickExpenseId・statusだけが含まれる", async () => {
    const { result } = await createQuickExpenseViaConcur(
      buildValidatedPayload(),
      buildContext({ fetchImpl: jsonFetch(201, { quickExpenseIdUri: DUMMY_QUICK_EXPENSE_ID_URI, extraField: "Should Not Leak Extra" }) }),
    );

    expect(Object.keys(result).sort()).toEqual(["quickExpenseId", "status"]);
  });
});

describe("createQuickExpenseViaConcur（実通信防止・DI未配線の確認）", () => {
  it("fetchImplを注入しない限り、このテスト自体はグローバルfetchへ一切依存しない（常にモックを渡すことの確認）", async () => {
    // このテストはcreateQuickExpenseViaConcur自体を直接呼んでおり、
    // handleQuickExpenseRequest.js・index.tsのデフォルト配線からは
    // 呼び出されていない（デフォルトはcreateQuickExpenseStub.jsのまま）。
    const { error } = await createQuickExpenseViaConcur(
      buildValidatedPayload(),
      buildContext({ fetchImpl: jsonFetch(201, { quickExpenseIdUri: DUMMY_QUICK_EXPENSE_ID_URI }) }),
    );
    expect(error).toBeNull();
  });
});
