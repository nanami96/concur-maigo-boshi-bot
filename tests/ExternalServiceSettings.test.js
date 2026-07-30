import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  formatConcurOAuthCheckResult,
  shouldShowConcurScopeWarning,
  shouldShowExternalServiceSettings,
  shouldSkipConcurOAuthCheck,
  formatConcurUserIdentityLookupResult,
  shouldDisableConcurUserIdentityLookup,
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
  it("connected:trueで7項目すべて含む正常応答をそのままBoolean化する", () => {
    const formatted = formatConcurOAuthCheckResult({
      connected: true,
      hasGeolocation: true,
      expiresInPresent: false,
      refreshTokenRotated: true,
      hasQuickExpenseWriteScope: true,
      hasUserReadScope: false,
      hasIdentityUserIdsReadScope: true,
    });

    expect(formatted).toEqual({
      connected: true,
      hasGeolocation: true,
      expiresInPresent: false,
      refreshTokenRotated: true,
      hasQuickExpenseWriteScope: true,
      hasUserReadScope: false,
      hasIdentityUserIdsReadScope: true,
    });
  });

  it("安全ゲート無効時の{connected:false, status:'disabled'}（他項目が無い）はfalse相当に丸める", () => {
    const formatted = formatConcurOAuthCheckResult({ connected: false, status: "disabled" });

    expect(formatted).toEqual({
      connected: false,
      hasGeolocation: false,
      expiresInPresent: false,
      refreshTokenRotated: false,
      hasQuickExpenseWriteScope: false,
      hasUserReadScope: false,
      hasIdentityUserIdsReadScope: false,
    });
  });

  it("nullを渡しても例外にならず、全項目falseを返す", () => {
    expect(formatConcurOAuthCheckResult(null)).toEqual({
      connected: false,
      hasGeolocation: false,
      expiresInPresent: false,
      refreshTokenRotated: false,
      hasQuickExpenseWriteScope: false,
      hasUserReadScope: false,
      hasIdentityUserIdsReadScope: false,
    });
  });

  it("undefinedを渡しても例外にならず、全項目falseを返す", () => {
    expect(formatConcurOAuthCheckResult(undefined)).toEqual({
      connected: false,
      hasGeolocation: false,
      expiresInPresent: false,
      refreshTokenRotated: false,
      hasQuickExpenseWriteScope: false,
      hasUserReadScope: false,
      hasIdentityUserIdsReadScope: false,
    });
  });

  it("戻り値のキーは7つだけ（Token・Secret・scope生値等が紛れ込んでも除外される）", () => {
    const formatted = formatConcurOAuthCheckResult({
      connected: true,
      hasGeolocation: true,
      expiresInPresent: true,
      refreshTokenRotated: true,
      hasQuickExpenseWriteScope: true,
      hasUserReadScope: true,
      hasIdentityUserIdsReadScope: true,
      accessToken: "should-not-appear",
      refreshToken: "should-not-appear",
      scope: "should-not-appear",
    });

    expect(Object.keys(formatted).sort()).toEqual(
      [
        "connected",
        "expiresInPresent",
        "hasGeolocation",
        "refreshTokenRotated",
        "hasQuickExpenseWriteScope",
        "hasUserReadScope",
        "hasIdentityUserIdsReadScope",
      ].sort(),
    );
  });
});

describe("shouldShowConcurScopeWarning（必要scope不足時の注意表示）", () => {
  it("未接続の場合は常にfalse（権限不足を云々する状況ではない）", () => {
    expect(
      shouldShowConcurScopeWarning({
        connected: false,
        hasQuickExpenseWriteScope: false,
        hasUserReadScope: false,
        hasIdentityUserIdsReadScope: false,
      }),
    ).toBe(false);
  });

  it("接続済みかつ3scopeすべてありの場合はfalse", () => {
    expect(
      shouldShowConcurScopeWarning({
        connected: true,
        hasQuickExpenseWriteScope: true,
        hasUserReadScope: true,
        hasIdentityUserIdsReadScope: true,
      }),
    ).toBe(false);
  });

  it("接続済みだが1つでも不足していればtrue", () => {
    expect(
      shouldShowConcurScopeWarning({
        connected: true,
        hasQuickExpenseWriteScope: false,
        hasUserReadScope: true,
        hasIdentityUserIdsReadScope: true,
      }),
    ).toBe(true);
    expect(
      shouldShowConcurScopeWarning({
        connected: true,
        hasQuickExpenseWriteScope: true,
        hasUserReadScope: false,
        hasIdentityUserIdsReadScope: true,
      }),
    ).toBe(true);
    expect(
      shouldShowConcurScopeWarning({
        connected: true,
        hasQuickExpenseWriteScope: true,
        hasUserReadScope: true,
        hasIdentityUserIdsReadScope: false,
      }),
    ).toBe(true);
  });

  it("接続済みで3scopeすべて不足していてもtrue", () => {
    expect(
      shouldShowConcurScopeWarning({
        connected: true,
        hasQuickExpenseWriteScope: false,
        hasUserReadScope: false,
        hasIdentityUserIdsReadScope: false,
      }),
    ).toBe(true);
  });

  it("null/undefinedを渡しても例外にならずfalse", () => {
    expect(shouldShowConcurScopeWarning(null)).toBe(false);
    expect(shouldShowConcurScopeWarning(undefined)).toBe(false);
  });
});

