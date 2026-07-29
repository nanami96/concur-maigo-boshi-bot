import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Phase 12（Concur OAuth Refresh TokenのSupabase Vault保存）のDB側設計が、
// 意図した不変条件を満たしているかの静的テキスト回帰テスト。
//
// 【重要・実行環境の制約】このプロジェクトにはローカルPostgres/Docker/Podman
// 環境が無く、本テストはSQLを実際にPostgresへ投入して確認するものではない
// （他の schemaSql*.test.js と同じ制約）。ここで確認できるのは「意図した
// SQL構造・条件式を書き忘れていないか」であり、実行時の型・ロック・並行実行
// 挙動そのものはSupabase実機（または検証環境）での手動確認が必要。
//
// supabase/schema.sqlとsupabase/migrations/20260729115405_concur_oauth_vault.sql
// の両方に同じアサーションを適用し、2ファイルが実質的に一致していることも
// あわせて確認する。
const SCHEMA_SQL_PATH = path.resolve(__dirname, "../supabase/schema.sql");
const MIGRATION_SQL_PATH = path.resolve(
  __dirname,
  "../supabase/migrations/20260729115405_concur_oauth_vault.sql",
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
  { label: "supabase/schema.sql (Phase 12)", filePath: SCHEMA_SQL_PATH },
  { label: "supabase/migrations/20260729115405_concur_oauth_vault.sql", filePath: MIGRATION_SQL_PATH },
];

describe.each(SOURCES)("$label: concur_oauth_connectionsテーブルの状態整合性CHECK", ({ filePath }) => {
  const sql = stripComments(fs.readFileSync(filePath, "utf8"));

  it("last_error_codeの長さ制限CHECKが存在する", () => {
    const block = extractBlock(sql, "create table if not exists concur_oauth_connections", ");");
    expect(block).toMatch(/check \(last_error_code is null or char_length\(last_error_code\) <= 100\)/);
  });

  it("rotating中だけlease_id・lock_expires_atが非NULLになる不変条件CHECKが存在する", () => {
    const block = extractBlock(sql, "create table if not exists concur_oauth_connections", ");");
    expect(block).toMatch(
      /status = 'rotating' and lease_id is not null and lock_expires_at is not null/,
    );
    expect(block).toMatch(
      /status <> 'rotating' and lease_id is null and lock_expires_at is null/,
    );
  });
});

describe.each(SOURCES)(
  "$label: get_concur_refresh_token_for_edge()はVault Secretの存在・非空をリース獲得と同一トランザクションで確認する",
  ({ filePath }) => {
    const sql = stripComments(fs.readFileSync(filePath, "utf8"));
    const block = extractBlock(
      sql,
      "create or replace function get_concur_refresh_token_for_edge(",
      "revoke all on function get_concur_refresh_token_for_edge(uuid)",
    );

    it("単一のUPDATE ... FROM vault.decrypted_secrets ... RETURNINGで構成されている（2段階のUPDATE→SELECTではない）", () => {
      expect(block).toMatch(/update concur_oauth_connections c/);
      expect(block).toMatch(/from vault\.decrypted_secrets vs/);
      expect(block).toMatch(/returning c\.id as connection_id, c\.lease_id as lease_id, vs\.decrypted_secret as refresh_token/);
      // 旧実装（UPDATEの後で別途SELECT）の痕跡が残っていないこと。
      expect(block).not.toMatch(/into v_connection_id, v_vault_secret_id/);
      expect(block).not.toMatch(/select v_connection_id, v_lease_id, vs\.decrypted_secret/);
    });

    it("vault.decrypted_secretsを明示的にスキーマ修飾している（vaultを省略していない）", () => {
      expect(block).toMatch(/vault\.decrypted_secrets/);
      expect(block).not.toMatch(/[^.]\bdecrypted_secrets\b/);
    });

    it("decrypted_secretがnullでないことを確認している", () => {
      expect(block).toMatch(/vs\.decrypted_secret is not null/);
    });

    it("decrypted_secretがtrim後に空文字でないことを確認している（空白のみを弾く）", () => {
      expect(block).toMatch(/trim\(vs\.decrypted_secret\) <> ''/);
    });

    it("company_id指定時とnull時の条件に明示的な括弧がある", () => {
      expect(block).toMatch(
        /\(\s*\(p_company_id is null and c\.company_id is null\)\s*\n?\s*or c\.company_id = p_company_id\s*\)/,
      );
    });

    it("Refresh Token実値がハードコードされていない", () => {
      expect(block).not.toMatch(/refresh_token\s*=\s*'[^']+'/);
    });

    it("RAISE/NOTICEでTokenを出していない", () => {
      expect(block).not.toMatch(/raise (notice|exception|warning)/i);
    });
  },
);

describe.each(SOURCES)("$label: statusの意味が確定している（inactiveは取得対象外）", ({ filePath }) => {
  const sql = stripComments(fs.readFileSync(filePath, "utf8"));
  const block = extractBlock(
    sql,
    "create or replace function get_concur_refresh_token_for_edge(",
    "revoke all on function get_concur_refresh_token_for_edge(uuid)",
  );

  it("activeは取得対象", () => {
    expect(block).toMatch(/c\.status = 'active'/);
  });

  it("errorは取得対象（再試行可能）", () => {
    expect(block).toMatch(/c\.status = 'error'/);
  });

  it("rotatingは期限切れ（lock_expires_at < now()）の場合のみ取得対象", () => {
    expect(block).toMatch(/c\.status = 'rotating' and c\.lock_expires_at < now\(\)/);
  });

  it("inactiveを明示的に取得対象へ含めていない（status='inactive'の行を直接マッチさせる条件が無い）", () => {
    expect(block).not.toMatch(/c\.status = 'inactive'/);
  });

  it("statusの列コメントがinactive除外・active/error/rotating(期限切れ)取得対象を明記している", () => {
    const commentBlock = extractBlock(
      sql,
      "comment on column concur_oauth_connections.status is",
      "comment on column concur_oauth_connections.lease_id is",
    );
    expect(commentBlock).toMatch(/inactive=/);
    expect(commentBlock).toMatch(/取得対象外/);
    expect(commentBlock).toMatch(/active=/);
    expect(commentBlock).toMatch(/''active''で作成/);
  });
});

