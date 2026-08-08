import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ConcurRegistrationPanel from "../src/ConcurRegistrationPanel.jsx";

// バグ修正の回帰テスト：ConcurRegistrationPanel.jsxがreceiptFile propを
// 受け取り、buildConcurRegistrationData()へ正しく転送するかを、実際に
// コンポーネントをレンダリングして確認する（AuthenticatedBotScreenCompanyUI.
// test.jsx等と同じrenderToStaticMarkup方式）。
//
// 以前のバグ：ConcurRegistrationPanel.jsxがreceiptFileというpropをそもそも
// 受け取っておらず、buildConcurRegistrationData()へも渡していなかったため、
// receiptRequired=trueの経費タイプは常にvalidateConcurExpenseData()の
// receipt_required_but_missingで弾かれ、カードが一切表示されなかった。
// この一連のテストは、その配線（props→buildConcurRegistrationData）が
// 実際のコンポーネント経由で機能することを検証する。

function buildCompany(overrides = {}) {
  return {
    company_id: "connect-company",
    company_name: "連携用会社",
    concurExpenseTypeIdMode: "concur_exp_key",
    ...overrides,
  };
}

function buildReceiptData(overrides = {}) {
  return {
    transactionDate: "2026-07-29",
    merchantName: "レンタカー会社",
    totalAmount: 5000,
    currencyCode: "JPY",
    ...overrides,
  };
}

describe("ConcurRegistrationPanel（receiptFile propの配線。バグ修正の回帰テスト）", () => {
  it("【01080相当・領収書必須】receiptFileが渡されていれば、カードが表示される", () => {
    const receiptFile = new File(["dummy"], "receipt.png", { type: "image/png" });
    const html = renderToStaticMarkup(
      <ConcurRegistrationPanel
        company={buildCompany()}
        companyCode="connect-company"
        result={{
          rule: { id: "r-01080" },
          expenseType: { id: "01080", name: "国内レンタカー・ガソリン代", policyId: "connect-company policy", receiptRequired: true },
        }}
        receiptData={buildReceiptData()}
        receiptFile={receiptFile}
        expenseTypeName="国内レンタカー・ガソリン代"
        policyName={null}
      />,
    );

    expect(html).toContain("Concurへの登録内容を確認");
  });

  it("【01080相当・以前のバグの再現確認】receiptFileが渡されていない場合、領収書必須の経費タイプではカードが表示されない", () => {
    const html = renderToStaticMarkup(
      <ConcurRegistrationPanel
        company={buildCompany()}
        companyCode="connect-company"
        result={{
          rule: { id: "r-01080" },
          expenseType: { id: "01080", name: "国内レンタカー・ガソリン代", policyId: "connect-company policy", receiptRequired: true },
        }}
        receiptData={buildReceiptData()}
        expenseTypeName="国内レンタカー・ガソリン代"
        policyName={null}
        // receiptFileを渡さない（未対応時の状態を再現）
      />,
    );

    expect(html).toBe("");
  });

  it("【01079相当・領収書不要】receiptFileが無くても、従来どおりカードが表示される", () => {
    const html = renderToStaticMarkup(
      <ConcurRegistrationPanel
        company={buildCompany()}
        companyCode="connect-company"
        result={{
          rule: { id: "r-01079" },
          expenseType: { id: "01079", name: "国内電車（経路検索）", policyId: "connect-company policy", receiptRequired: false },
        }}
        receiptData={buildReceiptData({ merchantName: null })}
        expenseTypeName="国内電車（経路検索）"
        policyName={null}
      />,
    );

    expect(html).toContain("Concurへの登録内容を確認");
  });

  it("【手入力経路・仕様確認】領収書必須の経費タイプで、ManualExpenseEntryPanel由来のreceiptData（receiptFileフィールドを含まない）だけでは、引き続きカードが表示されない", () => {
    // ManualExpenseEntryPanel.jsxのonConfirmが渡す形（receiptFileフィールドを
    // 持たない）をそのままreceiptDataとして渡した場合を再現する。
    const html = renderToStaticMarkup(
      <ConcurRegistrationPanel
        company={buildCompany()}
        companyCode="connect-company"
        result={{
          rule: { id: "r-01080" },
          expenseType: { id: "01080", name: "国内レンタカー・ガソリン代", policyId: "connect-company policy", receiptRequired: true },
        }}
        receiptData={buildReceiptData()}
        expenseTypeName="国内レンタカー・ガソリン代"
        policyName={null}
      />,
    );

    expect(html).toBe("");
  });

  it("receiptFileの実値（File名・中身）がレンダリング結果のHTMLに一切含まれない", () => {
    const receiptFile = new File(["dummy"], "super-secret-receipt.png", { type: "image/png" });
    const html = renderToStaticMarkup(
      <ConcurRegistrationPanel
        company={buildCompany()}
        companyCode="connect-company"
        result={{
          rule: { id: "r-01080" },
          expenseType: { id: "01080", name: "国内レンタカー・ガソリン代", policyId: "connect-company policy", receiptRequired: true },
        }}
        receiptData={buildReceiptData()}
        receiptFile={receiptFile}
        expenseTypeName="国内レンタカー・ガソリン代"
        policyName={null}
      />,
    );

    expect(html).not.toContain("super-secret-receipt.png");
  });
});
