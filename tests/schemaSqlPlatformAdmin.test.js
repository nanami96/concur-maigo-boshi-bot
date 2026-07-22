import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Phase 8（platform_admin）のDB側設計が、意図した不変条件を満たしているかの
// 静的テキスト回帰テスト。実際のPostgresには接続しない（他の schemaSql*.test.js
// と同じ制約）ため、ここで確認できるのは「その条件を書き忘れていないか」であって、
// 実行時の型・権限の正しさそのものはSupabase実機での手動確認が必要。
const schemaSqlRaw = fs.readFileSync(path.resolve(__dirname, "../supabase/schema.sql"), "utf8");

const schemaSql = schemaSqlRaw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

function extractBlock(startMarker, endMarker) {
  const start = schemaSql.indexOf(startMarker);
  expect(start, `"${startMarker}" が見つかりません`).toBeGreaterThan(-1);
  const end = endMarker ? schemaSql.indexOf(endMarker, start + startMarker.length) : schemaSql.length;
  expect(end, `"${endMarker}" が見つかりません`).toBeGreaterThan(-1);
  return schemaSql.slice(start, end);
}

describe("schema.sql: platform_adminsテーブルは自己参照のみ（自己昇格経路が無い）", () => {
  it("primary keyがauth.users(id)を参照し、on delete cascadeである", () => {
    const block = extractBlock("create table if not exists platform_admins", ");");
    expect(block).toMatch(/user_id uuid primary key references auth\.users \(id\) on delete cascade/);
  });

  it("company_idを一切持たない（company_membersとは別軸であることの保証）", () => {
    const block = extractBlock(
      "create table if not exists platform_admins",
      "comment on table platform_admins",
    );
    expect(block).not.toMatch(/company_id/);
  });

  it("RLSが有効化され、anonの権限が明示的に剥奪されている", () => {
    const block = extractBlock(
      "create table if not exists platform_admins",
      "create policy platform_admins_select_own",
    );
    expect(block).toMatch(/alter table platform_admins enable row level security/);
    expect(block).toMatch(/revoke all on platform_admins from anon/);
  });

  it("SELECTポリシーは自分の行(user_id = auth.uid())だけを許可する", () => {
    const block = extractBlock("create policy platform_admins_select_own", "grant select on platform_admins");
    expect(block).toMatch(/using \(user_id = auth\.uid\(\)\)/);
  });

  it("INSERT/UPDATE/DELETEのポリシーが存在しない（Bootstrap方式：SQL Editorからのみ登録可能）", () => {
    expect(schemaSql).not.toMatch(/create policy platform_admins_(insert|update|delete)/);
  });

  it("authenticatedへのGRANTはselectのみで、insert/update/deleteは含まれない", () => {
    const grantLines = schemaSql
      .split("\n")
      .filter((line) => /grant .* on platform_admins to authenticated/.test(line));
    expect(grantLines.length).toBeGreaterThan(0);
    grantLines.forEach((line) => {
      expect(line).toMatch(/grant select on platform_admins to authenticated/);
    });
  });
});

describe("schema.sql: is_platform_admin()は自分自身(auth.uid())からのみ判定する", () => {
  it("実装がplatform_adminsをuser_id = auth.uid()で問い合わせている", () => {
    const block = extractBlock(
      "create or replace function is_platform_admin()",
      "revoke all on function is_platform_admin()",
    );
    expect(block).toMatch(/select exists \(select 1 from platform_admins where user_id = auth\.uid\(\)\)/);
  });

  it("anonへはEXECUTE権限を付与していない（authenticatedのみ）", () => {
    const block = extractBlock(
      "create or replace function is_platform_admin()",
      "create table if not exists draft_configs",
    );
    expect(block).toMatch(/grant execute on function is_platform_admin\(\) to authenticated;/);
    expect(block).not.toMatch(/grant execute on function is_platform_admin\(\).*anon/);
  });
});

describe("schema.sql: 既存RLS/RPCへのis_platform_admin() OR条件の網羅性", () => {
  const POLICIES_REQUIRING_PLATFORM_ADMIN = [
    "companies_select_admin",
    "companies_update_admin",
    "draft_configs_select_admin",
    "draft_configs_insert_admin",
    "draft_configs_update_admin",
    "draft_configs_delete_admin",
    "published_versions_select_admin",
    "published_versions_insert_admin",
  ];

  POLICIES_REQUIRING_PLATFORM_ADMIN.forEach((policyName) => {
    it(`ポリシー ${policyName} がis_platform_admin()をOR条件として含む`, () => {
      const start = schemaSql.indexOf(`create policy ${policyName}`);
      expect(start, `create policy ${policyName} が見つかりません`).toBeGreaterThan(-1);
      const end = schemaSql.indexOf(";", start);
      const block = schemaSql.slice(start, end);
      expect(block).toMatch(/is_platform_admin\(\)/);
    });
  });

  it("publish_company_draft()の事前チェックがis_platform_admin()を含む", () => {
    const block = extractBlock(
      "create or replace function publish_company_draft",
      "comment on function publish_company_draft",
    );
    expect(block).toMatch(/is_platform_admin\(\)/);
  });

  it("update_company_member_role()がis_platform_admin()を含み、対象行の会社(v_target.company_id)を基準に判定する", () => {
    const block = extractBlock(
      "create or replace function update_company_member_role",
      "comment on function update_company_member_role",
    );
    expect(block).toMatch(/v_is_platform_admin := is_platform_admin\(\)/);
    // 最後のadmin保護のロック・カウントは、呼び出し元自身の所属会社ではなく
    // 「変更対象メンバーの所属会社」(v_target.company_id)を基準にしていることを
    // 確認する（platform_adminが自分の非所属会社を操作するケースで正しく動くため）。
    expect(block).toMatch(/where company_id = v_target\.company_id\s+and role = 'admin'\s+for update/);
  });
});

