import { describe, it, expect } from "vitest";
import { resolveVisibleSettingsTabs } from "../src/admin/AdminRoot.jsx";

// AdminRoot.jsxはJSXを含み管理画面全体を組み立てる大きなコンポーネントで、
// このプロジェクトにはjsdom等のDOMレンダリング環境が無いため直接マウントして
// テストできない。「設定」タブのうち、どのタブを表示してよいかという決定
// ロジックだけをresolveVisibleSettingsTabs()として切り出し、ここでテストする
// （CompanyContext.jsxのresolveSelectCompanyOutcome()と同じ方針）。
//
// 【バグ修正】ExternalServiceSettings（「連携」タブの中身）は元々platform_admin
// 専用（isPlatformAdmin===falseならreturn null）だったが、タブボタン自体は
// company_adminにも表示されていたため、選択すると中身が空白になるという
// 見た目上の不整合があった。resolveVisibleSettingsTabs()はAdminRoot側でも
// 「連携」タブそのものをcompany_adminへ表示しないようにする（二重防御）。
describe("resolveVisibleSettingsTabs（「連携」タブの表示可否）", () => {
  it("platform_adminには基本設定・ポリシー・経費タイプ・連携の4タブすべてを返す", () => {
    const tabs = resolveVisibleSettingsTabs(true);
    expect(tabs.map((tab) => tab.id)).toEqual(["company", "policies", "expenseTypes", "integrations"]);
  });

  it("company_admin（isPlatformAdmin:false）には連携タブを除いた3タブだけを返す", () => {
    const tabs = resolveVisibleSettingsTabs(false);
    expect(tabs.map((tab) => tab.id)).toEqual(["company", "policies", "expenseTypes"]);
    expect(tabs.some((tab) => tab.id === "integrations")).toBe(false);
  });

  it("isPlatformAdminが未解決（null/undefined）の間も連携タブを含めない（fail-closed。ExternalServiceSettings自身のshouldShowExternalServiceSettingsと同じ方針）", () => {
    expect(resolveVisibleSettingsTabs(null).some((tab) => tab.id === "integrations")).toBe(false);
    expect(resolveVisibleSettingsTabs(undefined).some((tab) => tab.id === "integrations")).toBe(false);
  });

  it("連携タブを除いても、基本設定・ポリシー・経費タイプの順序・ラベルは変わらない", () => {
    const tabs = resolveVisibleSettingsTabs(false);
    expect(tabs).toEqual([
      { id: "company", label: "基本設定" },
      { id: "policies", label: "ポリシー" },
      { id: "expenseTypes", label: "経費タイプ" },
    ]);
  });

  it("platform_admin時の連携タブのラベルは「連携」のまま（表示文言を変更していない）", () => {
    const tabs = resolveVisibleSettingsTabs(true);
    const integrationsTab = tabs.find((tab) => tab.id === "integrations");
    expect(integrationsTab).toEqual({ id: "integrations", label: "連携" });
  });
});
