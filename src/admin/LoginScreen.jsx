import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { translateAuthError } from "./authErrorMessages";
import { translateResetRequestError } from "./passwordResetErrorMessages";

// emailRedirectTo は「リンクをクリックした後に戻ってくるURL」で、実行時の
// window.location から組み立てる。こうすることで、ローカル開発
// （例: http://localhost:5173/）でもGitHub Pagesのサブパス公開
// （例: https://xxxx.github.io/concur-maigo-boshi-bot/）でも、
// コードを変更せずに正しいURLへ戻ってこられる。
// ただしSupabase側の「Redirect URLs」に両方のURLを許可リストとして
// 登録しておく必要がある（docs/supabase-setup.md 参照）。
//
// あえて末尾に #admin を付けていない。このアプリは #admin を独自の
// ハッシュルーティングとして使っており、Supabaseは認証完了後にURLへ
// 認証情報（PKCEなら?code=...）を埋め込んで戻ってくるため、リダイレクト先に
// 最初から#adminのようなハッシュフラグメントが含まれていると、Supabase側の
// ハッシュ/クエリ操作と衝突する恐れがある。そのため戻り先はorigin+pathnameだけの
// クリーンなURLにし、ログイン処理が完了してから#adminへはAuthGate.jsxが
// プログラム的に遷移させる（src/admin/authCallback.js・main.jsxも参照）。
//
// ?authFlow=admin は自前のマーカーで、main.jsxのisAdminAuthCallback()が
// 「この認証コールバックは管理画面Magic Linkログイン由来である」と判定するために
// 使う。一般ユーザーのsignUp確認メール（SignUpScreen.jsx）には付けない。
// これが無いと、一般ユーザーの確認メールと区別が付かず、確認メールを
// クリックしただけで管理画面ツリー（AuthGate）が誤ってマウントされてしまう
// （実際に起きていた不具合。詳細はsrc/admin/authCallback.jsのコメント参照）。
function buildRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}?authFlow=admin`;
}

// パスワード再設定メール（resetPasswordForEmail）専用のredirectTo。buildRedirectUrl
// （Magic Link・admin専用）と同じ理由でorigin+pathnameを実行時に組み立てるが、
// マーカーは ?authFlow=recovery にする。一般ユーザーのsignUp確認メール
// （マーカー無し）・admin Magic Link（authFlow=admin）のどちらとも区別するためで、
// これによりmain.jsxのresolveRootTreeがパスワード再設定リンクだけを
// PasswordRecoveryGateへルーティングできる（src/admin/authCallback.js参照）。
// パスワード再設定は一般ユーザー・admin・platform_adminの全員が同じ画面
// （このLoginScreen）から行うため、admin/一般のどちらの文脈で呼ばれても
// このマーカーは常に同じ値になる。
function buildRecoveryRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}?authFlow=recovery`;
}

