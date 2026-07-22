import { describe, it, expect } from "vitest";
import { resolveInitialCompanyId } from "../src/resolveInitialCompanyId";

const availableCompanies = [
  { id: "sample-company", label: "サンプル会社" },
  { id: "company-a", label: "A株式会社" },
];

describe("resolveInitialCompanyId", () => {
  it("?company=に実在する会社コードがあればそれを使う", () => {
    const result = resolveInitialCompanyId({
      search: "?company=company-a",
      availableCompanies,
      defaultCompanyId: "sample-company",
    });
    expect(result).toBe("company-a");
  });

  it("クエリが無ければdefaultCompanyIdを使う", () => {
    const result = resolveInitialCompanyId({
      search: "",
      availableCompanies,
      defaultCompanyId: "sample-company",
    });
    expect(result).toBe("sample-company");
  });

  it("存在しない会社コードが指定された場合はdefaultCompanyIdへフォールバックする（任意文字列の受け入れを防ぐ）", () => {
    const result = resolveInitialCompanyId({
      search: "?company=not-a-real-company",
      availableCompanies,
      defaultCompanyId: "sample-company",
    });
    expect(result).toBe("sample-company");
  });

  it("他のクエリパラメータと併用してもcompanyだけを見る", () => {
    const result = resolveInitialCompanyId({
      search: "?foo=bar&company=company-a&baz=qux",
      availableCompanies,
      defaultCompanyId: "sample-company",
    });
    expect(result).toBe("company-a");
  });
});
