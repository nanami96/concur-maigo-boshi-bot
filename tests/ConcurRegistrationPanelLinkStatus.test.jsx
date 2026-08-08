import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ConcurRegistrationPanel from "../src/ConcurRegistrationPanel.jsx";

// Phase 13 UI改善（紐付け済み状態のステータスカード化・確認中ローディング表示）の
// 回帰テスト。tests/ConcurRegistrationPanelReceiptFile.test.jsxと同じ
// renderToStaticMarkup方式を使う。
//
// 【重要な制約】このプロジェクトにはjsdom/React Testing Library等のDOM
// テスト基盤が無く、renderToStaticMarkup（react-dom/server）はuseEffectを
// 一切実行しない（サーバーサイドレンダリングの仕様）。そのため
// get_my_concur_link_status()を呼ぶuseEffectは発火せず、hasLinkは常に初期値
// のnullのまま描画される＝この方式では常に「確認中(checking)」状態しか
// 実際にレンダリングできない。
//
// hasLink:true（確認済みカード）・hasLink:false（入力欄）というeffect後の
// 状態そのものの分岐ロジックは、src/ConcurRegistrationPanel.jsxからexportした
// 純粋関数resolveConcurLinkViewState()をtests/ConcurRegistrationPanel.test.js
// で網羅的に検証している（このテストファイルの責務ではない）。

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

function renderPanel(overrides = {}) {
  return renderToStaticMarkup(
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
      {...overrides}
    />,
  );
}

describe("ConcurRegistrationPanel（Phase 13 UI改善：確認中ローディング表示）", () => {
  it("13. 初回描画（hasLink確認中）では、ConcurログインID入力欄を一切表示しない", () => {
    const html = renderPanel();

    expect(html).not.toContain('id="concurRegistrationConcurLoginId"');
    expect(html).not.toContain("ConcurログインID");
  });

  it("13b. 初回描画（hasLink確認中）では、確認済みステータスカードも一切表示しない", () => {
    const html = renderPanel();

    expect(html).not.toContain("concurRegistrationLinkStatusCard");
    expect(html).not.toContain("Concur利用者：確認済み");
    expect(html).not.toContain("Concurアカウントの紐付けを変更する");
  });

  it("確認中でも「Concurに登録」ボタンのSVGアイコン（send.svg）は表示される（ボタン自体は常に描画されるため）", () => {
    const html = renderPanel();

    expect(html).toContain("concurRegistrationSubmitIcon");
    expect(html).toMatch(/concurRegistrationSubmitIcon"[^>]*><svg/);
  });

  it("13c. 初回描画（hasLink確認中）では、控えめなローディング文言を表示する", () => {
    const html = renderPanel();

    expect(html).toContain("Concur利用者情報を確認しています");
  });

  it("確認中でも既存カード（Concurへの登録内容を確認）自体は変わらず表示される", () => {
    const html = renderPanel();

    expect(html).toContain("Concurへの登録内容を確認");
  });

  it("確認中の描画にConcurログインIDの実値・Identity User ID相当の文字列が含まれない", () => {
    const html = renderPanel();

    expect(html).not.toMatch(/[\w.-]+@[\w.-]+\.\w+/); // メールアドレス形式の値が一切現れない
  });
});
