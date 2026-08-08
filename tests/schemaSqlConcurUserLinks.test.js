import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Phase 13（Concurログイン ID の user_id × company_id 単位での紐付け保存）の
// DB側設計が、意図した不変条件を満たしているかの静的テキスト回帰テスト。
// tests/schemaSqlConcurOAuthVault.test.jsと同じ制約・同じ方針
// （実際にPostgresへ投入して確認するものではない。書き忘れが無いかの確認）。
const SCHEMA_SQL_PATH = path.resolve(__dirname, "../supabase/schema.sql");
const MIGRATION_SQL_PATH = path.resolve(
  __dirname,
  "../supabase/migrations/20260808120000_concur_user_links.sql",
);

function stripComments(raw) {
  return raw
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function extractBlock(sql, startMarker, endMarker) {
  const start = sql.indexOf(startMarker);
  expect(start, `"${startMarker}" が見つかりません`).toBeGreaterThan(-1);
  const end = endMarker ? sql.indexOf(endMarker, start + startMarker.length) : sql.length;
  expect(end, `"${endMarker}" が見つかりません`).toBeGreaterThan(-1);
  return sql.slice(start, end);
}

const SOURCES = [
  { label: "supabase/schema.sql (Phase 13)", filePath: SCHEMA_SQL_PATH },
  { label: "supabase/migrations/20260808120000_concur_user_links.sql", filePath: MIGRATION_SQL_PATH },
];

describe.each(SOURCES)("$label: concur_user_linksテーブルの制約", ({ filePath }) => {
  const sql = stripComments(fs.readFileSync(filePath, "utf8"));
  const block = extractBlock(sql, "create table if not exists concur_user_links", ");");

  it("user_id・company_idの複合uniqueが存在する", () => {
    expect(block).toMatch(/unique \(user_id, company_id\)/);
  });

  it("user_idはauth.users(id)をon delete cascadeで参照する", () => {
    expect(block).toMatch(/user_id uuid not null references auth\.users \(id\) on delete cascade/);
  });

  it("company_idはcompanies(id)をon delete cascadeで参照する", () => {
    expect(block).toMatch(/company_id uuid not null references companies \(id\) on delete cascade/);
  });

  it("concur_login_idは長さ制限CHECKを持つ", () => {
    expect(block).toMatch(/check \(char_length\(concur_login_id\) between 1 and 320\)/);
  });

  it("verified_atはnot null（未検証の行を許さない）", () => {
    expect(block).toMatch(/verified_at timestamptz not null/);
  });

  it("Concur内部のUser ID（UUID）用の列が無い（concur_user_idのような列名が存在しない）", () => {
    expect(block).not.toMatch(/concur_user_id/);
  });
});

describe.each(SOURCES)("$label: concur_user_linksはRLS有効・grant/policyなし（concur_oauth_connectionsと同じ設計）", ({ filePath }) => {
  const sql = stripComments(fs.readFileSync(filePath, "utf8"));

  it("RLSが有効化されている", () => {
    expect(sql).toMatch(/alter table concur_user_links enable row level security;/);
  });

  it("anon/authenticated/publicからrevoke allされている", () => {
    expect(sql).toMatch(/revoke all on concur_user_links from anon, authenticated, public;/);
  });

  it("concur_user_linksへの直接SELECT/INSERT/UPDATE/DELETE用RLSポリシー（create policy）が存在しない", () => {
    expect(sql).not.toMatch(/create policy [a-z_]*concur_user_links/);
  });

  it("authenticatedへのconcur_user_links直接grant（select/insert/update/delete）が存在しない", () => {
    expect(sql).not.toMatch(/grant [a-z, ]+ on concur_user_links to authenticated;/);
  });
});

describe.each(SOURCES)("$label: get_my_concur_link_status(text)は真偽値のみを返し、concur_login_id自体は返さない", ({ filePath }) => {
  const sql = stripComments(fs.readFileSync(filePath, "utf8"));
  const block = extractBlock(
    sql,
    "create or replace function get_my_concur_link_status(",
    "revoke all on function get_my_concur_link_status",
  );

  it("returns table (has_link boolean, verified_at timestamptz) であり、concur_login_idを含まない", () => {
    const signatureBlock = extractBlock(sql, "create or replace function get_my_concur_link_status(", "$$;");
    expect(signatureBlock).toMatch(/returns table \(has_link boolean, verified_at timestamptz\)/);
    expect(signatureBlock).not.toMatch(/concur_login_id/);
  });

  it("auth.uid()を使う（呼び出し元は通常のauthenticatedセッション）", () => {
    expect(block).toMatch(/auth\.uid\(\)/);
  });

  it("company_membersとのjoinにより所属確認済みの会社だけを対象にする", () => {
    expect(block).toMatch(/join company_members cm/);
  });

  it("authenticatedへのみgrant executeされている", () => {
    expect(sql).toMatch(/grant execute on function get_my_concur_link_status\(text\) to authenticated;/);
  });

  it("publicからrevoke allされている", () => {
    expect(sql).toMatch(/revoke all on function get_my_concur_link_status\(text\) from public;/);
  });
});

describe.each(SOURCES)("$label: unlink_my_concur_user(text)は本人の行だけを削除する", ({ filePath }) => {
  const sql = stripComments(fs.readFileSync(filePath, "utf8"));
  const block = extractBlock(
    sql,
    "create or replace function unlink_my_concur_user(",
    "revoke all on function unlink_my_concur_user",
  );

  it("auth.uid()が無い場合は例外を投げる（fail-closed）", () => {
    expect(block).toMatch(/if auth\.uid\(\) is null then/);
  });

  it("deleteの条件がuser_id = auth\\.uid\\(\\)を含む（他ユーザーの行を削除できない）", () => {
    expect(block).toMatch(/delete from concur_user_links\s*\n\s*where user_id = auth\.uid\(\)/);
  });

  it("authenticatedへのみgrant executeされている", () => {
    expect(sql).toMatch(/grant execute on function unlink_my_concur_user\(text\) to authenticated;/);
  });
});

describe.each(SOURCES)("$label: save_concur_user_link(uuid, uuid, text)はservice_role専用（未検証の値を保存する経路が無い）", ({ filePath }) => {
  const sql = stripComments(fs.readFileSync(filePath, "utf8"));
  const block = extractBlock(
    sql,
    "create or replace function save_concur_user_link(",
    "revoke all on function save_concur_user_link",
  );

  it("public/anon/authenticatedからrevoke allされている", () => {
    expect(sql).toMatch(
      /revoke all on function save_concur_user_link\(uuid, uuid, text\) from public, anon, authenticated;/,
    );
  });

  it("service_roleへのみgrant executeされている", () => {
    expect(sql).toMatch(/grant execute on function save_concur_user_link\(uuid, uuid, text\) to service_role;/);
  });

  it("upsert（on conflict (user_id, company_id) do update）である", () => {
    expect(block).toMatch(/on conflict \(user_id, company_id\)/);
    expect(block).toMatch(/do update set/);
  });

  it("concur_login_id実値がハードコードされていない", () => {
    expect(block).not.toMatch(/concur_login_id\s*=\s*'[^']+'/);
  });
});

describe.each(SOURCES)("$label: get_concur_user_link_for_edge(uuid, uuid)はservice_role専用・returns text（Concur User IDは返さない）", ({ filePath }) => {
  const sql = stripComments(fs.readFileSync(filePath, "utf8"));

  it("public/anon/authenticatedからrevoke allされている", () => {
    expect(sql).toMatch(
      /revoke all on function get_concur_user_link_for_edge\(uuid, uuid\) from public, anon, authenticated;/,
    );
  });

  it("service_roleへのみgrant executeされている", () => {
    expect(sql).toMatch(
      /grant execute on function get_concur_user_link_for_edge\(uuid, uuid\) to service_role;/,
    );
  });

  it("returns text（スカラー）であり、returns tableではない", () => {
    const signatureBlock = extractBlock(
      sql,
      "create or replace function get_concur_user_link_for_edge(",
      "$$;",
    );
    expect(signatureBlock).toMatch(/returns text/);
    expect(signatureBlock).not.toMatch(/returns table/);
  });
});

describe.each(SOURCES)("$label: remove_company_member()はconcur_user_linksの対応行も削除する（Phase 13で追加）", ({ filePath }) => {
  const sql = stripComments(fs.readFileSync(filePath, "utf8"));
  const block = extractBlock(
    sql,
    "create or replace function remove_company_member(",
    "comment on function remove_company_member(uuid) is",
  );

  it("company_membersのdeleteの後にconcur_user_linksのdeleteがある", () => {
    const companyMembersDeleteIndex = block.indexOf("delete from company_members where id = p_member_id");
    const concurLinksDeleteIndex = block.indexOf("delete from concur_user_links");
    expect(companyMembersDeleteIndex).toBeGreaterThan(-1);
    expect(concurLinksDeleteIndex).toBeGreaterThan(companyMembersDeleteIndex);
  });

  it("concur_user_linksのdelete条件はv_target.user_id・v_target.company_idで絞り込む（削除されたcompany_members行のみ対象）", () => {
    expect(block).toMatch(
      /delete from concur_user_links\s*\n\s*where user_id = v_target\.user_id\s*\n\s*and company_id = v_target\.company_id;/,
    );
  });
});

describe("supabase/schema.sqlとMigrationファイルのPhase 13部分が実質的に一致している", () => {
  const schemaSql = stripComments(fs.readFileSync(SCHEMA_SQL_PATH, "utf8"));
  const migrationSql = stripComments(fs.readFileSync(MIGRATION_SQL_PATH, "utf8"));

  function normalize(sql, startMarker, endMarker) {
    return extractBlock(sql, startMarker, endMarker)
      .replace(/\s+/g, " ")
      .trim();
  }

  it("concur_user_linksのテーブル定義（列・CHECK制約）が一致する", () => {
    const schemaBlock = normalize(schemaSql, "create table if not exists concur_user_links", ");");
    const migrationBlock = normalize(migrationSql, "create table if not exists concur_user_links", ");");
    expect(schemaBlock).toBe(migrationBlock);
  });

  it("get_my_concur_link_status()の関数本体が一致する", () => {
    const schemaBlock = normalize(
      schemaSql,
      "create or replace function get_my_concur_link_status(",
      "revoke all on function get_my_concur_link_status",
    );
    const migrationBlock = normalize(
      migrationSql,
      "create or replace function get_my_concur_link_status(",
      "revoke all on function get_my_concur_link_status",
    );
    expect(schemaBlock).toBe(migrationBlock);
  });

  it("unlink_my_concur_user()の関数本体が一致する", () => {
    const schemaBlock = normalize(
      schemaSql,
      "create or replace function unlink_my_concur_user(",
      "revoke all on function unlink_my_concur_user",
    );
    const migrationBlock = normalize(
      migrationSql,
      "create or replace function unlink_my_concur_user(",
      "revoke all on function unlink_my_concur_user",
    );
    expect(schemaBlock).toBe(migrationBlock);
  });

  it("save_concur_user_link()の関数本体が一致する", () => {
    const schemaBlock = normalize(
      schemaSql,
      "create or replace function save_concur_user_link(",
      "revoke all on function save_concur_user_link",
    );
    const migrationBlock = normalize(
      migrationSql,
      "create or replace function save_concur_user_link(",
      "revoke all on function save_concur_user_link",
    );
    expect(schemaBlock).toBe(migrationBlock);
  });

  it("get_concur_user_link_for_edge()の関数本体が一致する", () => {
    const schemaBlock = normalize(
      schemaSql,
      "create or replace function get_concur_user_link_for_edge(",
      "revoke all on function get_concur_user_link_for_edge",
    );
    const migrationBlock = normalize(
      migrationSql,
      "create or replace function get_concur_user_link_for_edge(",
      "revoke all on function get_concur_user_link_for_edge",
    );
    expect(schemaBlock).toBe(migrationBlock);
  });

  it("remove_company_member()の関数本体が一致する", () => {
    const schemaBlock = normalize(
      schemaSql,
      "create or replace function remove_company_member(",
      "comment on function remove_company_member(uuid) is",
    );
    const migrationBlock = normalize(
      migrationSql,
      "create or replace function remove_company_member(",
      "comment on function remove_company_member(uuid) is",
    );
    expect(schemaBlock).toBe(migrationBlock);
  });
});

describe("Concurログイン実値・秘密情報がschema.sql/migrationへ含まれていない", () => {
  it.each(SOURCES)("$label にダミー以外のログインID・トークンらしき実値が無い", ({ filePath }) => {
    const raw = fs.readFileSync(filePath, "utf8");
    expect(raw).not.toMatch(/concur_login_id['"]?\s*[:=]\s*['"][^'"]{3,}@[^'"]{3,}['"]/);
    expect(raw).not.toMatch(/refresh_token['"]?\s*[:=]\s*['"](?!null)[A-Za-z0-9._-]{10,}/);
  });
});
