import { describe, it, expect, vi } from "vitest";
import { resolveCurrentCompany } from "../src/data/resolveCurrentCompany";

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

describe("resolveCurrentCompany（起動時にどの会社をcurrentCompanyにするか）", () => {
  it("所属0件の場合、no-membershipになる", async () => {
    const fetchMembership = vi.fn().mockResolvedValue({ membership: null, error: null, ambiguous: false });
    const readLastCompanyCode = vi.fn().mockReturnValue(null);
    const clearLastCompanyCode = vi.fn();

    const result = await resolveCurrentCompany({ fetchMembership, readLastCompanyCode, clearLastCompanyCode });

    expect(result).toEqual({ status: "no-membership", currentCompany: null, membership: null });
    expect(fetchMembership).toHaveBeenCalledWith();
    // 所属0件の時点でlocalStorageを参照する必要は無い。
    expect(readLastCompanyCode).not.toHaveBeenCalled();
  });

  it("所属1件の場合、サーバー側の自動解決結果をそのままcurrentCompanyにする（既存1社利用者との後方互換）", async () => {
    const membership = membershipOf();
    const fetchMembership = vi.fn().mockResolvedValue({ membership, error: null, ambiguous: false });
    const readLastCompanyCode = vi.fn();
    const clearLastCompanyCode = vi.fn();

    const result = await resolveCurrentCompany({ fetchMembership, readLastCompanyCode, clearLastCompanyCode });

    expect(result).toEqual({
      status: "ready",
      currentCompany: { companyCode: "company-a", companyName: "A株式会社", role: "user" },
      membership,
    });
    // 所属1件はサーバー側で既に一意に解決済みのため、localStorageは不要。
    expect(readLastCompanyCode).not.toHaveBeenCalled();
  });

  it("所属1件だが未公開の場合、statusがunpublishedになる", async () => {
    const membership = membershipOf({ configSnapshot: null, publishedAt: null });
    const fetchMembership = vi.fn().mockResolvedValue({ membership, error: null, ambiguous: false });

    const result = await resolveCurrentCompany({
      fetchMembership,
      readLastCompanyCode: vi.fn(),
      clearLastCompanyCode: vi.fn(),
    });

    expect(result.status).toBe("unpublished");
    expect(result.currentCompany).toEqual({ companyCode: "company-a", companyName: "A株式会社", role: "user" });
  });

  it("所属2件以上・localStorageにlastCompanyCodeが無い場合、先頭を機械的に選ばずselection-requiredになる", async () => {
    const fetchMembership = vi.fn().mockResolvedValue({ membership: null, error: null, ambiguous: true });
    const readLastCompanyCode = vi.fn().mockReturnValue(null);
    const clearLastCompanyCode = vi.fn();

    const result = await resolveCurrentCompany({ fetchMembership, readLastCompanyCode, clearLastCompanyCode });

    expect(result).toEqual({ status: "selection-required", currentCompany: null, membership: null });
    expect(fetchMembership).toHaveBeenCalledTimes(1);
    expect(clearLastCompanyCode).not.toHaveBeenCalled();
  });

  it("所属2件以上・localStorageのlastCompanyCodeに今も所属している場合、その会社を明示指定で再取得し復元する", async () => {
    const restoredMembership = membershipOf({ companyCode: "company-b", companyName: "B株式会社", role: "admin" });
    const fetchMembership = vi
      .fn()
      .mockResolvedValueOnce({ membership: null, error: null, ambiguous: true })
      .mockResolvedValueOnce({ membership: restoredMembership, error: null, ambiguous: false });
    const readLastCompanyCode = vi.fn().mockReturnValue("company-b");
    const clearLastCompanyCode = vi.fn();

    const result = await resolveCurrentCompany({ fetchMembership, readLastCompanyCode, clearLastCompanyCode });

    expect(result).toEqual({
      status: "ready",
      currentCompany: { companyCode: "company-b", companyName: "B株式会社", role: "admin" },
      membership: restoredMembership,
    });
    expect(fetchMembership).toHaveBeenNthCalledWith(1);
    expect(fetchMembership).toHaveBeenNthCalledWith(2, "company-b");
    expect(clearLastCompanyCode).not.toHaveBeenCalled();
  });

  it("所属2件以上・localStorageのlastCompanyCodeに既に所属していない場合、localStorageを破棄しselection-requiredになる", async () => {
    const fetchMembership = vi
      .fn()
      .mockResolvedValueOnce({ membership: null, error: null, ambiguous: true })
      .mockResolvedValueOnce({ membership: null, error: null, ambiguous: false });
    const readLastCompanyCode = vi.fn().mockReturnValue("company-removed");
    const clearLastCompanyCode = vi.fn();

    const result = await resolveCurrentCompany({ fetchMembership, readLastCompanyCode, clearLastCompanyCode });

    expect(result).toEqual({ status: "selection-required", currentCompany: null, membership: null });
    expect(clearLastCompanyCode).toHaveBeenCalledTimes(1);
  });

  it("最初の取得でエラーの場合、statusがerrorになる", async () => {
    const fetchMembership = vi.fn().mockResolvedValue({
      membership: null,
      error: { type: "unknown", message: "boom" },
      ambiguous: false,
    });

    const result = await resolveCurrentCompany({
      fetchMembership,
      readLastCompanyCode: vi.fn(),
      clearLastCompanyCode: vi.fn(),
    });

    expect(result).toEqual({ status: "error", currentCompany: null, membership: null });
  });

  it("lastCompanyCodeでの再取得時にエラーが起きた場合も、statusがerrorになる（selection-requiredへは倒さない）", async () => {
    const fetchMembership = vi
      .fn()
      .mockResolvedValueOnce({ membership: null, error: null, ambiguous: true })
      .mockResolvedValueOnce({ membership: null, error: { type: "network", message: "boom" }, ambiguous: false });
    const clearLastCompanyCode = vi.fn();

    const result = await resolveCurrentCompany({
      fetchMembership,
      readLastCompanyCode: vi.fn().mockReturnValue("company-b"),
      clearLastCompanyCode,
    });

    expect(result).toEqual({ status: "error", currentCompany: null, membership: null });
    // 通信エラー等でlocalStorageの値自体が無効だったかは分からないため、破棄しない。
    expect(clearLastCompanyCode).not.toHaveBeenCalled();
  });
});