describe("shouldDisableConcurUserIdentityLookup（入力空欄・二重クリック防止）", () => {
  it("checking中は入力があっても無効化する", () => {
    expect(shouldDisableConcurUserIdentityLookup({ status: "checking", userNameInput: "user@example.com" })).toBe(true);
  });

  it("入力が空欄（trim後）の場合は無効化する", () => {
    expect(shouldDisableConcurUserIdentityLookup({ status: "idle", userNameInput: "" })).toBe(true);
    expect(shouldDisableConcurUserIdentityLookup({ status: "idle", userNameInput: "   " })).toBe(true);
  });

  it("入力があり、checking中でなければ有効化する", () => {
    expect(shouldDisableConcurUserIdentityLookup({ status: "idle", userNameInput: "user@example.com" })).toBe(false);
    expect(shouldDisableConcurUserIdentityLookup({ status: "result", userNameInput: "user@example.com" })).toBe(false);
    expect(shouldDisableConcurUserIdentityLookup({ status: "error", userNameInput: "user@example.com" })).toBe(false);
  });

  it("userNameInputがnull/undefinedでも例外にならず無効化する", () => {
    expect(shouldDisableConcurUserIdentityLookup({ status: "idle", userNameInput: null })).toBe(true);
    expect(shouldDisableConcurUserIdentityLookup({ status: "idle", userNameInput: undefined })).toBe(true);
  });
});

