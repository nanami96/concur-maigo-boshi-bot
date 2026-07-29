import { describe, it, expect, vi } from "vitest";
import {
  computeRegistrationSignature,
  shouldRenderConcurRegistrationCard,
  shouldBlockConcurRegistrationSubmit,
  submitConcurRegistration,
  runConcurRegistrationSubmit,
} from "../src/concurRegistrationSubmission.js";

// createQuickExpense()（src/data/concurApi.js）の値はすべてテスト専用の
// ダミー値であり、実際のConcur側のコードではない。

function buildRegistrationData(overrides = {}) {
  return {
    companyId: "sample-company",
    policyId: "normal_expense",
    botExpenseTypeId: "taxi",
    concurExpenseTypeId: "TEST_TAXI",
    transactionDate: "2026-07-29",
    amount: 1200,
    currencyCode: "JPY",
    vendorName: "テスト商店",
    receiptRequired: true,
    memo: null,
    ...overrides,
  };
}

describe("computeRegistrationSignature", () => {
  it("registrationDataがnullの場合はnullを返す", () => {
    expect(computeRegistrationSignature(null)).toBeNull();
  });

  it("同じ内容のオブジェクトからは同じ署名を返す（別オブジェクトでも値が同じなら等しい）", () => {
    const a = computeRegistrationSignature(buildRegistrationData());
    const b = computeRegistrationSignature(buildRegistrationData());
    expect(a).toBe(b);
  });

  it("内容が異なれば署名も異なる（登録対象データが変わった場合の状態リセット判定に使う）", () => {
    const a = computeRegistrationSignature(buildRegistrationData());
    const b = computeRegistrationSignature(buildRegistrationData({ amount: 500 }));
    expect(a).not.toBe(b);
  });
});

describe("shouldRenderConcurRegistrationCard", () => {
  it("registrationDataがあり、errorが無ければtrue（正常データでボタンが表示される）", () => {
    expect(shouldRenderConcurRegistrationCard({ error: null, registrationData: buildRegistrationData() })).toBe(true);
  });

  it("errorがある場合はfalse（登録データ生成失敗時はボタンが表示されない）", () => {
    expect(
      shouldRenderConcurRegistrationCard({
        error: { type: "missing_company_id", message: "会社を特定できませんでした。" },
        registrationData: null,
      }),
    ).toBe(false);
  });

  it("registrationDataが無い場合はfalse", () => {
    expect(shouldRenderConcurRegistrationCard({ error: null, registrationData: null })).toBe(false);
  });
});

describe("shouldBlockConcurRegistrationSubmit", () => {
  it("submitting中はtrue", () => {
    expect(shouldBlockConcurRegistrationSubmit({ submitting: true, phase: "idle" })).toBe(true);
  });

  it("phaseがsuccessの場合はtrue（成功後は再送信できない）", () => {
    expect(shouldBlockConcurRegistrationSubmit({ submitting: false, phase: "success" })).toBe(true);
  });

  it("idle・errorの場合はfalse（エラー後に再試行できる）", () => {
    expect(shouldBlockConcurRegistrationSubmit({ submitting: false, phase: "idle" })).toBe(false);
    expect(shouldBlockConcurRegistrationSubmit({ submitting: false, phase: "error" })).toBe(false);
  });
});

describe("submitConcurRegistration", () => {
  it("スタブ成功時（result.status==='stubbed'）はphase:successを返す", async () => {
    const createQuickExpense = vi.fn().mockResolvedValue({
      result: { quickExpenseId: "stub_quick_expense_id", status: "stubbed" },
      error: null,
    });

    const outcome = await submitConcurRegistration({
      registrationData: buildRegistrationData(),
      createQuickExpense,
    });

    expect(outcome).toEqual({ phase: "success", errorType: null });
    expect(createQuickExpense).toHaveBeenCalledTimes(1);
  });

  it("isDev=trueの場合のみonStubSuccessが呼ばれる（一般利用者へは表示しない）", async () => {
    const createQuickExpense = vi.fn().mockResolvedValue({
      result: { quickExpenseId: "stub_quick_expense_id", status: "stubbed" },
      error: null,
    });
    const onStubSuccess = vi.fn();

    await submitConcurRegistration({ registrationData: buildRegistrationData(), createQuickExpense, isDev: true, onStubSuccess });
    expect(onStubSuccess).toHaveBeenCalledTimes(1);

    onStubSuccess.mockClear();
    await submitConcurRegistration({ registrationData: buildRegistrationData(), createQuickExpense, isDev: false, onStubSuccess });
    expect(onStubSuccess).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthorized"],
    ["forbidden"],
    ["validation_error"],
    ["network"],
    ["unknown"],
    ["mapping_not_found"],
    ["multiple_mappings_found"],
  ])("createQuickExpenseがerror.type=%sを返した場合、phase:errorとそのtypeを返す", async (type) => {
    const createQuickExpense = vi.fn().mockResolvedValue({ result: null, error: { type, message: "サーバー内のメッセージ" } });

    const outcome = await submitConcurRegistration({ registrationData: buildRegistrationData(), createQuickExpense });

    expect(outcome).toEqual({ phase: "error", errorType: type });
  });

  it("createQuickExpense自体が例外を投げても、phase:errorへ倒れる（固まらない）", async () => {
    const createQuickExpense = vi.fn().mockRejectedValue(new Error("network down"));
    const onUnexpectedError = vi.fn();

    const outcome = await submitConcurRegistration({
      registrationData: buildRegistrationData(),
      createQuickExpense,
      onUnexpectedError,
    });

    expect(outcome).toEqual({ phase: "error", errorType: null });
    expect(onUnexpectedError).toHaveBeenCalledTimes(1);
  });
});

