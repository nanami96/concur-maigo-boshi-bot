import { describe, it, expect } from "vitest";
import { validateConcurQuickExpenseRequest } from "../supabase/functions/_shared/concur-quick-expense/validateConcurQuickExpenseRequest.js";

const VALID_USER_ID = "3df11695-e8bb-40ff-8e98-c85913ab2789";

function buildValidInput(overrides = {}) {
  return {
    userId: VALID_USER_ID,
    expenseTypeId: "MEAL",
    transactionDate: "2026-07-28",
    amount: 1000,
    currencyCode: "JPY",
    ...overrides,
  };
}

describe("validateConcurQuickExpenseRequest（正常系）", () => {
  it("必須項目のみでも正常に変換できる", () => {
    const result = validateConcurQuickExpenseRequest(buildValidInput());

    expect(result.ok).toBe(true);
    expect(result.userId).toBe(VALID_USER_ID);
    expect(result.contextType).toBe("TRAVELER");
    expect(result.quickExpenseBody).toEqual({
      expenseTypeId: "MEAL",
      transactionDate: "2026-07-28",
      transactionAmount: { currencyCode: "JPY", value: 1000 },
    });
  });

  it("任意項目（vendorName・memo・entryDetails・paymentTypeId・location）を含めると変換される", () => {
    const result = validateConcurQuickExpenseRequest(
      buildValidInput({
        vendorName: "サンプル商店",
        memo: "備考",
        entryDetails: "詳細",
        paymentTypeId: "CASHX",
        location: { city: "Tokyo", countryCode: "JP", countrySubDivisionCode: "JP-13", id: "loc-1", name: "東京" },
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.quickExpenseBody).toEqual({
      expenseTypeId: "MEAL",
      transactionDate: "2026-07-28",
      transactionAmount: { currencyCode: "JPY", value: 1000 },
      vendor: "サンプル商店",
      comment: "備考",
      entryDetails: "詳細",
      paymentTypeId: "CASHX",
      location: { city: "Tokyo", countryCode: "JP", countrySubDivisionCode: "JP-13", id: "loc-1", name: "東京" },
    });
  });

  it("contextTypeを明示的に'TRAVELER'で渡しても正常", () => {
    const result = validateConcurQuickExpenseRequest(buildValidInput({ contextType: "TRAVELER" }));
    expect(result.ok).toBe(true);
    expect(result.contextType).toBe("TRAVELER");
  });

  it("公式仕様に存在しないBot内部専用フィールド（companyId・policyId・receiptRequired等）は結果に含まれない", () => {
    const result = validateConcurQuickExpenseRequest(
      buildValidInput({ companyId: "company-1", policyId: "policy-1", receiptRequired: true, botExpenseTypeId: "OLD" }),
    );

    expect(result.ok).toBe(true);
    expect(Object.keys(result.quickExpenseBody).sort()).toEqual(
      ["expenseTypeId", "transactionDate", "transactionAmount"].sort(),
    );
  });

  it("locationの一部フィールドのみでも変換できる（未指定フィールドは含まない）", () => {
    const result = validateConcurQuickExpenseRequest(buildValidInput({ location: { city: "Osaka" } }));
    expect(result.ok).toBe(true);
    expect(result.quickExpenseBody.location).toEqual({ city: "Osaka" });
  });

  it("locationがすべて空文字の場合、location自体を結果へ含めない", () => {
    const result = validateConcurQuickExpenseRequest(buildValidInput({ location: { city: "" } }));
    expect(result.ok).toBe(true);
    expect(result.quickExpenseBody.location).toBeUndefined();
  });
});

describe("validateConcurQuickExpenseRequest（userId）", () => {
  it("userIdが無い場合はok:false", () => {
    const { userId, ...rest } = buildValidInput();
    expect(validateConcurQuickExpenseRequest(rest).ok).toBe(false);
  });

  it("userIdが空文字・空白のみの場合はok:false", () => {
    expect(validateConcurQuickExpenseRequest(buildValidInput({ userId: "" })).ok).toBe(false);
    expect(validateConcurQuickExpenseRequest(buildValidInput({ userId: "   " })).ok).toBe(false);
  });

  it("userIdが文字列以外の場合はok:false", () => {
    expect(validateConcurQuickExpenseRequest(buildValidInput({ userId: 12345 })).ok).toBe(false);
    expect(validateConcurQuickExpenseRequest(buildValidInput({ userId: null })).ok).toBe(false);
  });

  it("userIdの前後空白はtrimされる", () => {
    const result = validateConcurQuickExpenseRequest(buildValidInput({ userId: `  ${VALID_USER_ID}  ` }));
    expect(result.ok).toBe(true);
    expect(result.userId).toBe(VALID_USER_ID);
  });
});

describe("validateConcurQuickExpenseRequest（contextType）", () => {
  it("'TRAVELER'以外の値はok:false（公式ドキュメント上、唯一の値のため）", () => {
    expect(validateConcurQuickExpenseRequest(buildValidInput({ contextType: "TRAVEL" })).ok).toBe(false);
    expect(validateConcurQuickExpenseRequest(buildValidInput({ contextType: "traveler" })).ok).toBe(false);
    expect(validateConcurQuickExpenseRequest(buildValidInput({ contextType: "PURCHASING_CARD" })).ok).toBe(false);
  });
});

describe("validateConcurQuickExpenseRequest（expenseTypeId）", () => {
  it("無い場合はok:false", () => {
    const { expenseTypeId, ...rest } = buildValidInput();
    expect(validateConcurQuickExpenseRequest(rest).ok).toBe(false);
  });

  it("空文字・空白のみの場合はok:false", () => {
    expect(validateConcurQuickExpenseRequest(buildValidInput({ expenseTypeId: "" })).ok).toBe(false);
  });
});

describe("validateConcurQuickExpenseRequest（transactionDate）", () => {
  it("無い場合はok:false", () => {
    const { transactionDate, ...rest } = buildValidInput();
    expect(validateConcurQuickExpenseRequest(rest).ok).toBe(false);
  });

  it("YYYY-MM-DD形式でない場合はok:false", () => {
    expect(validateConcurQuickExpenseRequest(buildValidInput({ transactionDate: "2026/07/28" })).ok).toBe(false);
    expect(validateConcurQuickExpenseRequest(buildValidInput({ transactionDate: "07-28-2026" })).ok).toBe(false);
  });

  it("形式は合っているが実在しない日付の場合はok:false", () => {
    expect(validateConcurQuickExpenseRequest(buildValidInput({ transactionDate: "2026-13-40" })).ok).toBe(false);
    expect(validateConcurQuickExpenseRequest(buildValidInput({ transactionDate: "2026-02-30" })).ok).toBe(false);
  });
});

describe("validateConcurQuickExpenseRequest（amount → transactionAmount.value）", () => {
  it("無い場合はok:false", () => {
    const { amount, ...rest } = buildValidInput();
    expect(validateConcurQuickExpenseRequest(rest).ok).toBe(false);
  });

  it("数値以外・NaN・Infinity・0以下はok:false（有限の正数だけを許容する）", () => {
    expect(validateConcurQuickExpenseRequest(buildValidInput({ amount: "1000" })).ok).toBe(false);
    expect(validateConcurQuickExpenseRequest(buildValidInput({ amount: Number.NaN })).ok).toBe(false);
    expect(validateConcurQuickExpenseRequest(buildValidInput({ amount: Number.POSITIVE_INFINITY })).ok).toBe(false);
    expect(validateConcurQuickExpenseRequest(buildValidInput({ amount: Number.NEGATIVE_INFINITY })).ok).toBe(false);
    expect(validateConcurQuickExpenseRequest(buildValidInput({ amount: 0 })).ok).toBe(false);
    expect(validateConcurQuickExpenseRequest(buildValidInput({ amount: -100 })).ok).toBe(false);
  });
});

describe("validateConcurQuickExpenseRequest（currencyCode → transactionAmount.currencyCode）", () => {
  it("無い場合はok:false", () => {
    const { currencyCode, ...rest } = buildValidInput();
    expect(validateConcurQuickExpenseRequest(rest).ok).toBe(false);
  });

  it("3文字の大文字ISO 4217形式でない場合はok:false", () => {
    expect(validateConcurQuickExpenseRequest(buildValidInput({ currencyCode: "jpy" })).ok).toBe(false);
    expect(validateConcurQuickExpenseRequest(buildValidInput({ currencyCode: "JPYEN" })).ok).toBe(false);
    expect(validateConcurQuickExpenseRequest(buildValidInput({ currencyCode: "12" })).ok).toBe(false);
  });
});

describe("validateConcurQuickExpenseRequest（paymentTypeId）", () => {
  it("CASHX・CPAID・PENDC以外の値はok:false", () => {
    expect(validateConcurQuickExpenseRequest(buildValidInput({ paymentTypeId: "OTHER" })).ok).toBe(false);
  });

  it("未指定でも正常（任意項目）", () => {
    expect(validateConcurQuickExpenseRequest(buildValidInput()).ok).toBe(true);
  });
});

describe("validateConcurQuickExpenseRequest（vendorName・memo・entryDetails）", () => {
  it("文字列以外の型はok:false", () => {
    expect(validateConcurQuickExpenseRequest(buildValidInput({ vendorName: 123 })).ok).toBe(false);
    expect(validateConcurQuickExpenseRequest(buildValidInput({ memo: 123 })).ok).toBe(false);
    expect(validateConcurQuickExpenseRequest(buildValidInput({ entryDetails: 123 })).ok).toBe(false);
  });

  it("null・未指定は許容される（任意項目）", () => {
    expect(validateConcurQuickExpenseRequest(buildValidInput({ vendorName: null })).ok).toBe(true);
  });
});

describe("validateConcurQuickExpenseRequest（location）", () => {
  it("オブジェクト以外・配列はok:false", () => {
    expect(validateConcurQuickExpenseRequest(buildValidInput({ location: "Tokyo" })).ok).toBe(false);
    expect(validateConcurQuickExpenseRequest(buildValidInput({ location: [] })).ok).toBe(false);
  });

  it("サブフィールドが文字列以外の場合はok:false", () => {
    expect(validateConcurQuickExpenseRequest(buildValidInput({ location: { city: 123 } })).ok).toBe(false);
  });
});

describe("validateConcurQuickExpenseRequest（入力の型不正・境界値）", () => {
  it("bodyがnull・配列・非オブジェクトの場合はok:false（例外にならない）", () => {
    expect(validateConcurQuickExpenseRequest(null).ok).toBe(false);
    expect(validateConcurQuickExpenseRequest(undefined).ok).toBe(false);
    expect(validateConcurQuickExpenseRequest([]).ok).toBe(false);
    expect(validateConcurQuickExpenseRequest("not-an-object").ok).toBe(false);
  });
});
