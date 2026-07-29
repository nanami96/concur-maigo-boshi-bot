import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  formatConcurOAuthCheckResult,
  shouldShowExternalServiceSettings,
  shouldSkipConcurOAuthCheck,
} from "../src/admin/ExternalServiceSettings.jsx";

// このプロジェクトにはReact Testing Library等のDOM描画テスト基盤が無く
// （既存のtests/配下は全て純粋関数のユニットテストのみ）、今回もその方針を
// 踏襲する（tests/ConcurRegistrationPanel.test.jsのshouldRenderConcurRegistrationCard
// と同じ考え方）。ExternalServiceSettings.jsxが実際に表示するかどうか・
// 表示する真偽値は、これらのexportされた純粋関数がそのまま決めているため、
// ここで正しさを確認すれば「platform_adminだけに表示される」「結果が正しく
// 整形される」「二重クリックがスキップされる」ことを実質的に検証できる。
//
// 旧 tests/UserManagementPanel.test.js は、formatConcurOAuthCheckResultが
// src/admin/ExternalServiceSettings.jsxへ移動したことに伴い、このファイルへ
// 統合・改名した。

describe("shouldShowExternalServiceSettings（表示権限）", () => {
  it("platform_admin（true）では表示する", () => {
    expect(shouldShowExternalServiceSettings(true)).toBe(true);
  });

  it("company_admin相当（isPlatformAdmin:false）では表示しない", () => {
    // このコンポーネントはcompany_adminと一般ユーザーを区別せず、
    // どちらもisPlatformAdmin=falseとして渡される前提のため、
    // 両ケースとも同じfalse入力で検証する。
    expect(shouldShowExternalServiceSettings(false)).toBe(false);
  });

  it("一般ユーザー相当（isPlatformAdmin:false）では表示しない", () => {
    expect(shouldShowExternalServiceSettings(false)).toBe(false);
  });

  it("isPlatformAdminが未解決（null/undefined）の間も表示しない（fail-closed）", () => {
    expect(shouldShowExternalServiceSettings(null)).toBe(false);
    expect(shouldShowExternalServiceSettings(undefined)).toBe(false);
  });
});

describe("shouldSkipConcurOAuthCheck（二重クリック防止）", () => {
  it("checking中は新たな呼び出しをスキップする", () => {
    expect(shouldSkipConcurOAuthCheck("checking")).toBe(true);
  });

  it("idle・result・errorの場合は呼び出しを許可する", () => {
    expect(shouldSkipConcurOAuthCheck("idle")).toBe(false);
    expect(shouldSkipConcurOAuthCheck("result")).toBe(false);
    expect(shouldSkipConcurOAuthCheck("error")).toBe(false);
  });
});

describe("formatConcurOAuthCheckResult（結果整形）", () => {
  it("connected:trueで4項目すべて含む正常応答をそのままBoolean化する", () => {
    const formatted = formatConcurOAuthCheckResult({
      connected: true,
      hasGeolocation: true,
      expiresInPresent: false,
      refreshTokenRotated: true,
    });

    expect(formatted).toEqual({
      connected: true,
      hasGeolocation: true,
      expiresInPresent: false,
      refreshTokenRotated: true,
    });
  });

  it("安全ゲート無効時の{connected:false, status:'disabled'}（他3項目が無い）はfalse相当に丸める", () => {
    const formatted = formatConcurOAuthCheckResult({ connected: false, status: "disabled" });

    expect(formatted).toEqual({
      connected: false,
      hasGeolocation: false,
      expiresInPresent: false,
      refreshTokenRotated: false,
    });
  });

  it("nullを渡しても例外にならず、全項目falseを返す", () => {
    expect(formatConcurOAuthCheckResult(null)).toEqual({
      connected: false,
      hasGeolocation: false,
      expiresInPresent: false,
      refreshTokenRotated: false,
    });
  });

  it("undefinedを渡しても例外にならず、全項目falseを返す", () => {
    expect(formatConcurOAuthCheckResult(undefined)).toEqual({
      connected: false,
      hasGeolocation: false,
      expiresInPresent: false,
      refreshTokenRotated: false,
    });
  });

  it("戻り値のキーはconnected/hasGeolocation/expiresInPresent/refreshTokenRotatedの4つだけ（Token・Secret等が紛れ込んでも除外される）", () => {
    const formatted = formatConcurOAuthCheckResult({
      connected: true,
      hasGeolocation: true,
      expiresInPresent: true,
      refreshTokenRotated: true,
      accessToken: "should-not-appear",
      refreshToken: "should-not-appear",
    });

    expect(Object.keys(formatted).sort()).toEqual(
      ["connected", "expiresInPresent", "hasGeolocation", "refreshTokenRotated"].sort(),
    );
  });
});

// 表示文言・エラー表示に関する静的回帰テスト（他のtests/schemaSql*.test.jsと
// 同じ「ソースを読んでテキスト検証する」方式。DOM描画は行わない）。
describe("ExternalServiceSettings.jsx: 表示文言・エラー表示の静的確認", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../src/admin/ExternalServiceSettings.jsx"),
    "utf8",
  );

  it("結果表示ラベルに内部プロパティ名（hasGeolocation等）を含めない", () => {
    // ラベル文字列（<span>直後のJSXテキスト）にプロパティ名を含めていないことを
    // 確認する。コメント・変数名としての出現は許容し、表示用ラベル行だけを見る。
    expect(source).not.toMatch(/<span>[^<]*[（(]hasGeolocation[）)][^<]*<\/span>/);
    expect(source).not.toMatch(/<span>[^<]*[（(]expiresInPresent[）)][^<]*<\/span>/);
    expect(source).not.toMatch(/<span>[^<]*[（(]refreshTokenRotated[）)][^<]*<\/span>/);
    expect(source).toMatch(/<span>接続状態<\/span>/);
    expect(source).toMatch(/<span>位置情報<\/span>/);
    expect(source).toMatch(/<span>有効期限情報<\/span>/);
    expect(source).toMatch(/<span>Refresh Token更新<\/span>/);
  });

  it("エラー表示はerrorType（固定コード）だけで、error.message・生レスポンスを参照していない", () => {
    expect(source).toMatch(/エラーコード: \{concurCheckState\.errorType/);
    expect(source).not.toMatch(/\.message/);
    expect(source).not.toMatch(/JSON\.stringify/);
  });

  it("見出し→説明文→ボタン→結果の順で並んでいる（操作してから結果を見る順序）", () => {
    const headingIndex = source.indexOf("<h3>Concur</h3>");
    const descriptionIndex = source.indexOf("Concurとの接続状態を確認します。");
    const buttonIndex = source.indexOf("Concur接続を確認する");
    const resultIndex = source.indexOf('concurCheckState.status === "result"');

    expect(headingIndex).toBeGreaterThan(-1);
    expect(descriptionIndex).toBeGreaterThan(headingIndex);
    expect(buttonIndex).toBeGreaterThan(descriptionIndex);
    expect(resultIndex).toBeGreaterThan(buttonIndex);
  });
});

// UserManagementPanel.jsxからConcur関連コードが完全に削除されたことの静的回帰テスト。
describe("UserManagementPanel.jsx: Concur関連コードが残っていない", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../src/admin/UserManagementPanel.jsx"),
    "utf8",
  );

  it("concurOAuthCheckRepositoryをimportしていない", () => {
    expect(source).not.toMatch(/concurOAuthCheckRepository/);
  });

  it("Concur関連の識別子・文言を一切含まない", () => {
    expect(source).not.toMatch(/[Cc]oncur/);
  });
});
