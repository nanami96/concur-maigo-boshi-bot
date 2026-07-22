import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// 実Supabaseで発生した不具合の回帰防止テスト：
// list_my_company_members()のRETURNS TABLEでは email text と宣言しているが、
// auth.users.emailの実際の列型は character varying(255) であり、PL/pgSQL関数の
// RETURN QUERYは宣言した型と完全一致しないと「structure of query does not match
// function result type」（42804）で失敗する。u.email::text と明示的にキャストする
// ことで解消するが、この一行が将来の編集で誤って削除・変更されないよう、
// schema.sqlをテキストとして読み、キャストが残っていることを機械的に確認する。
// Phase 8で追加したlist_platform_company_members()も同じ形（auth.usersとjoinして
// emailを返す）のため、同じ回帰防止チェックを適用する。
//
// 限界：これは静的なテキスト検証であり、実際にPostgresへ接続してRETURNS TABLEの
// 宣言とSELECT列の型が完全に一致するかまでは検証できない（本プロジェクトの
// 既存方針通り、実DBを起動しないpure/静的な検証に留めている）。他の列・他の関数で
// 同種の型不一致が新たに発生した場合はこのテストでは検出できない。
const schemaSqlRaw = fs.readFileSync(
  path.resolve(__dirname, "../supabase/schema.sql"),
  "utf8",
);

const schemaSql = schemaSqlRaw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

// auth.users.emailをjoinして返す関数の一覧。将来同種の関数を追加した場合も
// ここへ追加すれば同じ回帰防止チェックが効く。
const FUNCTIONS_RETURNING_EMAIL = [
  "list_my_company_members()",
  "list_platform_company_members(uuid",
];

describe("schema.sql: auth.users.email型不一致の回帰防止", () => {
  FUNCTIONS_RETURNING_EMAIL.forEach((signature) => {
    const fnName = signature.split("(")[0];

    it(`${fnName}()のSELECT列で u.email が ::text へ明示的にキャストされている`, () => {
      const fnStart = schemaSql.indexOf(`create or replace function ${fnName}(`);
      expect(fnStart, `${fnName}の定義が見つかりません`).toBeGreaterThan(-1);

      const fnEnd = schemaSql.indexOf("$$;", fnStart);
      const fnBody = schemaSql.slice(fnStart, fnEnd);

      expect(fnBody).toMatch(/u\.email::text/);
      // varchar(255)のまま無条件でキャストせず返してしまう回帰
      // （u.email単体でのSELECT）が無いことも合わせて確認する。
      expect(fnBody).not.toMatch(/select cm\.id, cm\.user_id, u\.email,/);
    });
  });
});
