import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "./lib/supabaseClient";
import {
  hasPendingAuthCallback,
  exchangeAuthCallback,
  resolveRecoverySession,
  cleanGeneralAuthCallbackUrl,
} from "./admin/authCallback";
import { translateRecoveryCallbackError } from "./admin/passwordResetErrorMessages";
import ResetPasswordScreen from "./admin/ResetPasswordScreen";

// パスワード再設定専用のツリー。main.jsx の resolveRootTree() が "recovery" と
// 判定した場合（authFlow=recovery マーカー付きの認証コールバック）だけマウントされる。
//
// AppAuthGate・AuthGateとは意図的に完全に別ツリーとして実装している。理由：
//   ・パスワード再設定リンクの交換（exchangeCodeForSession）も、通常のサインインと
//     全く同じ形で「ログイン済み」セッションを確立する。もしこれをAppAuthGateの
//     通常ツリーで処理すると、AuthenticatedBotScreenのNoMembershipGateが
//     「ログイン済み・未所属」を検知し、招待コード入力〜アカウント作成の途中で
//     保存されたpending inviteを意図せず自動redeemしてしまう恐れがある。
//     このツリーはAuthenticatedBotScreenを一切import・経由しないため、
//     そのリスクを構造的に排除できる（pending invite自体にも一切触れない）。
//   ・detectSessionInUrl:falseの構成では、明示的なexchangeCodeForSession()は
//     常に"SIGNED_IN"イベントを発火する（Supabase Authの"PASSWORD_RECOVERY"
//     イベントはsupabase-js内部のURL自動検出パスでしか発火しないため、この
//     プロジェクトの構成では届かない）。そのため「これがrecoveryかどうか」は
//     authFlow=recoveryマーカー（authCallback.jsのisRecoveryAuthCallback）だけで
//     判定し、AppAuthGate/AuthGateのonAuthStateChangeリスナーとは完全に独立させる。
export default function PasswordRecoveryGate() {
  const [status, setStatus] = useState(isSupabaseConfigured ? "exchanging" : "ready");
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return undefined;
    }

    let isMounted = true;

    async function resolve() {
      const location = { search: window.location.search, hash: window.location.hash };

      const { success, invalidLink, error } = await resolveRecoverySession({
        location,
        hasPendingAuthCallback,
        exchangeAuthCallback: (loc) => exchangeAuthCallback(supabase, loc),
      });

      if (!isMounted) {
        return;
      }

      if (invalidLink) {
        setStatus("error");
        setErrorMessage(
          "パスワード再設定のリンクが正しくありません。もう一度パスワード再設定をお試しください。",
        );
        return;
      }

      if (!success) {
        console.error("パスワード再設定リンクの処理に失敗しました", error);
        setStatus("error");
        setErrorMessage(translateRecoveryCallbackError(error));
        return;
      }

      cleanGeneralAuthCallbackUrl();
      setStatus("ready");
    }

    resolve();

    return () => {
      isMounted = false;
    };
  }, []);

  // ログイン画面へ戻る＝URLを完全にクリーンな状態へ戻した上で、あえてページを
  // 再読み込みする（history.replaceStateだけで済ませず、確実に真っ新な状態から
  // main.jsxのツリー判定をやり直させるため。残っているrecoveryセッションは
  // ResetPasswordScreen側で既にsignOut済み、またはこの画面に来る前の時点で
  // まだセッションが存在しない＝特別な後始末は不要）。
  function handleBackToLogin() {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    window.location.href = url.toString();
  }

  if (status === "exchanging") {
    return (
      <main className="appShell adminShell">
        <div className="authScreen">
          <p>認証を確認しています…</p>
        </div>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="appShell adminShell">
        <div className="authScreen">
          <h1>パスワード再設定</h1>
          <p className="settingsErrorText" role="alert">
            {errorMessage}
          </p>
          <button type="button" className="authModeSwitchLink" onClick={handleBackToLogin}>
            ログイン画面へ戻る
          </button>
        </div>
      </main>
    );
  }

  return <ResetPasswordScreen onDone={handleBackToLogin} />;
}
