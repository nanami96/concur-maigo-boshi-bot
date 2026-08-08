import { describe, it, expect, vi } from "vitest";
import { resolveCurrentCompany, resolveCompanySwitchError, COMPANY_SWITCH_ERROR_MESSAGE } from "../src/data/resolveCurrentCompany";

function companyOf(overrides = {}) {
  return { companyCode: "company-a", companyName: "A株式会社", role: "user", ...overrides };
}

function membershipOf(overrides = {}) {
  return {
    companyCode: "company-a",
    companyName: "A株式会社",
    role: "user",
    configSnapshot: { questions: [] },
    publishedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function buildDeps(overrides = {}) {
  return {
    fetchCompanies: vi.fn(),
    fetchMembership: vi.fn(),
    readLastCompanyCode: vi.fn().mockReturnValue(null),
    clearLastCompanyCode: vi.fn(),
    ...overrides,
  };
}

describe("resolveCurrentCompany（list_my_companies()→currentCompany決定→get_my_public_config()の2段階パイプライン）", () => {
  it("所属0件の場合、no-membershipになり、get_my_public_config()を一切呼ばない", async () => {
    const deps = buildDeps({
      fetchCompanies: vi.fn().mockResolvedValue({ companies: [], error: null }),
    });

    const result = await resolveCurrentCompany(deps);

    expect(result).toEqual({ status: "no-membership", currentCompany: null, membership: null, companies: [] });
    expect(deps.fetchMembership).not.toHaveBeenCalled();
    expect(deps.readLastCompanyCode).not.toHaveBeenCalled();
  });

  it("所属1件の場合、その会社を自動選択し、その会社のcompanyCodeでget_my_public_config()を呼ぶ", async () => {
    const companies = [companyOf()];
    const membership = membershipOf();
    const deps = buildDeps({
      fetchCompanies: vi.fn().mockResolvedValue({ companies, error: null }),
      fetchMembership: vi.fn().mockResolvedValue({ membership, error: null }),
    });

    const result = await resolveCurrentCompany(deps);

    expect(result).toEqual({ status: "ready", currentCompany: companies[0], membership, companies });
    expect(deps.fetchMembership).toHaveBeenCalledWith("company-a");
    // 所属1件はサーバー側の一覧だけで一意に決まるため、localStorageは不要。
    expect(deps.readLastCompanyCode).not.toHaveBeenCalled();
  });

  it("所属1件だが未公開の場合、statusがunpublishedになる", async () => {
    const companies = [companyOf()];
    const membership = membershipOf({ configSnapshot: null, publishedAt: null });
    const deps = buildDeps({
      fetchCompanies: vi.fn().mockResolvedValue({ companies, error: null }),
      fetchMembership: vi.fn().mockResolvedValue({ membership, error: null }),
    });

    const result = await resolveCurrentCompany(deps);

    expect(result.status).toBe("unpublished");
    expect(result.currentCompany).toEqual(companies[0]);
  });

  it("所属2件以上・有効なlastCompanyCodeがある場合、該当会社を選択しconfigを取得する（先頭会社は選ばない）", async () => {
    const companies = [companyOf({ companyCode: "company-a" }), companyOf({ companyCode: "company-b", role: "admin" })];
    const membership = membershipOf({ companyCode: "company-b", role: "admin" });
    const deps = buildDeps({
      fetchCompanies: vi.fn().mockResolvedValue({ companies, error: null }),
      fetchMembership: vi.fn().mockResolvedValue({ membership, error: null }),
      readLastCompanyCode: vi.fn().mockReturnValue("company-b"),
    });

    const result = await resolveCurrentCompany(deps);

    expect(result).toEqual({ status: "ready", currentCompany: companies[1], membership, companies });
    expect(deps.fetchMembership).toHaveBeenCalledWith("company-b");
    expect(deps.clearLastCompanyCode).not.toHaveBeenCalled();
  });

  it("所属2件以上・lastCompanyCodeが既に所属外の場合、localStorageを破棄しselection-requiredになる（get_my_public_config()は呼ばない）", async () => {
    const companies = [companyOf({ companyCode: "company-a" }), companyOf({ companyCode: "company-b" })];
    const deps = buildDeps({
      fetchCompanies: vi.fn().mockResolvedValue({ companies, error: null }),
      readLastCompanyCode: vi.fn().mockReturnValue("company-removed"),
    });

    const result = await resolveCurrentCompany(deps);

    expect(result).toEqual({ status: "selection-required", currentCompany: null, membership: null, companies });
    expect(deps.clearLastCompanyCode).toHaveBeenCalledTimes(1);
    expect(deps.fetchMembership).not.toHaveBeenCalled();
  });

  it("所属2件以上・lastCompanyCodeが無い場合、先頭会社(companies[0])を機械的に選ばずselection-requiredになる（get_my_public_config()は呼ばない）", async () => {
    const companies = [companyOf({ companyCode: "company-a" }), companyOf({ companyCode: "company-b" })];
    const deps = buildDeps({
      fetchCompanies: vi.fn().mockResolvedValue({ companies, error: null }),
      readLastCompanyCode: vi.fn().mockReturnValue(null),
    });

    const result = await resolveCurrentCompany(deps);

    expect(result).toEqual({ status: "selection-required", currentCompany: null, membership: null, companies });
    expect(deps.fetchMembership).not.toHaveBeenCalled();
    expect(deps.clearLastCompanyCode).not.toHaveBeenCalled();
  });

  it("会社一覧の取得でエラーの場合、statusがerrorになる", async () => {
    const deps = buildDeps({
      fetchCompanies: vi.fn().mockResolvedValue({ companies: [], error: { type: "unknown", message: "boom" } }),
    });

    const result = await resolveCurrentCompany(deps);

    expect(result).toEqual({ status: "error", currentCompany: null, membership: null, companies: [] });
    expect(deps.fetchMembership).not.toHaveBeenCalled();
  });

  it("currentCompany確定後のconfig取得でエラーの場合、statusがerrorになる", async () => {
    const companies = [companyOf()];
    const deps = buildDeps({
      fetchCompanies: vi.fn().mockResolvedValue({ companies, error: null }),
      fetchMembership: vi.fn().mockResolvedValue({ membership: null, error: { type: "network", message: "boom" } }),
    });

    const result = await resolveCurrentCompany(deps);

    expect(result).toEqual({ status: "error", currentCompany: null, membership: null, companies });
  });

  it("一覧には存在したのにconfig取得時には見つからない（競合）場合も、矛盾したconfigを使わずerrorにする", async () => {
    const companies = [companyOf()];
    const deps = buildDeps({
      fetchCompanies: vi.fn().mockResolvedValue({ companies, error: null }),
      fetchMembership: vi.fn().mockResolvedValue({ membership: null, error: null }),
    });

    const result = await resolveCurrentCompany(deps);

    expect(result).toEqual({ status: "error", currentCompany: null, membership: null, companies });
  });

  it("既存1社ユーザーの動作が壊れない（1件→自動選択→ready、という一連の流れ）", async () => {
    const companies = [companyOf({ companyCode: "sample-company", companyName: "サンプル会社", role: "admin" })];
    const membership = membershipOf({
      companyCode: "sample-company",
      companyName: "サンプル会社",
      role: "admin",
      configSnapshot: { questions: [], rules: [] },
    });
    const deps = buildDeps({
      fetchCompanies: vi.fn().mockResolvedValue({ companies, error: null }),
      fetchMembership: vi.fn().mockResolvedValue({ membership, error: null }),
    });

    const result = await resolveCurrentCompany(deps);

    expect(result.status).toBe("ready");
    expect(result.currentCompany).toEqual({
      companyCode: "sample-company",
      companyName: "サンプル会社",
      role: "admin",
    });
    expect(result.membership).toBe(membership);
  });
});

describe("resolveCompanySwitchError（Commit 5：会社切替失敗時の固定・安全なユーザー向けメッセージ）", () => {
  it("切替成功（ready/unpublished）の場合はnull（エラー無し）", () => {
    expect(resolveCompanySwitchError("ready")).toBeNull();
    expect(resolveCompanySwitchError("unpublished")).toBeNull();
  });

  it("切替失敗（rejected/error）の場合は固定メッセージを返す", () => {
    expect(resolveCompanySwitchError("rejected")).toBe(COMPANY_SWITCH_ERROR_MESSAGE);
    expect(resolveCompanySwitchError("error")).toBe(COMPANY_SWITCH_ERROR_MESSAGE);
  });

  it("メッセージは固定文言のみで、companyCode等の動的な内部情報を含まない", () => {
    expect(COMPANY_SWITCH_ERROR_MESSAGE).toBe("会社の切り替えに失敗しました。時間をおいてもう一度お試しください。");
  });
});
