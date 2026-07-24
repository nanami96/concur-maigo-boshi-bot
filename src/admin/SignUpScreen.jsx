import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { translateAuthError } from "./authErrorMessages";
import AuthLogo from "./AuthLogo";

// メールアドレス＋パスワードでのユーザー登録画面。
//
// 独自にパスワードをDBへ保存することは一切しない（Supabase Authのsignup APIへ
// そのまま委譲する）。パスワード確認欄はクライアント側で一致確認のみ行う簡易な
// バリデーションで、サーバー側のパスワード強度チェックはSupabase側の設定に従う。
//
// signUp後の状態は、Supabaseの「Email Confirmation」設定によって変わる：
//   ・確認メール必須の場合          … data.session が無い（ログイン未完了）。
//                                     確認メールの案内を表示する。
//   ・確認メール不要（即ログイン）の場合 … data.session が返り、既にログイン済み。
//                                     onSignedUp経由で後続画面へ進める。
// この設定自体をアプリ側から変更することはない（Supabaseダッシュボード側の設定）。
//
// emailRedirectToは、LoginScreen.jsxのbuildRedirectUrlと同じ理由
// （ローカル開発・GitHub Pagesのどちらでもコード変更無しに正しいURLへ戻るため）で
// 実行時のwindow.locationから組み立てる。ただしこちらは意図的に
// ?authFlow=adminマーカーを付けない：このマーカーはmain.jsxが「管理画面Magic Link
// ログイン由来の認証コールバックか」を判定するためのものであり、一般ユーザーの
// アカウント作成確認メールはマーカー無しのままにすることで、確認メール完了後は
// 常に一般利用者側のツリー（AppAuthGate、ルート"/"）へ戻るようにする
// （src/admin/authCallback.js・main.jsx参照）。
function buildSignUpRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

export default function SignUpScreen({ onSwitchToLogin, onSignedUp, title = "アカウントを作成" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [status, setStatus] = useState("idle"); // idle | submitting | confirmEmailSent | error
  const [errorMessage, setErrorMessage] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      return;
    }

    if (password !== passwordConfirm) {
      setStatus("error");
      setErrorMessage("パスワードが一致しません。");
      return;
    }

    setStatus("submitting");
    setErrorMessage(null);

    const { data, error } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
      options: { emailRedirectTo: buildSignUpRedirectUrl() },
    });

    if (error) {
      setStatus("error");
      setErrorMessage(translateAuthError(error));
      return;
    }

    if (data.session) {
      // メール確認が不要な設定の場合、この時点で既にログイン済みになる。
      onSignedUp?.();
      return;
    }

    setStatus("confirmEmailSent");
  }

  if (status === "confirmEmailSent") {
    return (
      <main className="appShell adminShell">
        <div className="authScreen">
          <AuthLogo />
          <h1>{title}</h1>
          <p className="authSentMessage">
            <strong>{email.trim()}</strong>{" "}
            宛に確認メールを送信しました。メール内のリンクをクリックして登録を完了してください。
          </p>
          <button type="button" className="authModeSwitchLink" onClick={onSwitchToLogin}>
            ログイン画面へ戻る
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="appShell adminShell">
      <div className="authScreen">
        <AuthLogo />
        <h1>{title}</h1>

        <form onSubmit={handleSubmit} className="authForm">
          <label className="flowFieldLabel">
            メールアドレス
            <input
              type="email"
              className="settingsTextInput"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              name="email"
              autoComplete="email"
            />
          </label>

          <label className="flowFieldLabel">
            パスワード
            <input
              type="password"
              className="settingsTextInput"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              name="new-password"
              autoComplete="new-password"
            />
          </label>

          <label className="flowFieldLabel">
            パスワード（確認）
            <input
              type="password"
              className="settingsTextInput"
              value={passwordConfirm}
              onChange={(event) => setPasswordConfirm(event.target.value)}
              required
              name="confirm-new-password"
              autoComplete="new-password"
            />
          </label>

          {status === "error" && <p className="settingsErrorText">{errorMessage}</p>}

          <button
            type="submit"
            className="importConfirmButton"
            disabled={status === "submitting" || !email.trim() || !password || !passwordConfirm}
          >
            {status === "submitting" ? "登録中…" : "アカウントを作成"}
          </button>
        </form>

        <button type="button" className="authModeSwitchLink" onClick={onSwitchToLogin}>
          既にアカウントをお持ちの方はこちら（ログイン）
        </button>
      </div>
    </main>
  );
}
