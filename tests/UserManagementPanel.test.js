import { describe, it, expect } from "vitest";
import { formatConcurOAuthCheckResult } from "../src/admin/UserManagementPanel.jsx";

// このプロジェクトにはReact Testing Library等のDOM描画テスト基盤が無く
// （既存のtests/配下は全て純粋関数のユニットテストのみ）、今回もその方針を
// 踏襲する。UserManagementPanel.jsxが「Concur接続確認」の結果として実際に
// 表示する真偽値は、このexportされた整形関数がそのまま決めているため、ここで
// 正しさを確認すれば表示内容を実質的に検証できる（tests/ConcurRegistrationPanel.test.jsと
// 同じ考え方）。

describe("formatConcurOAuthCheckResult", () => {
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

  it("Token・Secretに相当するキーが結果へ含まれない（成分がconnected/hasGeolocation/expiresInPresent/refreshTokenRotatedの4つだけ）", () => {
    const formatted = formatConcurOAuthCheckResult({
      connected: true,
      hasGeolocation: true,
      expiresInPresent: true,
      refreshTokenRotated: true,
      // 万一Edge Function側の応答に紛れ込んだ場合を想定したダミーキー。
      accessToken: "should-not-appear",
      refreshToken: "should-not-appear",
    });

    expect(Object.keys(formatted).sort()).toEqual(
      ["connected", "expiresInPresent", "hasGeolocation", "refreshTokenRotated"].sort(),
    );
  });
});
