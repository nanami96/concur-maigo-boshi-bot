import { describe, it, expect } from "vitest";
import {
  formatTransactionDate,
  formatAmount,
  formatReceiptRequired,
  resolveVendorNameDisplay,
  resolveExpenseTypeNameDisplay,
} from "../src/ConcurRegistrationPanel.jsx";
import { buildConcurRegistrationData } from "../src/lib/concurRegistrationData.js";

// このプロジェクトにはReact Testing Library等のDOM描画テスト基盤が無く
// （既存のtests/配下は全て純粋関数のユニットテストのみ）、今回もその方針を
// 踏襲する。ConcurRegistrationPanel.jsxが実際に表示する文字列は、これらの
// exportされた整形関数がそのまま決めているため、ここで正しさを確認すれば
// 「経費タイプ名・日付・金額・店舗名・領収書要否が正しく表示されること」を
// 実質的に検証できる。

describe("formatTransactionDate", () => {
  it("YYYY-MM-DD形式を「年月日」表記に変換する", () => {
    expect(formatTransactionDate("2026-07-29")).toBe("2026年7月29日");
  });

  it("先頭ゼロを付けない（7月・9日等）", () => {
    expect(formatTransactionDate("2026-01-05")).toBe("2026年1月5日");
  });

  it("null・不正な形式の場合は例外にならず、素の値または未入力を返す", () => {
    expect(formatTransactionDate(null)).toBe("未入力");
    expect(formatTransactionDate(undefined)).toBe("未入力");
    expect(formatTransactionDate("not-a-date")).toBe("not-a-date");
  });
});

describe("formatAmount", () => {
  it("JPYの場合は桁区切り＋「円」で表示する", () => {
    expect(formatAmount(3500, "JPY")).toBe("3,500円");
    expect(formatAmount(1000000, "JPY")).toBe("1,000,000円");
  });

  it("JPY以外は桁区切り数値＋通貨コードを表示する", () => {
    expect(formatAmount(3500, "USD")).toBe("3,500 USD");
  });

  it("amountが数値でない・NaNの場合は未入力を返す", () => {
    expect(formatAmount(null, "JPY")).toBe("未入力");
    expect(formatAmount(undefined, "JPY")).toBe("未入力");
    expect(formatAmount(Number.NaN, "JPY")).toBe("未入力");
    expect(formatAmount("3500", "JPY")).toBe("未入力");
  });

  it("currencyCodeが無い場合は数値のみを返す", () => {
    expect(formatAmount(3500, null)).toBe("3,500");
  });
});

describe("formatReceiptRequired", () => {
  it("true→必要、false→不要、それ以外→未設定", () => {
    expect(formatReceiptRequired(true)).toBe("必要");
    expect(formatReceiptRequired(false)).toBe("不要");
    expect(formatReceiptRequired(null)).toBe("未設定");
    expect(formatReceiptRequired(undefined)).toBe("未設定");
  });
});

describe("resolveVendorNameDisplay（null系）", () => {
  it("値がある場合はそのまま返す", () => {
    expect(resolveVendorNameDisplay("株式会社あんしんネット21")).toBe("株式会社あんしんネット21");
  });

  it("vendorNameがnullでも未入力を返す（崩れない）", () => {
    expect(resolveVendorNameDisplay(null)).toBe("未入力");
    expect(resolveVendorNameDisplay(undefined)).toBe("未入力");
  });
});

describe("resolveExpenseTypeNameDisplay", () => {
  it("値がある場合はそのまま返す", () => {
    expect(resolveExpenseTypeNameDisplay("タクシー")).toBe("タクシー");
  });

  it("未指定でも未設定を返す（崩れない）", () => {
    expect(resolveExpenseTypeNameDisplay(null)).toBe("未設定");
    expect(resolveExpenseTypeNameDisplay(undefined)).toBe("未設定");
  });
});

function buildCompany(overrides = {}) {
  return { company_id: "sample-company", company_name: "サンプル会社", ...overrides };
}

describe("一連の流れ（判定結果→OCR確認データ→buildConcurRegistrationData→表示値）", () => {
  it("領収書必須の経費タイプで、確認画面に表示する値一式が正しく組み立てられる", () => {
    const result = {
      rule: { id: "r002-g1" },
      expenseType: { id: "taxi", name: "タクシー", policyId: "normal_expense", receiptRequired: true },
    };
    const receiptData = {
      transactionDate: "2026-07-29",
      merchantName: "株式会社あんしんネット21",
      totalAmount: 1200,
      currencyCode: "JPY",
    };

    const { result: registrationData, error } = buildConcurRegistrationData({
      company: buildCompany(),
      result,
      receiptData,
      receiptFile: new File(["dummy"], "receipt.png", { type: "image/png" }),
    });

    expect(error).toBeNull();

    // ConcurRegistrationPanel.jsxが画面に出す文字列そのもの。
    expect(resolveExpenseTypeNameDisplay(result.expenseType.name)).toBe("タクシー");
    expect(formatTransactionDate(registrationData.transactionDate)).toBe("2026年7月29日");
    expect(formatAmount(registrationData.amount, registrationData.currencyCode)).toBe("1,200円");
    expect(resolveVendorNameDisplay(registrationData.vendorName)).toBe("株式会社あんしんネット21");
    expect(formatReceiptRequired(registrationData.receiptRequired)).toBe("必要");

    // 内部識別子はユーザー表示に使わない値であることの確認
    // （画面には出さないが、統合データ自体には引き続き含まれている）。
    expect(registrationData.companyId).toBe("sample-company");
    expect(registrationData.expenseTypeId).toBe("taxi");
  });

  it("領収書不要の経費タイプでも到達できる（OCR未実施でも領収書表示が崩れない）", () => {
    const result = {
      rule: { id: "r001-g1" },
      expenseType: { id: "train_local", name: "電車・近隣交通費", policyId: "normal_expense", receiptRequired: false },
    };
    const receiptData = {
      transactionDate: "2026-07-29",
      merchantName: null,
      totalAmount: 350,
      currencyCode: "JPY",
    };

    const { result: registrationData, error } = buildConcurRegistrationData({
      company: buildCompany(),
      result,
      receiptData,
      receiptFile: null,
    });

    expect(error).toBeNull();
    expect(formatReceiptRequired(registrationData.receiptRequired)).toBe("不要");
    expect(resolveVendorNameDisplay(registrationData.vendorName)).toBe("未入力");
    expect(formatAmount(registrationData.amount, registrationData.currencyCode)).toBe("350円");
  });

  it("OCR未実施（receiptDataが無い）場合はvalidation errorとなり、確認画面は表示しない扱いになる", () => {
    // 領収書不要でもOCRを経由しない限り、現状のアプリには利用日・金額を
    // 取得する他の手段が無い（BotConversation.jsx参照）。ConcurRegistration
    // Panel.jsxはこの場合buildConcurRegistrationData()のerrorを受けてnullを
    // 描画するだけであり、エラーコードを画面へ出さない設計になっている。
    const result = {
      rule: { id: "r001-g1" },
      expenseType: { id: "train_local", name: "電車・近隣交通費", policyId: "normal_expense", receiptRequired: false },
    };

    const { result: registrationData, error } = buildConcurRegistrationData({
      company: buildCompany(),
      result,
      receiptData: null,
    });

    expect(registrationData).toBeNull();
    expect(error).not.toBeNull();
    // ConcurRegistrationPanel.jsx側はこのerrorの中身を画面に出さない
    // （error/registrationDataがnullならコンポーネントはnullを返すだけ）。
  });
});
