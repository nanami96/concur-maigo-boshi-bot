import { describe, it, expect } from "vitest";
import { countActivePolicies, shouldShowPolicySection } from "../src/lib/policyVisibility";

describe("countActivePolicies", () => {
  it("policiesが未指定/配列でない場合は0件として扱う", () => {
    expect(countActivePolicies(undefined)).toBe(0);
    expect(countActivePolicies(null)).toBe(0);
    expect(countActivePolicies("not-an-array")).toBe(0);
  });

  it("空配列は0件", () => {
    expect(countActivePolicies([])).toBe(0);
  });

  it("enabled: 'Y'のポリシーだけを数える（'N'や不正値は数えない）", () => {
    const policies = [
      { policy_id: "p1", policy_name: "通常経費", enabled: "Y" },
      { policy_id: "p2", policy_name: "出張経費", enabled: "N" },
      { policy_id: "p3", policy_name: "旧ポリシー", enabled: "N" },
    ];
    expect(countActivePolicies(policies)).toBe(1);
  });

  it("有効ポリシーが複数あれば複数として数える", () => {
    const policies = [
      { policy_id: "p1", policy_name: "通常経費", enabled: "Y" },
      { policy_id: "p2", policy_name: "出張経費", enabled: "Y" },
    ];
    expect(countActivePolicies(policies)).toBe(2);
  });
});

describe("shouldShowPolicySection", () => {
  it("有効ポリシーが0件なら非表示", () => {
    expect(shouldShowPolicySection([])).toBe(false);
    expect(shouldShowPolicySection(undefined)).toBe(false);
  });

  it("有効ポリシーが1件なら非表示", () => {
    const policies = [{ policy_id: "p1", policy_name: "通常経費", enabled: "Y" }];
    expect(shouldShowPolicySection(policies)).toBe(false);
  });

  it("有効ポリシーが2件なら表示", () => {
    const policies = [
      { policy_id: "p1", policy_name: "通常経費", enabled: "Y" },
      { policy_id: "p2", policy_name: "出張経費", enabled: "Y" },
    ];
    expect(shouldShowPolicySection(policies)).toBe(true);
  });

  it("有効ポリシーが3件以上でも表示", () => {
    const policies = [
      { policy_id: "p1", policy_name: "通常経費", enabled: "Y" },
      { policy_id: "p2", policy_name: "出張経費", enabled: "Y" },
      { policy_id: "p3", policy_name: "接待費", enabled: "Y" },
    ];
    expect(shouldShowPolicySection(policies)).toBe(true);
  });

  it("無効ポリシーが混ざっていても、有効なものだけで判定する", () => {
    const policies = [
      { policy_id: "p1", policy_name: "通常経費", enabled: "Y" },
      { policy_id: "p2", policy_name: "出張経費", enabled: "Y" },
      { policy_id: "p3", policy_name: "廃止済み", enabled: "N" },
    ];
    // 有効なのは2件のみ（p3は無効）なので表示、という判定になることを確認
    expect(shouldShowPolicySection(policies)).toBe(true);

    const onlyOneActive = [
      { policy_id: "p1", policy_name: "通常経費", enabled: "Y" },
      { policy_id: "p2", policy_name: "廃止済みA", enabled: "N" },
      { policy_id: "p3", policy_name: "廃止済みB", enabled: "N" },
    ];
    // 有効なのは1件だけなので、全体の件数が3件でも非表示
    expect(shouldShowPolicySection(onlyOneActive)).toBe(false);
  });
});
