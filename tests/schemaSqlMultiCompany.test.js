import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// 「1ユーザー1社」制約を撤廃し、1ユーザーが複数の会社へ所属できる設計へ
// 変更したCommit 1の静的テキスト回帰テスト。実際のPostgresには接続しない
// （他のschemaSql*.test.jsと同じ制約）ため、ここで確認できるのは
// 「意図した条件を書き忘れていないか」であって、実行時の型・権限の正しさ
// そのものはSupabase実機での手動確認が必要。
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

describe("schema.sql: company_membersの制約（1ユーザー複数社所属の許可）", () => {
  it("company_members_user_id_key（unique(user_id)）を追加するADD CONSTRAINTが存在しない", () => {
    expect(schemaSql).not.toMatch(
      /alter table company_members add constraint company_members_user_id_key unique \(user_id\)/,
    );
  });

  it("company_members_user_id_keyを削除するDROP CONSTRAINT（if exists guard付き）が存在する", () => {
    // マーカー文字列そのものが「--」コメント（schemaSql変数では除去済み）のため、
    // 生テキスト側（schemaSqlRaw）に対して確認する。
    const start = schemaSqlRaw.indexOf("do $$\nbegin\n  if exists (\n    select 1 from pg_constraint where conname = 'company_members_user_id_key'");
    expect(start, "company_members_user_id_key削除ブロックが見つかりません").toBeGreaterThan(-1);
    const block = schemaSqlRaw.slice(start, start + 400);
    expect(block).toMatch(/alter table company_members drop constraint company_members_user_id_key;/);
  });

  it("unique(company_id, user_id)はcompany_membersのテーブル定義に引き続き存在する（同一会社への重複登録は禁止のまま）", () => {
    const block = extractBlock("create table if not exists company_members (", ");");
    expect(block).toMatch(/unique \(company_id, user_id\)/);
  });

  it("role in ('user', 'admin')のcheck制約はテーブル定義・Phase 7-1の両方に引き続き存在する（roleの仕様は変更していない）", () => {
    const tableBlock = extractBlock("create table if not exists company_members (", ");");
    expect(tableBlock).toMatch(/check \(role in \('user', 'admin'\)\)/);

    expect(schemaSql).toMatch(
      /alter table company_members add constraint company_members_role_check check \(role in \('user', 'admin'\)\)/,
    );
  });
});

describe("schema.sql: redeem_invite_code()は同一会社への重複所属だけを拒否する", () => {
  const block = extractBlock(
    "create or replace function redeem_invite_code(p_code text)",
    "comment on function redeem_invite_code(text)",
  );

  it("company_membersのexists検査がcompany_id（対象会社）とuser_idの両方で絞り込まれている", () => {
    expect(block).toMatch(
      /exists \(\s*select 1 from company_members\s*where company_members\.user_id = auth\.uid\(\)\s*and company_members\.company_id = v_company\.id\s*\)/,
    );
  });

  it("user_idだけで無条件に所属有無を判定する古いexists検査は存在しない", () => {
    expect(block).not.toMatch(
      /exists \(select 1 from company_members where company_members\.user_id = auth\.uid\(\)\)\s*then/,
    );
  });

  it("招待コードの照合（company解決）が所属確認より先に行われている（同じ会社かどうかを判定するには先に会社を確定させる必要があるため）", () => {
    const codeResolutionIndex = block.indexOf("select * into v_company");
    const membershipCheckIndex = block.indexOf("exists (");
    expect(codeResolutionIndex).toBeGreaterThan(-1);
    expect(membershipCheckIndex).toBeGreaterThan(-1);
    expect(codeResolutionIndex).toBeLessThan(membershipCheckIndex);
  });

  it("roleは引き続き'user'に固定でINSERTされる（権限昇格経路が無いことは変更していない）", () => {
    expect(block).toMatch(/insert into company_members \(company_id, user_id, role\)\s*values \(v_company\.id, auth\.uid\(\), 'user'\);/);
  });

  it("unique_violation例外ハンドラが引き続き存在する（unique(company_id, user_id)による二重防御）", () => {
    expect(block).toMatch(/when unique_violation then/);
    expect(block).toMatch(/raise exception 'already belongs to a company' using errcode = '42710';/);
  });

  it("固定のエラーメッセージ・errcode（'already belongs to a company' / '42710'）は変更していない（既存のclassifyMembershipRpcErrorとの互換性維持）", () => {
    const occurrences = block.match(/'already belongs to a company'/g) || [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2); // exists検査 + unique_violationハンドラ
    expect(block).toMatch(/'already belongs to a company' using errcode = '42710'/);
  });
});

