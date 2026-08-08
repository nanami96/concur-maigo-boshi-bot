import { describe, it, expect, vi } from "vitest";
import { selectCompany } from "../src/data/resolveCurrentCompany";

function companyOf(overrides = {}) {
  return { companyCode: "company-a", companyName: "A株式会社", role: "user", ...overrides };
}

function membershipOf(overrides = {}) {
  return {
    companyCode: "company-b",
    companyName: "B株式会社",
    role: "user",
    configSnapshot: { questions: [] },
    publishedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

describe("selectCompany（利用者による明示的な会社切替。Commit 4）", () => {
  it("companiesに実在するcompanyCodeを選択し、config取得に成功した場合、readyとcurrentCompany/membershipを返す", async () => {
    const companies = [companyOf({ companyCode: "company-a" }), companyOf({ companyCode: "company-b" })];
    const membership = membershipOf();
    const fetchMembership = vi.fn().mockResolvedValue({ membership, error: null });

    const result = await selectCompany({ companyCode: "company-b", companies, fetchMembership });

    expect(result).toEqual({
      status: "ready",
      currentCompany: companies[1],
      membership,
    });
    expect(fetchMembership).toHaveBeenCalledWith("company-b");
  });

  it("未公開の会社を選択した場合、unpublishedになる", async () => {
    const companies = [companyOf({ companyCode: "company-b" })];
    const membership = membershipOf({ configSnapshot: null, publishedAt: null });
    const fetchMembership = vi.fn().mockResolvedValue({ membership, error: null });

    const result = await selectCompany({ companyCode: "company-b", companies, fetchMembership });

    expect(result.status).toBe("unpublished");
  });

  it("companiesに存在しないcompanyCodeを指定した場合、fail-closedでrejectedを返し、get_my_public_config()を呼ばない", async () => {
    const companies = [companyOf({ companyCode: "company-a" })];
    const fetchMembership = vi.fn();

    const result = await selectCompany({ companyCode: "company-not-mine", companies, fetchMembership });

    expect(result).toEqual({ status: "rejected", currentCompany: null, membership: null });
    expect(fetchMembership).not.toHaveBeenCalled();
  });

  it("config取得がエラーの場合、errorを返す（呼び出し元はcurrentCompanyを更新してはならない）", async () => {
    const companies = [companyOf({ companyCode: "company-b" })];
    const fetchMembership = vi.fn().mockResolvedValue({ membership: null, error: { type: "network", message: "boom" } });

    const result = await selectCompany({ companyCode: "company-b", companies, fetchMembership });

    expect(result).toEqual({ status: "error", currentCompany: null, membership: null });
  });

  it("一覧には存在したが、config取得時には既に所属していない（競合）場合、rejectedを返す", async () => {
    const companies = [companyOf({ companyCode: "company-b" })];
    const fetchMembership = vi.fn().mockResolvedValue({ membership: null, error: null });

    const result = await selectCompany({ companyCode: "company-b", companies, fetchMembership });

    expect(result).toEqual({ status: "rejected", currentCompany: null, membership: null });
  });
});