describe("formatConcurUserIdentityLookupResult（結果整形）", () => {
  it("found:true・hasUserId:trueをそのままBoolean化する", () => {
    expect(formatConcurUserIdentityLookupResult({ found: true, hasUserId: true, multipleMatches: false })).toEqual({
      userConfirmed: true,
      userIdObtained: true,
    });
  });

  it("安全ゲート無効時の{found:false, status:'disabled'}はfalse相当に丸める", () => {
    expect(formatConcurUserIdentityLookupResult({ found: false, status: "disabled" })).toEqual({
      userConfirmed: false,
      userIdObtained: false,
    });
  });

  it("null/undefinedを渡しても例外にならない", () => {
    expect(formatConcurUserIdentityLookupResult(null)).toEqual({ userConfirmed: false, userIdObtained: false });
    expect(formatConcurUserIdentityLookupResult(undefined)).toEqual({ userConfirmed: false, userIdObtained: false });
  });

  it("戻り値のキーはuserConfirmed/userIdObtainedの2つだけ（Concur実UUID等が紛れ込んでも除外される）", () => {
    const formatted = formatConcurUserIdentityLookupResult({
      found: true,
      hasUserId: true,
      multipleMatches: false,
      userId: "SHOULD_NOT_APPEAR-3df11695-e8bb-40ff-8e98-c85913ab2789",
    });

    expect(Object.keys(formatted).sort()).toEqual(["userConfirmed", "userIdObtained"].sort());
    expect(JSON.stringify(formatted)).not.toContain("SHOULD_NOT_APPEAR");
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
    expect(source).not.toMatch(/<span>[^<]*[（(]hasQuickExpenseWriteScope[）)][^<]*<\/span>/);
    expect(source).not.toMatch(/<span>[^<]*[（(]hasUserReadScope[）)][^<]*<\/span>/);
    expect(source).not.toMatch(/<span>[^<]*[（(]hasIdentityUserIdsReadScope[）)][^<]*<\/span>/);
    expect(source).toMatch(/<span>接続状態<\/span>/);
    expect(source).toMatch(/<span>位置情報<\/span>/);
    expect(source).toMatch(/<span>有効期限情報<\/span>/);
    expect(source).toMatch(/<span>Refresh Token更新<\/span>/);
    expect(source).toMatch(/<span>Quick Expense作成権限<\/span>/);
    expect(source).toMatch(/<span>利用者情報参照権限<\/span>/);
    expect(source).toMatch(/<span>Identity利用者ID参照権限<\/span>/);
  });

  it("scope全文・実際のscope名（quickexpense.writeonly等）を表示するコードが無い", () => {
    expect(source).not.toMatch(/quickexpense\.writeonly/);
    expect(source).not.toMatch(/identity\.user\.ids\.read/);
    expect(source).not.toMatch(/["'`]user\.read["'`]/);
  });

  it("接続済みでも必要scope不足時だけ、固定の注意表示を出す（shouldShowConcurScopeWarning経由）", () => {
    expect(source).toMatch(/shouldShowConcurScopeWarning\(formatted\)/);
    expect(source).toMatch(/接続は成功していますが、API利用に必要な権限が不足しています。/);
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

describe("ExternalServiceSettings.jsx: Concur利用者の確認（Identity検索診断）の静的確認", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../src/admin/ExternalServiceSettings.jsx"),
    "utf8",
  );

  it("結果表示ラベルに内部プロパティ名（found・hasUserId等）を含めない", () => {
    expect(source).not.toMatch(/<span>[^<]*[（(]found[）)][^<]*<\/span>/);
    expect(source).not.toMatch(/<span>[^<]*[（(]hasUserId[）)][^<]*<\/span>/);
    expect(source).toMatch(/<span>利用者<\/span>/);
    expect(source).toMatch(/<span>userID<\/span>/);
  });

  it("実際のuserID（UUID）を表示するコードが存在しない（result.userId等を直接参照していない）", () => {
    expect(source).not.toMatch(/identityLookupState\.result\.userId/);
    expect(source).not.toMatch(/\.userId\b/);
  });

  it("エラー表示はerrorType（固定コード）だけで、error.message・生レスポンスを参照していない", () => {
    expect(source).toMatch(/エラーコード: \{identityLookupState\.errorType/);
  });

  it("入力したConcurログインID自体を結果表示へ反射する記述が無い（ボタンJSXより後でidentityLookupUserNameを参照しない）", () => {
    // 入力欄自体はvalue={identityLookupUserName}という制御コンポーネントの
    // 構造上、当然identityLookupUserNameを参照する。ここで確認したいのは
    // 「ボタンJSXより後（結果・エラー表示部分）」に入力値がそのまま反射されて
    // いないことなので、ボタンのJSX特有の文字列（三項演算子の中の"利用者を
    // 確認する"）で検索する（コメント中の「利用者を確認する」との誤マッチを
    // 避けるため、コロン＋ダブルクォートを含めた文字列で検索する）。
    const buttonJsxIndex = source.indexOf(': "利用者を確認する"');
    const resultListStart = source.indexOf("concurOAuthCheckResultList", buttonJsxIndex);
    const sectionEnd = source.indexOf("</div>", resultListStart);
    const resultDisplayBody = source.slice(buttonJsxIndex, sectionEnd);

    expect(buttonJsxIndex).toBeGreaterThan(-1);
    expect(resultDisplayBody).not.toMatch(/\{identityLookupUserName\}/);
  });

  it("見出し→説明文→入力欄→ボタン→結果の順で並んでいる（操作してから結果を見る順序）", () => {
    const headingIndex = source.indexOf("<h4>Concur利用者の確認</h4>");
    const descriptionIndex = source.indexOf("Concur側に登録されているかを確認します。");
    const inputIndex = source.indexOf('placeholder="ConcurログインID"');
    const buttonJsxIndex = source.indexOf(': "利用者を確認する"');
    const resultIndex = source.indexOf('identityLookupState.status === "result"');

    expect(headingIndex).toBeGreaterThan(-1);
    expect(descriptionIndex).toBeGreaterThan(headingIndex);
    expect(inputIndex).toBeGreaterThan(descriptionIndex);
    expect(buttonJsxIndex).toBeGreaterThan(inputIndex);
    expect(resultIndex).toBeGreaterThan(buttonJsxIndex);
  });

  it("既存のOAuth接続確認セクションとは独立したセクション（settingsConcurIdentityLookupSection）に分かれている", () => {
    expect(source).toMatch(/settingsConcurIdentityLookupSection/);
    const oauthSectionIndex = source.indexOf('className="settingsCard settingsConcurConnectionSection"');
    const identitySectionIndex = source.indexOf("settingsConcurIdentityLookupSection");
    expect(identitySectionIndex).toBeGreaterThan(oauthSectionIndex);
  });

  it("platform_admin限定の表示ゲート（shouldShowExternalServiceSettings）の呼び出しはコンポーネント全体に1箇所だけで、Identity検索セクション専用の別ゲートを持たない（同じ権限境界を共有する）", () => {
    // 関数定義自体（export function shouldShowExternalServiceSettings(...)）は
    // 除外し、実際の呼び出し箇所（!shouldShowExternalServiceSettings(...)）だけを数える。
    const matches = source.match(/!shouldShowExternalServiceSettings\(/g) || [];
    expect(matches.length).toBe(1);
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
