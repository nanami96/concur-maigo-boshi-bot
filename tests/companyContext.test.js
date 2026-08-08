import { describe, it, expect } from "vitest";
import { resolveSelectCompanyOutcome } from "../src/company/CompanyContext.jsx";
import { COMPANY_SWITCH_ERROR_MESSAGE } from "../src/data/resolveCurrentCompany.js";

// CompanyContext.jsxはJSXを含み、このプロジェクトにはjsdom等のDOMレンダリング
// 環境が無いため直接マウントしてテストできない。selectCompany()の応答後の
// 判定ロジックだけをresolveSelectCompanyOutcome()として切り出し、ここで
// テストする（resolveCurrentCompany.jsの各純粋関数と同じ方針）。

function readyResult(overrides = {}) {
  return {
    status: "ready",
    currentCompany: { companyCode: "company-b", companyName: "B株式会社", role: "user" },
    membership: { companyCode: "company-b", configSnapshot: { questions: [] } },
    ...overrides,
  };
}

describe("resolveSelectCompanyOutcome（バグ修正：selectCompany()がstaleな場合でもisSwitchingが必ずfalseに戻る）", () => {
  it("【本バグの再現・修正確認】isStale=trueの場合、resultの内容に関わらずisSwitching:falseを返す（stateは更新しない）", () => {
    const outcome = resolveSelectCompanyOutcome({ isStale: true, result: readyResult() });

    expect(outcome.isSwitching).toBe(false);
    expect(outcome.applyState).toBe(false);
  });

  it("isStale=trueの場合、rejected/error等の失敗resultであってもisSwitching:falseを返し、エラーは出さない（新しい呼び出し側の責務のため）", () => {
    const outcome = resolveSelectCompanyOutcome({
      isStale: true,
      result: { status: "rejected", currentCompany: null, membership: null },
    });

    expect(outcome.isSwitching).toBe(false);
    expect(outcome.applyState).toBe(false);
    expect(outcome.switchError).toBeUndefined();
    expect(outcome.shouldLogError).toBe(false);
  });

  it("isStale=false・status=readyの場合、applyState:trueでcurrentCompany/membershipを引き継ぎ、isSwitching:falseを返す", () => {
    const result = readyResult();
    const outcome = resolveSelectCompanyOutcome({ isStale: false, result });

    expect(outcome).toEqual({
      isSwitching: false,
      applyState: true,
      status: "ready",
      currentCompany: result.currentCompany,
      membership: result.membership,
      switchError: undefined,
      shouldLogError: false,
    });
  });

  it("isStale=false・status=unpublishedの場合も同様にapplyState:trueになる", () => {
    const result = readyResult({ status: "unpublished", membership: { companyCode: "company-b", configSnapshot: null } });
    const outcome = resolveSelectCompanyOutcome({ isStale: false, result });

    expect(outcome.applyState).toBe(true);
    expect(outcome.status).toBe("unpublished");
    expect(outcome.isSwitching).toBe(false);
  });

  it("isStale=false・status=rejectedの場合、applyState:falseで固定の安全なエラーメッセージを返し、isSwitching:falseになる（既存挙動）", () => {
    const outcome = resolveSelectCompanyOutcome({
      isStale: false,
      result: { status: "rejected", currentCompany: null, membership: null },
    });

    expect(outcome.applyState).toBe(false);
    expect(outcome.isSwitching).toBe(false);
    expect(outcome.switchError).toBe(COMPANY_SWITCH_ERROR_MESSAGE);
    expect(outcome.shouldLogError).toBe(true);
  });

  it("isStale=false・status=errorの場合も同じ固定エラーメッセージになる（既存挙動）", () => {
    const outcome = resolveSelectCompanyOutcome({
      isStale: false,
      result: { status: "error", currentCompany: null, membership: null },
    });

    expect(outcome.switchError).toBe(COMPANY_SWITCH_ERROR_MESSAGE);
    expect(outcome.shouldLogError).toBe(true);
    expect(outcome.isSwitching).toBe(false);
  });
});
