import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { translateUpdatePasswordError } from "./passwordResetErrorMessages";

// パスワード再設定リンクの交換（PasswordRecoveryGate.jsx参照）が成功した後にだけ
// 表示される、「新しいパスワードを設定」する画面。この画面が表示されている間、
// supabase.auth.getSession()は再設定用の一時的なセッション（recoveryセッション）を
// 保持している。
//
// 変更が成功したら、この一時セッションを明示的にsignOut()してから完了扱いにする
// （中途半端なrecoveryセッションが残ったままにならないようにするため。MVPとして
// 「変更後は改めてログインし直してもらう」方式を採用した。詳細はcompleted report参照）。
export default function ResetPasswordScreen({ onDone }) {
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [status, setStatus] = useState("idle"); // idle | submitting | done | error
  const [errorMessage, setErrorMessage] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!password || !passwordConfirm) {
      return;
    }

    if (password !== passwordConfirm) {
      setStatus("error");
      setErrorMessage("パスワードが一致しません。");
      return;
    }

    setStatus("submitting");
    setErrorMessage(null);

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      // パスワードそのものはログに残さない（error.messageにも含まれない。
      // Supabase Authのエラーは要件違反の説明文であり、入力値そのものではない）。
      console.error("パスワードの変更に失敗しました", error);
      setStatus("error");
      setErrorMessage(translateUpdatePasswordError(error));
      return;
    }

    await supabase.auth.signOut();
    setStatus("done");
  }

  if (status === "done") {
    return (
      <main className="appShell adminShell">
        <div className="authScreen">
          <h1>パスワードを再設定</h1>
          <p className="authSentMessage">
            パスワードを変更しました。新しいパスワードでログインしてください。
          </p>
          <button type="button" className="importConfirmButton" onClick={onDone}>
            ログイン画面へ
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="appShell adminShell">
      <div className="authScreen">
        <h1>新しいパスワードを設定</h1>
        <p>新しいパスワードを入力してください。</p>

        <form onSubmit={handleSubmit} className="authForm">
          <label className="flowFieldLabel">
            新しいパスワード
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
            新しいパスワード（確認）
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
            disabled={status === "submitting" || !password || !passwordConfirm}
          >
            {status === "submitting" ? "変更中…" : "パスワードを変更"}
          </button>
        </form>
      </div>
    </main>
  );
}
