import { describe, it, expect } from "vitest";
import sampleCompanyConfig from "../rules/sample-company/config.json";
import { resolveConcurExpenseTypeMappings } from "../src/lib/concurRegistrationConfig.js";
import { buildConcurRegistrationData } from "../src/lib/concurRegistrationData.js";
import { shouldRenderConcurRegistrationCard } from "../src/concurRegistrationSubmission.js";

// rules/sample-company/config.jsonへローカル確認用に追加した
// concur.expenseTypeMappings（1件、train_local向け）が、実際に
// ConcurRegistrationPanel.jsxの描画条件を満たすことを確認する最小テスト。
//
// concurExpenseTypeId（"TEST_TRAIN_LOCAL"）はローカル確認専用のダミー値で
// あり、実際のConcur側の経費タイプコードではない
// （scripts/generate-config.jsがconcur関連の生成に未対応のため、正規の
// 生成処理を経由できず、config.json自体へ直接追記している。詳細は
// rules/sample-company/config.json内のコメント代わりにこのテストで
// 経緯を残す）。
const TEST_MAPPING = {
  companyId: "sample-company",
  policyId: "normal_expense",
  botExpenseTypeId: "train_local",
  concurExpenseTypeId: "TEST_TRAIN_LOCAL",
};

describe("rules/sample-company/config.jsonのローカル確認用concurマッピング", () => {
  it("resolveConcurExpenseTypeMappings(config)が1件以上返す", () => {
    const mappings = resolveConcurExpenseTypeMappings(sampleCompanyConfig);
    expect(mappings.length).toBeGreaterThanOrEqual(1);
    expect(mappings).toContainEqual(TEST_MAPPING);
  });

  it("train_local（電車・近隣交通費、領収書不要）でbuildConcurRegistrationData()が成功する", () => {
    const company = sampleCompanyConfig.company;
    const result = {
      rule: { id: "r001-g1" },
      expenseType: { id: "train_local", name: "電車・近隣交通費", policyId: "normal_expense", receiptRequired: false },
    };
    const receiptData = {
      transactionDate: "2026-07-29",
      merchantName: null,
      totalAmount: 350,
      currencyCode: "JPY",
    };
    const mappings = resolveConcurExpenseTypeMappings(sampleCompanyConfig);

    const { result: registrationData, error } = buildConcurRegistrationData({
      company,
      result,
      receiptData,
      mappings,
    });

    expect(error).toBeNull();
    expect(registrationData.companyId).toBe("sample-company");
    expect(registrationData.policyId).toBe("normal_expense");
    expect(registrationData.botExpenseTypeId).toBe("train_local");
    expect(registrationData.concurExpenseTypeId).toBe("TEST_TRAIN_LOCAL");

    // ConcurRegistrationPanel.jsxがnullを返さず、ボタンの描画対象になることの確認。
    expect(shouldRenderConcurRegistrationCard({ error, registrationData })).toBe(true);
  });
});