describe.each(SOURCES)(
  "$label: complete_concur_oauth_refresh()のlease_id検証は今回変更していない",
  ({ filePath }) => {
    const sql = stripComments(fs.readFileSync(filePath, "utf8"));
    const block = extractBlock(
      sql,
      "create or replace function complete_concur_oauth_refresh(",
      "revoke all on function complete_concur_oauth_refresh",
    );

    it("connection_id・lease_id・status='rotating'の完全一致を要求する", () => {
      expect(block).toMatch(/where id = p_connection_id\s+and lease_id = p_lease_id\s+and status = 'rotating'/);
    });

    it("vault.update_secret()は新Tokenが非null・非空文字の場合のみ呼ばれる", () => {
      expect(block).toMatch(/if p_new_refresh_token is not null and length\(p_new_refresh_token\) > 0 then/);
      expect(block).toMatch(/perform vault\.update_secret\(v_vault_secret_id, p_new_refresh_token\);/);
    });
  },
);

describe.each(SOURCES)("$label: grant/revokeは今回変更していない", ({ filePath }) => {
  const sql = stripComments(fs.readFileSync(filePath, "utf8"));

  it("get_concur_refresh_token_for_edge(uuid)はservice_roleのみEXECUTE可", () => {
    expect(sql).toMatch(
      /revoke all on function get_concur_refresh_token_for_edge\(uuid\) from public, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /grant execute on function get_concur_refresh_token_for_edge\(uuid\) to service_role;/,
    );
  });

  it("complete_concur_oauth_refresh(uuid, uuid, boolean, text, text)はservice_roleのみEXECUTE可", () => {
    expect(sql).toMatch(
      /revoke all on function complete_concur_oauth_refresh\(uuid, uuid, boolean, text, text\) from public, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /grant execute on function complete_concur_oauth_refresh\(uuid, uuid, boolean, text, text\) to service_role;/,
    );
  });

  it("concur_oauth_connectionsテーブルはanon/authenticated/publicからrevoke allされている", () => {
    expect(sql).toMatch(/revoke all on concur_oauth_connections from anon, authenticated, public;/);
  });

  it("vault.decrypted_secretsはanon/authenticated/publicからrevoke allされている", () => {
    expect(sql).toMatch(/revoke all on vault\.decrypted_secrets from anon, authenticated, public;/);
  });
});

describe("supabase/schema.sqlとMigrationファイルのPhase 12部分が実質的に一致している", () => {
  const schemaSql = stripComments(fs.readFileSync(SCHEMA_SQL_PATH, "utf8"));
  const migrationSql = stripComments(fs.readFileSync(MIGRATION_SQL_PATH, "utf8"));

  function normalize(sql, startMarker, endMarker) {
    return extractBlock(sql, startMarker, endMarker)
      .replace(/\s+/g, " ")
      .trim();
  }

  it("get_concur_refresh_token_for_edge()の関数本体が一致する", () => {
    const schemaBlock = normalize(
      schemaSql,
      "create or replace function get_concur_refresh_token_for_edge(",
      "revoke all on function get_concur_refresh_token_for_edge(uuid)",
    );
    const migrationBlock = normalize(
      migrationSql,
      "create or replace function get_concur_refresh_token_for_edge(",
      "revoke all on function get_concur_refresh_token_for_edge(uuid)",
    );
    expect(schemaBlock).toBe(migrationBlock);
  });

  it("complete_concur_oauth_refresh()の関数本体が一致する", () => {
    const schemaBlock = normalize(
      schemaSql,
      "create or replace function complete_concur_oauth_refresh(",
      "revoke all on function complete_concur_oauth_refresh",
    );
    const migrationBlock = normalize(
      migrationSql,
      "create or replace function complete_concur_oauth_refresh(",
      "revoke all on function complete_concur_oauth_refresh",
    );
    expect(schemaBlock).toBe(migrationBlock);
  });

  it("concur_oauth_connectionsのテーブル定義（列・CHECK制約）が一致する", () => {
    const schemaBlock = normalize(
      schemaSql,
      "create table if not exists concur_oauth_connections",
      ");",
    );
    const migrationBlock = normalize(
      migrationSql,
      "create table if not exists concur_oauth_connections",
      ");",
    );
    expect(schemaBlock).toBe(migrationBlock);
  });
});

describe("Refresh Token実値・Client Secret実値がMigration/schema.sqlへ含まれていない", () => {
  it.each(SOURCES)("$label にダミー以外のトークンらしき実値が無い", ({ filePath }) => {
    const raw = fs.readFileSync(filePath, "utf8");
    expect(raw).not.toMatch(/refresh_token['"]?\s*[:=]\s*['"](?!null)[A-Za-z0-9._-]{10,}/);
    expect(raw).not.toMatch(/client_secret['"]?\s*[:=]\s*['"][A-Za-z0-9._-]{10,}/);
  });
});
