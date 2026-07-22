import { describe, it, expect } from "vitest";
import {
  translateResetRequestError,
  translateRecoveryCallbackError,
  translateUpdatePasswordError,
} from "../src/admin/passwordResetErrorMessages";

describe("translateResetRequestError（再設定メール送信の失敗）", () => {
  it("エラーが無ければnull", () => {
    expect(translateResetRequestError(null)).toBeNull();
  });

  it("レート制限（429・rate limitメッセージ）を分かりやすいメッセージに変換する", () => {
    expect(translateResetRequestError({ status: 429, message: "" })).toMatch(/上限/);
    expect(translateResetRequestError({ message: "email rate limit exceeded" })).toMatch(/上限/);
  });

  it("ネットワークエラーを分かりやすいメッセージに変換する", () => {
    expect(translateResetRequestError({ name: "AuthRetryableFetchError", message: "" })).toMatch(
      /ネットワーク/,
    );
    expect(translateResetRequestError({ message: "Failed to fetch" })).toMatch(/ネットワーク/);
  });

  it("その他のエラーは汎用メッセージ（内部エラー文言をそのまま出さない）", () => {
    const message = translateResetRequestError({ message: "some internal supabase detail" });
    expect(message).not.toContain("supabase");
    expect(message).toMatch(/送信に失敗/);
  });
});

describe("translateRecoveryCallbackError（再設定リンクのcode交換失敗）", () => {
  it("エラーが無ければnull", () => {
    expect(translateRecoveryCallbackError(null)).toBeNull();
  });

  it("ネットワークエラーを分かりやすいメッセージに変換する", () => {
    expect(translateRecoveryCallbackError({ message: "network error" })).toMatch(/ネットワーク/);
  });

  it("期限切れ・無効なリンク等、その他のエラーは「リンクが無効／期限切れ」という統一メッセージにする", () => {
    const expired = translateRecoveryCallbackError({ message: "otp_expired" });
    const invalid = translateRecoveryCallbackError({ message: "invalid request" });
    expect(expired).toMatch(/有効期限|無効/);
    expect(invalid).toMatch(/有効期限|無効/);
    // Supabase側の詳細な内部エラー文言をそのままユーザーへ出さない。
    expect(expired).not.toContain("otp_expired");
  });
});

describe("translateUpdatePasswordError（新しいパスワードの確定失敗）", () => {
  it("エラーが無ければnull", () => {
    expect(translateUpdatePasswordError(null)).toBeNull();
  });

  it("ネットワークエラーを分かりやすいメッセージに変換する", () => {
    expect(translateUpdatePasswordError({ message: "Failed to fetch" })).toMatch(/ネットワーク/);
  });

  it("パスワード要件違反（文字数不足等）を分かりやすいメッセージに変換する", () => {
    const message = translateUpdatePasswordError({
      message: "Password should be at least 6 characters",
    });
    expect(message).toMatch(/パスワードの要件/);
  });

  it("セッション切れ（recoveryリンクの有効期限切れ後にupdateUserを呼んだ場合）を分かりやすいメッセージに変換する", () => {
    const message = translateUpdatePasswordError({ message: "Auth session missing!" });
    expect(message).toMatch(/有効期限/);
  });

  it("その他のエラーは汎用メッセージ", () => {
    const message = translateUpdatePasswordError({ message: "some unexpected error" });
    expect(message).toMatch(/変更に失敗/);
  });
});
