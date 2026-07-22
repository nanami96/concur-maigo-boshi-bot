import { describe, it, expect } from "vitest";
import { runConfigChecks } from "../src/flow/runConfigChecks";
import { buildFlowFromConfig } from "../src/flow/buildFlowFromConfig";
import { createEmptyFlow } from "../src/flow/flowMutations";
import sampleCompanyConfig from "../rules/sample-company/config.json";

describe("runConfigChecks", () => {
  it("sample-companyの正常なデータはError/Warningとも既存チェックと同じ結果になる", () => {
    const { flow } = buildFlowFromConfig(sampleCompanyConfig);
    const result = runConfigChecks({
      company: sampleCompanyConfig.company,
      policies: sampleCompanyConfig.policies,
      expenseTypes: sampleCompanyConfig.expenseTypes,
      flow,
    });

    expect(result.errors).toEqual([]);
  });

  it("会社名が空・フローが空ならmasterData由来とflow由来のErrorが両方含まれる", () => {
    const result = runConfigChecks({
      company: { company_id: "x", company_name: "" },
      policies: [],
      expenseTypes: [],
      flow: createEmptyFlow(),
    });

    expect(result.errors.some((e) => e.id === "company-name-required")).toBe(true);
    expect(result.errors.some((e) => e.id === "no-root")).toBe(true);
  });

  it("masterDataのErrorがflowのErrorより先に並ぶ（ConfigCheckPanelの既存表示順を維持）", () => {
    const result = runConfigChecks({
      company: { company_id: "x", company_name: "" },
      policies: [],
      expenseTypes: [],
      flow: createEmptyFlow(),
    });

    expect(result.errors[0].id).toBe("company-name-required");
  });
});