describe("schema.sql: get_my_public_config(p_company_code)は会社を明示指定でき、無条件の先頭行選択を行わない", () => {
  it("旧・引数無し版を明示的にdrop functionしてから作り直している（シグネチャ変更によるオーバーロード共存を防ぐ）", () => {
    const dropIndex = schemaSql.indexOf("drop function if exists get_my_public_config();");
    const createIndex = schemaSql.indexOf("create or replace function get_my_public_config(p_company_code text default null)");
    expect(dropIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeGreaterThan(-1);
    expect(dropIndex).toBeLessThan(createIndex);
  });

  const block = extractBlock(
    "create or replace function get_my_public_config(p_company_code text default null)",
    "comment on function get_my_public_config(text)",
  );

  it("p_company_codeを指定した場合、company_codeとuser_idの両方で絞り込む（クライアントの自己申告を無条件に信用しない）", () => {
    expect(block).toMatch(/where cm\.user_id = auth\.uid\(\)\s*and c\.company_code = p_company_code/);
  });

  it("p_company_code省略時、所属会社が2件以上ある場合はraise exceptionでfail-closedにする（先頭行を勝手に選ばない）", () => {
    expect(block).toMatch(/if v_membership_count > 1 then\s*raise exception 'company must be specified' using errcode = '22023';/);
  });

  it("limit 1やorder byで先頭行だけを機械的に選ぶ実装になっていない", () => {
    expect(block).not.toMatch(/limit 1/i);
  });

  it("EXECUTE権限はauthenticatedのみ（新シグネチャに対して付与されている）", () => {
    expect(schemaSql).toMatch(/grant execute on function get_my_public_config\(text\) to authenticated;/);
  });
});

describe("schema.sql: list_my_companies()はauth.uid()自身の所属会社一覧だけを、最小限のmetadataで返す（Commit 3）", () => {
  const block = extractBlock(
    "create or replace function list_my_companies()",
    "comment on function list_my_companies()",
  );

  it("company_members.user_id = auth.uid()の行だけを対象にしている（他ユーザーの所属は返さない）", () => {
    expect(block).toMatch(/where cm\.user_id = auth\.uid\(\)/);
  });

  it("クライアントからuser_idを受け取るパラメータを持たない（引数無しの関数）", () => {
    expect(schemaSql).toMatch(/create or replace function list_my_companies\(\)\s*returns table/);
  });

  it("戻り値はcompany_code・company_name・roleのみ（company_id等の内部列を含まない）", () => {
    expect(block).toMatch(/returns table \(company_code text, company_name text, role text\)/);
  });

  it("invite_code_hash・draft_configs・published_versions・OAuth/Vault関連の列を一切参照しない", () => {
    expect(block).not.toMatch(/invite_code_hash/);
    expect(block).not.toMatch(/draft_configs/);
    expect(block).not.toMatch(/published_versions/);
    expect(block).not.toMatch(/vault/i);
    expect(block).not.toMatch(/oauth/i);
  });

  it("is_platform_admin()を参照しない（platform_adminでも本人の所属会社だけを返す。全社一覧はlist_platform_companies()の責務）", () => {
    expect(block).not.toMatch(/is_platform_admin/);
  });

  it("company_name・company_codeの順で決定的にORDER BYしている（DBの行順に依存しない）", () => {
    expect(block).toMatch(/order by c\.company_name, c\.company_code;/);
  });

  it("data[0]・LIMIT 1・maybeSingleに相当する縮退を行わない（複数件をそのまま返す設計）", () => {
    expect(block).not.toMatch(/limit 1/i);
  });

  it("SECURITY DEFINERかつsearch_pathを固定している（乗っ取り防止。他のSECURITY DEFINER関数と同じ方針）", () => {
    expect(block).toMatch(/security definer/);
    expect(block).toMatch(/set search_path = public/);
  });

  it("EXECUTE権限はauthenticatedのみに付与されている", () => {
    expect(schemaSql).toMatch(/revoke all on function list_my_companies\(\) from public;/);
    expect(schemaSql).toMatch(/grant execute on function list_my_companies\(\) to authenticated;/);
  });
});

describe("schema.sql: list_my_company_members(p_company_id)は対象会社を明示指定し、他社admin権限では取得できない", () => {
  it("旧・引数無し版を明示的にdrop functionしてから作り直している", () => {
    const dropIndex = schemaSql.indexOf("drop function if exists list_my_company_members();");
    const createIndex = schemaSql.indexOf("create or replace function list_my_company_members(p_company_id uuid default null)");
    expect(dropIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeGreaterThan(-1);
    expect(dropIndex).toBeLessThan(createIndex);
  });

  const block = extractBlock(
    "create or replace function list_my_company_members(p_company_id uuid default null)",
    "comment on function list_my_company_members(uuid)",
  );

  it("呼び出し元が対象会社(v_target_company_id)のadmin、またはplatform_adminであることを検証している", () => {
    expect(block).toMatch(/is_platform_admin\(\)/);
    expect(block).toMatch(
      /exists \(\s*select 1 from company_members\s*where company_members\.company_id = v_target_company_id\s*and company_members\.user_id = auth\.uid\(\)\s*and company_members\.role = 'admin'\s*\)/,
    );
  });

  it("最終的な一覧SELECTはv_target_company_idで絞り込まれている（他社のadminが別会社のp_company_idを渡しても混ざらない）", () => {
    expect(block).toMatch(/where cm\.company_id = v_target_company_id\s*order by cm\.created_at;/);
  });

  it("p_company_id省略時、所属会社がちょうど1件の場合だけ自動解決する（既存1社adminとの後方互換）", () => {
    expect(block).toMatch(/if v_membership_count <> 1 then\s*return;\s*end if;/);
  });

  it("EXECUTE権限は新シグネチャ(uuid)にのみ付与されている", () => {
    expect(schemaSql).toMatch(/grant execute on function list_my_company_members\(uuid\) to authenticated;/);
  });
});

describe("schema.sql: platform_adminsはcompany_membersの制約変更の影響を受けない", () => {
  it("platform_adminsテーブル定義にcompany_idが存在しない（今回の変更でも変わっていない）", () => {
    const block = extractBlock(
      "create table if not exists platform_admins",
      "comment on table platform_admins",
    );
    expect(block).not.toMatch(/company_id/);
  });

  it("is_platform_admin()の実装は変更していない（関数本体はcompany_membersを一切参照しない）", () => {
    // 直後のcomment on function...には説明文として「company_membersとは独立して
    // 判定する」という語が含まれるため、関数本体（as $$ 〜 $$;）だけを対象にする。
    const block = extractBlock(
      "create or replace function is_platform_admin()",
      "comment on function is_platform_admin()",
    );
    expect(block).toMatch(/select exists \(select 1 from platform_admins where user_id = auth\.uid\(\)\)/);
    expect(block).not.toMatch(/company_members/);
  });
});

describe("schema.sql: RLSポリシー（companies/draft_configs/published_versions）は今回変更していない", () => {
  const UNCHANGED_ADMIN_POLICIES = [
    "companies_select_admin",
    "companies_update_admin",
    "draft_configs_select_admin",
    "draft_configs_insert_admin",
    "draft_configs_update_admin",
    "draft_configs_delete_admin",
    "published_versions_select_admin",
    "published_versions_insert_admin",
  ];

  UNCHANGED_ADMIN_POLICIES.forEach((policyName) => {
    it(`${policyName} は対象行のcompany_idに相関するEXISTS条件のまま（company_members_select_ownのRLS自体も変更していない）`, () => {
      const start = schemaSql.indexOf(`create policy ${policyName}`);
      expect(start, `create policy ${policyName} が見つかりません`).toBeGreaterThan(-1);
      const end = schemaSql.indexOf(";", start);
      const block = schemaSql.slice(start, end);
      expect(block).toMatch(/company_members\.user_id = auth\.uid\(\)/);
      expect(block).toMatch(/role = 'admin'/);
    });
  });

  it("company_members_select_ownはuser_id = auth.uid()のみで、company_id等の追加条件を持たない（変更していない）", () => {
    const start = schemaSql.indexOf("create policy company_members_select_own");
    const end = schemaSql.indexOf("grant select on company_members", start);
    const block = schemaSql.slice(start, end);
    expect(block).toMatch(/using \(user_id = auth\.uid\(\)\)/);
  });
});
