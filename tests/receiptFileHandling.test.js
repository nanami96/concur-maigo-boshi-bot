import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { splitReceiptOcrConfirmation } from "../src/BotConversation.jsx";

// バグ修正：receiptRequired=trueの経費タイプでConcurRegistrationPanelが
// 表示されない原因は、ReceiptOcrPanel.jsxが保持しているFileオブジェクトが
// BotConversation→ConcurRegistrationPanel→buildConcurRegistrationDataへ
// 一度も配線されておらず、validateConcurExpenseData()のreceipt_required_
// but_missingに常に該当していたため（src/lib/concurExpenseData.js参照）。
//
// splitReceiptOcrConfirmation()はReceiptOcrPanel.jsxのonConfirmが渡す内容を
// receiptData（既存のOCRメタデータ）とreceiptFile（領収書画像本体）へ
// 分離するだけの純粋関数。BotConversation.jsx自体はJSXを含みこのプロジェクトに
// jsdom等のDOM描画環境が無いため直接マウントしてテストできない
// （CompanyContext.jsxのresolveSelectCompanyOutcome等と同じ方針で、
// 決定ロジックだけを切り出してテストする）。
describe("splitReceiptOcrConfirmation（ReceiptOcrPanelのonConfirm内容の分離）", () => {
  it("receiptFileを含むOCR確定内容を、receiptDataとreceiptFileへ正しく分離する", () => {
    const receiptFile = new File(["dummy"], "receipt.png", { type: "image/png" });
    const confirmed = {
      transactionDate: "2026-07-29",
      merchantName: "レンタカー会社",
      totalAmount: 5000,
      currencyCode: "JPY",
      receiptFile,
    };

    const { receiptData, receiptFile: extractedFile } = splitReceiptOcrConfirmation(confirmed);

    expect(receiptData).toEqual({
      transactionDate: "2026-07-29",
      merchantName: "レンタカー会社",
      totalAmount: 5000,
      currencyCode: "JPY",
    });
    // receiptDataの既存フィールド構成（transactionDate/merchantName/
    // totalAmount/currencyCode）を壊していないこと（receiptFileが混入しない）。
    expect(receiptData).not.toHaveProperty("receiptFile");
    expect(extractedFile).toBe(receiptFile);
  });

  it("receiptFileを含まない内容（ManualExpenseEntryPanel.jsxの確定内容と同じ形）の場合、receiptFileは常にnullになる", () => {
    const confirmed = {
      transactionDate: "2026-07-29",
      merchantName: null,
      totalAmount: 350,
      currencyCode: "JPY",
    };

    const { receiptData, receiptFile } = splitReceiptOcrConfirmation(confirmed);

    expect(receiptData).toEqual(confirmed);
    expect(receiptFile).toBeNull();
  });

  it("nullish（null/undefined）を渡しても例外にならず、空のreceiptDataとnullのreceiptFileを返す", () => {
    expect(splitReceiptOcrConfirmation(null)).toEqual({ receiptData: {}, receiptFile: null });
    expect(splitReceiptOcrConfirmation(undefined)).toEqual({ receiptData: {}, receiptFile: null });
  });

  it("receiptFileが明示的にnullの場合もnullのまま返す（?? nullで巻き込まれない）", () => {
    const confirmed = { transactionDate: "2026-07-29", receiptFile: null };
    expect(splitReceiptOcrConfirmation(confirmed).receiptFile).toBeNull();
  });
});

// receiptFileの実値（Fileオブジェクト自体）をconsole/ログ/永続化ストレージへ
// 出力するコードが無いことの静的回帰テスト（他のtests/schemaSql*.test.js・
// ExternalServiceSettings.test.jsと同じ「ソースを読んでテキスト検証する」方式）。
describe("receiptFileの安全な取り扱い（ログ・永続化に一切出力しないことの静的確認）", () => {
  const targetFiles = [
    "../src/ReceiptOcrPanel.jsx",
    "../src/BotConversation.jsx",
    "../src/ConcurRegistrationPanel.jsx",
  ];

  it.each(targetFiles)("%sのconsole呼び出しがreceiptFile/file本体を引数に含まない", (relativePath) => {
    const source = fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
    const consoleCalls = source.match(/console\.(log|info|warn|error|debug)\([^)]*\)/g) || [];

    consoleCalls.forEach((call) => {
      expect(call).not.toMatch(/\breceiptFile\b/);
      // handleConfirm内のローカル変数`file`（Fileオブジェクト本体）もログへ
      // 含めない（引数としてそのまま渡していないか）。
      expect(call).not.toMatch(/,\s*file\s*\)/);
    });
  });

  it.each(targetFiles)("%sにreceiptFileをlocalStorage/sessionStorageへ保存するコードが無い", (relativePath) => {
    const source = fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
    expect(source).not.toMatch(/localStorage\.setItem/);
    expect(source).not.toMatch(/sessionStorage\.setItem/);
  });
});
