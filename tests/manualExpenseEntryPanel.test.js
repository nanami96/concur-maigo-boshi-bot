import { describe, it, expect } from "vitest";
import { buildManualExpenseReceiptData } from "../src/ManualExpenseEntryPanel.jsx";
import { buildConcurRegistrationData } from "../src/lib/concurRegistrationData.js";

// mappingsはすべてテスト専用のダミー値であり、実際のConcur Expense Type
// Codeではない。
function buildDummyMappings() {
  return [
    { companyId: "sample-company", policyId: "normal_expense", botExpenseTypeId: "taxi", concurExpenseTypeId: "TEST_TAXI" },
    { companyId: "sample-company", policyId: "normal_expense", botExpenseTypeId: "train_local", concurExpenseTypeId: "TEST_TRAIN" },
  ];
}

function buildCompany() {
  return { company_id: "sample-company", company_name: "サンプル会社" };
}

describe("buildManualExpenseReceiptData", () => {
  it("入力値をReceiptOcrPanel.jsxのonConfirmと同じ形へ変換する", () => {
    const data = buildManualExpenseReceiptData(
      { transactionDate: "2026-07-29", merchantName: "  テスト商店  ", totalAmount: "1200" },
      "jpy",
    );

    expect(data).toEqual({
      transactionDate: "2026-07-29",
      merchantName: "テスト商店",
      totalAmount: 1200,
      currencyCode: "jpy",
    });
  });

  it("未入力の項目はnullになる（ReceiptOcrPanel.jsxのhandleConfirmと同じ挙動）", () => {
    const data = buildManualExpenseReceiptData(
      { transactionDate: "", merchantName: "", totalAmount: "" },
      "",
    );

    expect(data).toEqual({
      transactionDate: null,
      merchantName: null,
      totalAmount: null,
      currencyCode: null,
    });
  });
});

describe("OCRなし（手入力）で領収書不要の経費タイプの登録確認データが生成できる", () => {
  it("利用日・金額・通貨・店舗名を手入力→buildConcurRegistrationData()まで成立する", () => {
    const result = {
      rule: { id: "r001-g1" },
      expenseType: { id: "train_local", name: "電車・近隣交通費", policyId: "normal_expense", receiptRequired: false },
    };

    const manualReceiptData = buildManualExpenseReceiptData(
      { transactionDate: "2026-07-29", merchantName: "〇〇線", totalAmount: "350" },
      "JPY",
    );

    const { result: registrationData, error } = buildConcurRegistrationData({
      company: buildCompany(),
      result,
      receiptData: manualReceiptData,
      mappings: buildDummyMappings(),
    });

    expect(error).toBeNull();
    expect(registrationData).toEqual({
      companyId: "sample-company",
      policyId: "normal_expense",
      botExpenseTypeId: "train_local",
      concurExpenseTypeId: "TEST_TRAIN",
      transactionDate: "2026-07-29",
      amount: 350,
      currencyCode: "JPY",
      vendorName: "〇〇線",
      receiptRequired: false,
      memo: null,
    });
  });

  it("店舗名を入力しなくても（任意項目）確認データが生成できる", () => {
    const result = {
      rule: { id: "r001-g1" },
      expenseType: { id: "train_local", name: "電車・近隣交通費", policyId: "normal_expense", receiptRequired: false },
    };

    const manualReceiptData = buildManualExpenseReceiptData(
      { transactionDate: "2026-07-29", merchantName: "", totalAmount: "350" },
      "JPY",
    );

    const { result: registrationData, error } = buildConcurRegistrationData({
      company: buildCompany(),
      result,
      receiptData: manualReceiptData,
      mappings: buildDummyMappings(),
    });

    expect(error).toBeNull();
    expect(registrationData.vendorName).toBeNull();
  });
});

describe("OCRあり・手入力が混在しないこと", () => {
  it("OCR確認済みreceiptDataがある場合はそれが優先され、手入力データと混ざらない", () => {
    const result = {
      rule: { id: "r002-g1" },
      expenseType: { id: "taxi", name: "タクシー", policyId: "normal_expense", receiptRequired: true },
    };

    // OCR確認済みデータ（src/ReceiptOcrPanel.jsxのonConfirmが渡す形と同じ）。
    const ocrConfirmedReceiptData = {
      transactionDate: "2026-07-20",
      merchantName: "OCRで読み取った店舗",
      totalAmount: 2000,
      currencyCode: "JPY",
    };

    // BotConversation.jsxの実装ではshowReceiptOcr/showManualExpenseEntryが
    // 排他のため手入力パネル自体が同時に描画されないが、ここでは
    // 「呼び出し側に渡すreceiptDataが1つに定まっており、手入力の値で
    // 上書きされていないこと」を、OCR確認済みデータをそのまま
    // buildConcurRegistrationData()へ渡すことで確認する。
    const { result: registrationData, error } = buildConcurRegistrationData({
      company: buildCompany(),
      result,
      receiptData: ocrConfirmedReceiptData,
      receiptFile: new File(["dummy"], "receipt.png", { type: "image/png" }),
      mappings: buildDummyMappings(),
    });

    expect(error).toBeNull();
    expect(registrationData.transactionDate).toBe("2026-07-20");
    expect(registrationData.vendorName).toBe("OCRで読み取った店舗");
    expect(registrationData.amount).toBe(2000);
  });
});

describe("不完全な入力では確認画面用データが安全に生成されない", () => {
  const baseResult = {
    rule: { id: "r001-g1" },
    expenseType: { id: "train_local", name: "電車・近隣交通費", policyId: "normal_expense", receiptRequired: false },
  };

  it("日付欠落の場合はvalidation errorとなり、確認画面は表示しない扱いになる", () => {
    const manualReceiptData = buildManualExpenseReceiptData(
      { transactionDate: "", merchantName: "テスト商店", totalAmount: "350" },
      "JPY",
    );

    const { result, error } = buildConcurRegistrationData({
      company: buildCompany(),
      result: baseResult,
      receiptData: manualReceiptData,
      mappings: buildDummyMappings(),
    });

    expect(result).toBeNull();
    expect(error.type).toBe("missing_transaction_date");
  });

  it("金額が不正（0以下）な場合はvalidation errorとなる", () => {
    const manualReceiptData = buildManualExpenseReceiptData(
      { transactionDate: "2026-07-29", merchantName: "テスト商店", totalAmount: "0" },
      "JPY",
    );

    const { result, error } = buildConcurRegistrationData({
      company: buildCompany(),
      result: baseResult,
      receiptData: manualReceiptData,
      mappings: buildDummyMappings(),
    });

    expect(result).toBeNull();
    expect(error.type).toBe("invalid_amount");
  });

  it("通貨欠落の場合はvalidation errorとなる", () => {
    const manualReceiptData = buildManualExpenseReceiptData(
      { transactionDate: "2026-07-29", merchantName: "テスト商店", totalAmount: "350" },
      "",
    );

    const { result, error } = buildConcurRegistrationData({
      company: buildCompany(),
      result: baseResult,
      receiptData: manualReceiptData,
      mappings: buildDummyMappings(),
    });

    expect(result).toBeNull();
    expect(error.type).toBe("missing_currency_code");
  });
});