// 管理画面ログイン画面。
//
// 基本の方式はメールアドレス＋パスワード（signInWithPassword）。
// Magic Linkのメール送信にはSupabase側の送信レート制限があり、
// 複数会社・複数管理者で使い始めるとログインのたびにメールを送る運用は
// 制限に達しやすいため、パスワードログインを主方式にしている
// （パスワードでのログインはメールを一切送らないため、レート制限の影響を受けない）。
//
// Magic Linkは「補助的な導線」として残してあり、パスワード未設定のユーザーや
// パスワードを忘れた場合の代替手段として使える。
//
// allowMagicLink=false（一般利用者Bot画面のAppAuthGateから使う場合）にすると
// Magic Linkの導線自体を隠す。理由：Magic Linkのメール内リンクは常に
// buildRedirectUrl()（#adminを含まないorigin+pathnameのみ）へ戻ってくるため、
// main.jsx側は「認証コールバックが来た＝管理画面ログイン中だった」と
// 区別できない。管理画面・一般利用者の両方でMagic Linkを許可すると、
// 一般利用者がMagic Linkでログインした際に誤って管理画面ツリーへ
// ルーティングされてしまう恐れがある。パスワードログイン・アカウント作成は
// リダイレクトを伴わずその場で完結するため、この問題が起きない
// （main.jsxのhasPendingAuthCallback参照）。
export default function LoginScreen({
  onSwitchToSignUp,
  title = "管理画面ログイン",
  allowMagicLink = true,
  signUpSwitchLabel = "アカウントを作成",
  bannerMessage = null,
}) {
  const [mode, setMode] = useState("password"); // "password" | "magiclink" | "forgot"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("idle"); // idle | submitting | sent | error
  const [errorMessage, setErrorMessage] = useState(null);

  function switchMode(nextMode) {
    setMode(nextMode);
    setStatus("idle");
    setErrorMessage(null);
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      return;
    }

    setStatus("submitting");
    setErrorMessage(null);

    const { error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    if (error) {
      setStatus("error");
      setErrorMessage(translateAuthError(error));
      return;
    }

    // 成功するとonAuthStateChangeがSIGNED_INを検知し、AuthGateが
    // 自動的に管理画面へ切り替える（このコンポーネント自身が遷移操作を行う必要はない）。
    setStatus("idle");
  }

  async function handleMagicLinkSubmit(event) {
    event.preventDefault();
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      return;
    }

    setStatus("submitting");
    setErrorMessage(null);

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        emailRedirectTo: buildRedirectUrl(),
      },
    });

    if (error) {
      setStatus("error");
      setErrorMessage(translateAuthError(error));
      return;
    }

    setStatus("sent");
  }

  // パスワードを忘れた方向け。resetPasswordForEmail()はメールアドレスが実際に
  // 登録されているかどうかに関わらず同じ成功レスポンスを返す（Supabase Auth標準の
  // 仕様。第三者にアカウントの存在有無を推測されないための設計）ため、成功時は
  // 常に同一の文言を表示し、「このアドレスは登録されていません」等は一切出さない
  // （詳細はpasswordResetErrorMessages.js参照）。
  async function handleForgotPasswordSubmit(event) {
    event.preventDefault();
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      return;
    }

    setStatus("submitting");
    setErrorMessage(null);

    const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo: buildRecoveryRedirectUrl(),
    });

    if (error) {
      setStatus("error");
      setErrorMessage(translateResetRequestError(error));
      return;
    }

    setStatus("sent");
  }

  return (
    <main className="appShell adminShell">
      <div className="authScreen">
        <h1>{mode === "forgot" ? "パスワードを再設定" : title}</h1>

        {bannerMessage && (
          <p className="settingsErrorText" role="alert">
            {bannerMessage}
          </p>
        )}

        {mode === "password" && (
          <>
            <form onSubmit={handlePasswordSubmit} className="authForm">
              <label className="flowFieldLabel">
                メールアドレス
                <input
                  type="email"
                  className="settingsTextInput"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
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
                  autoComplete="current-password"
                />
              </label>

              {status === "error" && <p className="settingsErrorText">{errorMessage}</p>}

              <button
                type="submit"
                className="importConfirmButton"
                disabled={status === "submitting" || !email.trim() || !password}
              >
                {status === "submitting" ? "ログイン中…" : "ログイン"}
              </button>
            </form>

            {allowMagicLink && (
              <button
                type="button"
                className="authModeSwitchLink"
                onClick={() => switchMode("magiclink")}
              >
                メールでログインリンクを受け取る
              </button>
            )}

            <button type="button" className="authModeSwitchLink" onClick={() => switchMode("forgot")}>
              パスワードを忘れた方
            </button>

            {onSwitchToSignUp && (
              <button type="button" className="authModeSwitchLink" onClick={onSwitchToSignUp}>
                {signUpSwitchLabel}
              </button>
            )}
          </>
        )}

        {mode === "magiclink" && (
          <>
            {status === "sent" ? (
              <p className="authSentMessage">
                <strong>{email}</strong> 宛にログインリンクを送信しました。メールを確認し、
                リンクをクリックしてください。
              </p>
            ) : (
              <form onSubmit={handleMagicLinkSubmit} className="authForm">
                <label className="flowFieldLabel">
                  メールアドレス
                  <input
                    type="email"
                    className="settingsTextInput"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    required
                    autoComplete="email"
                  />
                </label>

                {status === "error" && <p className="settingsErrorText">{errorMessage}</p>}

                <button
                  type="submit"
                  className="importConfirmButton"
                  disabled={status === "submitting" || !email.trim()}
                >
                  {status === "submitting" ? "送信中…" : "ログインリンクを送信"}
                </button>
              </form>
            )}

            <button
              type="button"
              className="authModeSwitchLink"
              onClick={() => switchMode("password")}
            >
              パスワードでログインする
            </button>
          </>
        )}

        {mode === "forgot" && (
          <>
            {status === "sent" ? (
              <p className="authSentMessage">
                パスワード再設定メールを送信しました。メール内のリンクから新しいパスワードを
                設定してください。
              </p>
            ) : (
              <form onSubmit={handleForgotPasswordSubmit} className="authForm">
                <p>
                  登録しているメールアドレスを入力してください。パスワード再設定用のメールを
                  送信します。
                </p>

                <label className="flowFieldLabel">
                  メールアドレス
                  <input
                    type="email"
                    className="settingsTextInput"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    required
                    autoComplete="email"
                  />
                </label>

                {status === "error" && <p className="settingsErrorText">{errorMessage}</p>}

                <button
                  type="submit"
                  className="importConfirmButton"
                  disabled={status === "submitting" || !email.trim()}
                >
                  {status === "submitting" ? "送信中…" : "再設定メールを送信"}
                </button>
              </form>
            )}

            <button
              type="button"
              className="authModeSwitchLink"
              onClick={() => switchMode("password")}
            >
              ログインへ戻る
            </button>
          </>
        )}
      </div>
    </main>
  );
}
