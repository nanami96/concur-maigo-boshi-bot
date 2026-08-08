import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CompanyHeaderIndicator, CompanySelectionGate } from "../src/AuthenticatedBotScreen.jsx";

// AuthenticatedBotScreen.jsxのReactコンポーネントテスト（Commit 4）。
// このプロジェクトにはReact Testing Library等のDOMレンダリング用テスト基盤が
// 無く、今回も新しいライブラリを追加しない方針のため、既存の依存関係
// （react-dom。package.json参照）だけに含まれるreact-dom/serverの
// renderToStaticMarkup()で静的HTML文字列へ描画し、その文字列の内容を
// 検証する（ConcurRegistrationPanel.jsxの表示整形関数群と同じ、
// 「exportして直接テストする」という既存方針の延長）。
// イベントハンドラの発火自体はここでは検証できないため、onClick/onChangeに
// 渡した関数が「正しい引数と共に渡されているか」はprops経由の間接的な
// 確認に留める。

function companyOf(overrides = {}) {
  return { companyCode: "company-a", companyName: "A株式会社", role: "user", ...overrides };
}

describe("CompanyHeaderIndicator（1社時はテキスト表示のみ、複数社時はselect表示）", () => {
  it("1社所属の場合、会社名をテキスト表示し、selectを描画しない", () => {
    const currentCompany = companyOf();
    const html = renderToStaticMarkup(
      <CompanyHeaderIndicator
        currentCompany={currentCompany}
        companies={[currentCompany]}
        isSwitching={false}
        onSelectCompany={() => {}}
      />,
    );

    expect(html).toContain("会社：A株式会社");
    expect(html).not.toContain("<select");
    // company_code（内部値）自体はUI文言に露出しない。
    expect(html).not.toContain("company-a");
  });

  it("複数社所属の場合、selectを表示し、全所属会社が選択肢に存在する", () => {
    const companies = [
      companyOf({ companyCode: "company-a", companyName: "A株式会社" }),
      companyOf({ companyCode: "company-b", companyName: "B株式会社" }),
      companyOf({ companyCode: "company-c", companyName: "C株式会社" }),
    ];
    const html = renderToStaticMarkup(
      <CompanyHeaderIndicator
        currentCompany={companies[0]}
        companies={companies}
        isSwitching={false}
        onSelectCompany={() => {}}
      />,
    );

    expect(html).toContain("<select");
    expect(html).toContain("A株式会社");
    expect(html).toContain("B株式会社");
    expect(html).toContain("C株式会社");
    // 表示テキストはcompanyName。option value（内部値）はcompanyCode。
    expect(html).toContain('value="company-a"');
    expect(html).toContain('value="company-b"');
    expect(html).toContain('value="company-c"');
  });

  it("現在の会社が選択されているselectのcurrent valueになる", () => {
    const companies = [
      companyOf({ companyCode: "company-a", companyName: "A株式会社" }),
      companyOf({ companyCode: "company-b", companyName: "B株式会社" }),
    ];
    const html = renderToStaticMarkup(
      <CompanyHeaderIndicator
        currentCompany={companies[1]}
        companies={companies}
        isSwitching={false}
        onSelectCompany={() => {}}
      />,
    );

    // controlled selectの現在値はselected属性がついたoptionで表れる
    // （React 19のreact-dom/serverの静的レンダリング仕様）。
    expect(html).toMatch(/<option value="company-b"[^>]*selected/);
  });

  it("切替中(isSwitching)はselectがdisabledになる", () => {
    const companies = [companyOf({ companyCode: "company-a" }), companyOf({ companyCode: "company-b" })];
    const html = renderToStaticMarkup(
      <CompanyHeaderIndicator
        currentCompany={companies[0]}
        companies={companies}
        isSwitching={true}
        onSelectCompany={() => {}}
      />,
    );

    expect(html).toMatch(/<select[^>]*disabled/);
  });

  it("aria-labelを持つ（アクセシビリティ）", () => {
    const companies = [companyOf({ companyCode: "company-a" }), companyOf({ companyCode: "company-b" })];
    const html = renderToStaticMarkup(
      <CompanyHeaderIndicator
        currentCompany={companies[0]}
        companies={companies}
        isSwitching={false}
        onSelectCompany={() => {}}
      />,
    );

    expect(html).toContain('aria-label="会社を選択"');
  });
});

describe("CompanySelectionGate（selection-required時の会社選択UI）", () => {
  it("所属会社一覧を選択肢として表示する（companyNameで表示、companyCodeはボタンのonClick引数としてのみ使う）", () => {
    const companies = [
      companyOf({ companyCode: "company-a", companyName: "A株式会社" }),
      companyOf({ companyCode: "company-b", companyName: "B株式会社" }),
    ];
    const html = renderToStaticMarkup(
      <CompanySelectionGate companies={companies} isSwitching={false} onSelect={() => {}} />,
    );

    expect(html).toContain("A株式会社");
    expect(html).toContain("B株式会社");
    expect(html).toContain("<button");
    // ドロップダウンではなく標準ボタンによる選択にしている。
    expect(html).not.toContain("<select");
  });

  it("切替中(isSwitching)はボタンがdisabledになる（二重操作防止）", () => {
    const companies = [companyOf()];
    const html = renderToStaticMarkup(
      <CompanySelectionGate companies={companies} isSwitching={true} onSelect={() => {}} />,
    );

    expect(html).toMatch(/<button[^>]*disabled/);
  });
});
