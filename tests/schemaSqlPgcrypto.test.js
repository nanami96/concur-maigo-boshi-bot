import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// 実Supabaseで発生した不具合の回帰防止テスト：
// SECURITY DEFINER関数はsearch_pathをpublicだけに固定しているが、pgcryptoは
// Supabaseプロジェクトでは通常extensionsスキーマにインストールされる。
// このため、関数本体からpgcrypto関数（digest等）をスキーマ修飾せずに呼ぶと、
// 実行時に「function digest(text, unknown) does not exist」（42883）になる。
//
// このテストはschema.sqlをテキストとして読み、pgcrypto関数呼び出しが
// 常に extensions. で修飾されていること、および拡張機能自体が
// with schema extensions で決定論的にインストールされることを機械的に確認する
// （実際にPostgresへ接続して検証するテストではない。プロジェクトの既存方針
// 通り、pure/静的な検証のみをVitestで行う）。
const schemaSqlRaw = fs.readFileSync(
  path.resolve(__dirname, "../supabase/schema.sql"),
  "utf8",
);

// コメント行（--で始まる行。エラーメッセージの引用等でdigest(...)という
// 文字列がプロース中に出現しうるため）を除いた、実際に実行されるSQLコードだけを
// 検証対象にする。
const schemaSql = schemaSqlRaw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

// pgcryptoが提供する関数の内、このプロジェクトで使用しているものの一覧。
// gen_random_bytesはPhase 8（create_platform_company・regenerate_invite_code）で
// 招待コードの生成に追加された。将来これら以外のpgcrypto関数（crypt・hmac等）を
// 使い始めた場合も、この配列へ追加すれば同じ検証が効くようにしてある。
const PGCRYPTO_FUNCTIONS = ["digest", "gen_random_bytes"];

describe("schema.sql: pgcryptoのSECURITY DEFINER関数からの呼び出しは常にスキーマ修飾する", () => {
  it("pgcrypto拡張はwith schema extensionsで決定論的にインストールされる", () => {
    expect(schemaSql).toMatch(/create extension if not exists pgcrypto with schema extensions;/);
  });

  PGCRYPTO_FUNCTIONS.forEach((fn) => {
    it(`${fn}(...) の呼び出しは全て extensions.${fn}(...) の形でスキーマ修飾されている`, () => {
      // 関数呼び出し全箇所を検出し、それぞれ直前に"extensions."が付いているか確認する。
      // create extension文自体（拡張機能名としての"pgcrypto"）は対象外。
      const callPattern = new RegExp(`(\\w+\\.)?\\b${fn}\\(`, "g");
      const matches = [...schemaSql.matchAll(callPattern)];

      expect(matches.length).toBeGreaterThan(0);

      matches.forEach((match) => {
        const prefix = match[1];
        expect(prefix, `"${match[0]}"はextensions.で修飾されている必要があります`).toBe(
          "extensions.",
        );
      });
    });
  });
});