describe("runConcurRegistrationSubmit（ボタン押下ロジック本体・二重送信防止含む）", () => {
  it("クリック時にcreateQuickExpense()が1回だけ呼ばれ、成功表示（phase:success）になる", async () => {
    const createQuickExpense = vi.fn().mockResolvedValue({
      result: { quickExpenseId: "stub_quick_expense_id", status: "stubbed" },
      error: null,
    });
    const submittingRef = { current: false };
    const onPhaseChange = vi.fn();
    const onErrorTypeChange = vi.fn();

    const outcome = await runConcurRegistrationSubmit({
      submittingRef,
      phase: "idle",
      registrationData: buildRegistrationData(),
      createQuickExpense,
      onPhaseChange,
      onErrorTypeChange,
    });

    expect(createQuickExpense).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ skipped: false, phase: "success", errorType: null });
    expect(onPhaseChange).toHaveBeenNthCalledWith(1, "submitting");
    expect(onPhaseChange).toHaveBeenNthCalledWith(2, "success");
    expect(onErrorTypeChange).toHaveBeenNthCalledWith(1, null);
    expect(submittingRef.current).toBe(false);
  });

  it("送信中はsubmittingRef.currentがtrueになる（ボタンdisabled判定に使う）", async () => {
    let resolveInvoke;
    const createQuickExpense = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveInvoke = resolve;
        }),
    );
    const submittingRef = { current: false };
    const onPhaseChange = vi.fn();

    const pending = runConcurRegistrationSubmit({
      submittingRef,
      phase: "idle",
      registrationData: buildRegistrationData(),
      createQuickExpense,
      onPhaseChange,
      onErrorTypeChange: vi.fn(),
    });

    // createQuickExpense呼び出し（await）に到達した直後の状態を確認する。
    await Promise.resolve();
    expect(submittingRef.current).toBe(true);
    expect(onPhaseChange).toHaveBeenCalledWith("submitting");

    resolveInvoke({ result: { quickExpenseId: "stub_quick_expense_id", status: "stubbed" }, error: null });
    await pending;
    expect(submittingRef.current).toBe(false);
  });

  it("二重クリックで二重送信されない（awaitせず連続で呼んでもcreateQuickExpense()は1回だけ）", async () => {
    let resolveInvoke;
    const createQuickExpense = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveInvoke = resolve;
        }),
    );
    const submittingRef = { current: false };
    const registrationData = buildRegistrationData();

    const first = runConcurRegistrationSubmit({
      submittingRef,
      phase: "idle",
      registrationData,
      createQuickExpense,
      onPhaseChange: vi.fn(),
      onErrorTypeChange: vi.fn(),
    });
    // 1回目のawaitへ到達する前に、同じsubmittingRefで2回目を即座に呼ぶ
    // （実際の二重クリックを模擬）。
    const second = runConcurRegistrationSubmit({
      submittingRef,
      phase: "idle",
      registrationData,
      createQuickExpense,
      onPhaseChange: vi.fn(),
      onErrorTypeChange: vi.fn(),
    });

    resolveInvoke({ result: { quickExpenseId: "stub_quick_expense_id", status: "stubbed" }, error: null });
    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);

    expect(createQuickExpense).toHaveBeenCalledTimes(1);
    expect(firstOutcome.skipped).toBe(false);
    expect(secondOutcome).toEqual({ skipped: true });
  });

  it("成功後（phase:success）は再送信できない", async () => {
    const createQuickExpense = vi.fn();
    const outcome = await runConcurRegistrationSubmit({
      submittingRef: { current: false },
      phase: "success",
      registrationData: buildRegistrationData(),
      createQuickExpense,
      onPhaseChange: vi.fn(),
      onErrorTypeChange: vi.fn(),
    });

    expect(outcome).toEqual({ skipped: true });
    expect(createQuickExpense).not.toHaveBeenCalled();
  });

  it("エラー後（phase:error）は再試行できる（ブロックされない）", async () => {
    const createQuickExpense = vi.fn().mockResolvedValue({
      result: { quickExpenseId: "stub_quick_expense_id", status: "stubbed" },
      error: null,
    });

    const outcome = await runConcurRegistrationSubmit({
      submittingRef: { current: false },
      phase: "error",
      registrationData: buildRegistrationData(),
      createQuickExpense,
      onPhaseChange: vi.fn(),
      onErrorTypeChange: vi.fn(),
    });

    expect(createQuickExpense).toHaveBeenCalledTimes(1);
    expect(outcome.skipped).toBe(false);
    expect(outcome.phase).toBe("success");
  });

  it("companyId不一致等でforbiddenが返った場合、phase:errorとerrorType:forbiddenになる", async () => {
    const createQuickExpense = vi.fn().mockResolvedValue({
      result: null,
      error: { type: "forbidden", message: "この操作を行う権限がありません。" },
    });
    const onPhaseChange = vi.fn();
    const onErrorTypeChange = vi.fn();

    const outcome = await runConcurRegistrationSubmit({
      submittingRef: { current: false },
      phase: "idle",
      registrationData: buildRegistrationData(),
      createQuickExpense,
      onPhaseChange,
      onErrorTypeChange,
    });

    expect(outcome).toEqual({ skipped: false, phase: "error", errorType: "forbidden" });
    expect(onPhaseChange).toHaveBeenNthCalledWith(2, "error");
    expect(onErrorTypeChange).toHaveBeenNthCalledWith(2, "forbidden");
  });
});
