import { describe, it, expect } from "vitest";
import { resolveMembershipFromPublicConfigRow } from "../supabase/functions/create-concur-quick-expense/resolveMembershipFromPublicConfigRow.js";

// get_my_public_config() RPC（supabase/schema.sql参照）の戻り値の形
// { company_code, company_name, role, config_snapshot, published_at } を
// 想定した行データから、認証・所属確認・Concur mapping検証に必要な
// 最小限の情報だけを取り出せることを確認する。Deno/Supabaseクライアントには
// 一切依存しないため、実際のRPC呼び出しは行わない。
//
// mappingの値（Concur Expense Type Code）はすべてテスト専用のダミー値であり、
// 実際のConcur側のコードではない。

describe("resolveMembershipFromPublicConfigRow", () => {
  it("company_codeを含む行から{company_code, role, concurExpenseTypeMappings}を取り出す", () => {
    const row = {
      company_code: "sample-company",
      company_name: "サンプル会社",
      role: "user",
      config_snapshot: { questions: [], rules: [] },
      published_at: "2026-07-01T00:00:00Z",
    };

    expect(resolveMembershipFromPublicConfigRow(row)).toEqual({
      company_code: "sample-company",
      role: "user",
      concurExpenseTypeMappings: [],
    });
  });

  it("config_snapshot.concur.expenseTypeMappingsが存在する場合はそのまま取り出す", () => {
    const mappings = [
      { companyId: "sample-company", policyId: "normal_expense", botExpenseTypeId: "taxi", concurExpenseTypeId: "TEST_TAXI" },
    ];
    const row = {
      company_code: "sample-company",
      role: "user",
      config_snapshot: { questions: [], rules: [], concur: { expenseTypeMappings: mappings } },
      published_at: "2026-07-01T00:00:00Z",
    };

    expect(resolveMembershipFromPublicConfigRow(row).concurExpenseTypeMappings).toEqual(mappings);
  });

  it("未所属（RPCが0件を返した結果、rowがundefined）の場合はnull", () => {
    expect(resolveMembershipFromPublicConfigRow(undefined)).toBeNull();
  });

  it("rowがnullの場合もnull", () => {
    expect(resolveMembershipFromPublicConfigRow(null)).toBeNull();
  });

  it("company_codeが空文字の場合はnull（安全側）", () => {
    expect(resolveMembershipFromPublicConfigRow({ company_code: "", role: "user" })).toBeNull();
  });

  it("company_codeが無い（undefined）場合はnull", () => {
    expect(resolveMembershipFromPublicConfigRow({ role: "admin" })).toBeNull();
  });

  it("company_codeが文字列でない場合もnull", () => {
    expect(resolveMembershipFromPublicConfigRow({ company_code: 123, role: "user" })).toBeNull();
  });

  it("所属していても未公開でconfig_snapshot/published_atがnullでも、company_code/roleは取り出せ、mappingは空配列になる", () => {
    // get_my_public_config()のコメント通り、未公開の会社はconfig_snapshot/
    // published_atがnullになるが、company_code/roleは所属していれば必ず埋まる。
    const row = {
      company_code: "not-yet-published",
      company_name: "未公開の会社",
      role: "admin",
      config_snapshot: null,
      published_at: null,
    };

    expect(resolveMembershipFromPublicConfigRow(row)).toEqual({
      company_code: "not-yet-published",
      role: "admin",
      concurExpenseTypeMappings: [],
    });
  });

  it("config_snapshotにconcurキー自体が無い（Phase 11適用前に公開された古いconfig_snapshot）場合も空配列になる", () => {
    const row = {
      company_code: "sample-company",
      role: "user",
      config_snapshot: { questions: [], rules: [] },
      published_at: "2025-01-01T00:00:00Z",
    };

    expect(resolveMembershipFromPublicConfigRow(row).concurExpenseTypeMappings).toEqual([]);
  });

  it("expenseTypeMappingsが配列でない不正な形の場合も空配列になる（安全側）", () => {
    const row = {
      company_code: "sample-company",
      role: "user",
      config_snapshot: { concur: { expenseTypeMappings: "not-an-array" } },
    };

    expect(resolveMembershipFromPublicConfigRow(row).concurExpenseTypeMappings).toEqual([]);
  });

  it("roleが無い場合はroleをnullとして扱う（company_codeさえあれば所属自体は成立するため）", () => {
    expect(resolveMembershipFromPublicConfigRow({ company_code: "sample-company" })).toEqual({
      company_code: "sample-company",
      role: null,
      concurExpenseTypeMappings: [],
    });
  });

  it("company_id（Supabase内部UUID相当）が紛れ込んでいても、company_codeが無ければnull（UUIDとの取り違え防止）", () => {
    // このEdge Functionが解決しようとしているのは必ずcompany_code。
    // company_membersの生の行（company_id, role）のような形が誤って渡された
    // 場合でも、company_codeキーが無い以上は所属なしとして安全側に倒れる。
    expect(resolveMembershipFromPublicConfigRow({ company_id: "11111111-2222-3333-4444-555555555555", role: "user" })).toBeNull();
  });
});