describe("schema.sql: Phase 8新規RPCはすべてauthenticated限定（anon不可）のSECURITY DEFINER", () => {
  // grant/revoke行はcomment on function同様「型名のみ」のシグネチャで書かれるが、
  // create or replace function自体は仮引数名付き（例: p_company_id uuid）で
  // 書かれているため、定義本体の検索は関数名のみで行う（型シグネチャでは
  // 一致しない）。grant文の照合だけ、型のみのシグネチャを使う。
  const PLATFORM_ADMIN_RPCS = [
    { fnName: "list_platform_companies", grantSignature: "list_platform_companies\\(\\)" },
    { fnName: "create_platform_company", grantSignature: "create_platform_company\\(text, text\\)" },
    { fnName: "regenerate_invite_code", grantSignature: "regenerate_invite_code\\(uuid\\)" },
    {
      fnName: "list_platform_company_members",
      grantSignature: "list_platform_company_members\\(uuid\\)",
    },
  ];

  PLATFORM_ADMIN_RPCS.forEach(({ fnName, grantSignature }) => {
    it(`${fnName}() はsecurity definer・search_path固定で定義されている`, () => {
      const start = schemaSql.indexOf(`create or replace function ${fnName}(`);
      expect(start, `${fnName}の定義が見つかりません`).toBeGreaterThan(-1);
      const end = schemaSql.indexOf("$$;", start);
      const block = schemaSql.slice(start, end);
      expect(block).toMatch(/security definer/);
      expect(block).toMatch(/set search_path = public/);
    });

    it(`${fnName}() はauthenticatedにのみEXECUTE権限が付与され、anonには付与されていない`, () => {
      const grantPattern = new RegExp(`grant execute on function ${grantSignature} to ([^;]+);`);
      const match = schemaSql.match(grantPattern);
      expect(match, `${fnName}へのgrant executeが見つかりません`).not.toBeNull();
      expect(match[1].trim()).toBe("authenticated");
    });

    it(`${fnName}()はauth.uid()自身から判定するis_platform_admin()で権限チェックしている（クライアントの自己申告値を信用しない）`, () => {
      const start = schemaSql.indexOf(`create or replace function ${fnName}(`);
      const end = schemaSql.indexOf("$$;", start);
      const block = schemaSql.slice(start, end);
      expect(block).toMatch(/is_platform_admin\(\)/);
    });
  });
});

describe("schema.sql: create_platform_company()にSQL識別子の曖昧性が無い（実Supabase回帰テスト）", () => {
  it("company_code重複チェックのWHERE句がテーブルエイリアスで修飾されている", () => {
    // 実Supabase環境で実際に発生した不具合の再発防止テスト：
    // この関数はRETURNS TABLEでcompany_codeという出力列を持つため、plpgsql関数
    // 本体ではcompany_codeという識別子がOUTパラメータとしてスコープ全体から見える。
    // 重複チェックのWHERE句でcompanies.company_codeをテーブル修飾せずに
    // 「where company_code = v_normalized_code」と書くと、companies.company_codeなのか
    // OUTパラメータのcompany_codeなのかが曖昧になり、実行時に
    // 「column reference "company_code" is ambiguous」（Postgresエラーコード42702）で
    // 会社作成そのものが失敗する。companiesにエイリアス(c)を付けて曖昧性を解消した
    // 最終版になっていることを確認する。
    const start = schemaSql.indexOf("create or replace function create_platform_company(");
    expect(start, "create_platform_companyの定義が見つかりません").toBeGreaterThan(-1);
    const end = schemaSql.indexOf("$$;", start);
    const block = schemaSql.slice(start, end);

    expect(block).toMatch(/from companies c\s+where c\.company_code = v_normalized_code/);
    expect(block).not.toMatch(/from companies\s+where company_code = v_normalized_code/);
  });
});

describe("schema.sql: 旧anon RPC（list_public_companies/get_public_config）は今回のPhase 8で変更していない", () => {
  it("get_public_config(text)は引き続きanon, authenticatedの両方にEXECUTE権限がある", () => {
    expect(schemaSql).toMatch(
      /grant execute on function get_public_config\(text\) to anon, authenticated;/,
    );
  });

  it("list_public_companies()は引き続きanon, authenticatedの両方にEXECUTE権限がある", () => {
    expect(schemaSql).toMatch(
      /grant execute on function list_public_companies\(\) to anon, authenticated;/,
    );
  });
});
