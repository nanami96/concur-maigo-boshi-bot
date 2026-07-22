import { describe, it, expect } from "vitest";
import { translateAuthError } from "../src/admin/authErrorMessages";

describe("translateAuthError", () => {
  it("エラーが無ければnull", () => {
    expect(translateAuthError(null)).toBeNull();
    expect(translateAuthError(undefined)).toBeNull();
  });

  it("status 429（メール送信・ログイン試行のレート制限）を検知する", () => {
    const message = translateAuthError({ status: 429, message: "email rate limit exceeded" });
    expect(message).toMatch(/送信回数が上限/);
  });

  it("messageにrate limitを含む場合もレート制限として扱う（statusが無くても）", () => {
    const message = translateAuthError({ message: "Email rate limit exceeded" });
    expect(message).toMatch(/送信回数が上限/);
  });

  it("Invalid login credentialsはメール/パスワード不一致メッセージにする", () => {
    const message = translateAuthError({ status: 400, message: "Invalid login credentials" });
    expect(message).toBe("メールアドレスまたはパスワードが違います。");
  });

  it("email not confirmedは専用メッセージにする", () => {
    const message = translateAuthError({ status: 400, message: "Email not confirmed" });
    expect(message).toMatch(/確認が完了していません/);
  });

  it("AuthRetryableFetchError（ネットワーク起因）はネットワークエラーメッセージにする", () => {
    const message = translateAuthError({ name: "AuthRetryableFetchError", message: "Failed to fetch" });
    expect(message).toMatch(/ネットワークエラー/);
  });

  it("failed to fetchという文言単体でもネットワークエラーとして扱う", () => {
    const message = translateAuthError({ message: "TypeError: Failed to fetch" });
    expect(message).toMatch(/ネットワークエラー/);
  });

  it("未知のエラーは汎用の失敗メッセージにフォールバックする", () => {
    const message = translateAuthError({ message: "some unexpected internal error" });
    expect(message).toBe("ログインに失敗しました。しばらくしてから再度お試しください。");
  });
});
