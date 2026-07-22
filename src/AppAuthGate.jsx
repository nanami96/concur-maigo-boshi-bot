import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "./lib/supabaseClient";
import { resolveAuthGateView } from "./admin/authGateStatus";
import {
  hasPendingAuthCallback,
  exchangeAuthCallback,
  cleanGeneralAuthCallbackUrl,
  resolvePendingAuthSession,
} from "./admin/authCallback";
import AuthEntryScreens from "./admin/AuthEntryScreens";
import AuthenticatedBotScreen from "./AuthenticatedBotScreen";
import App from "./App";

// 一般利用者Bot画面向けの認証ゲート。src/admin/AuthGate.jsxと対になる存在で、
// 判定ロジック（resolveAuthGateView）はそのまま共有する。
//
// Supabase未設定（ローカル開発・静的デモ）の場合は、従来通りApp.jsx
// （会社セレクタ付き）をそのまま表示する（認証を要求しない）。
// Supabase設定済みの場合は、ログイン必須にした上で、会社の自動判定は
// AuthenticatedBotScreenに完全に委ねる（会社セレクタ・?company=・他社一覧は
// このゲートより先には一切渡さない＝App.jsxはSupabase未設定時にしか
// レンダリングされない）。
//
// 一般ユーザーのアカウント作成確認メールのリンクから戻ってきた場合
// （URLに?code=...が付いている場合）は、authStatusを"loading"のまま保ち、
// exchangeAuthCallback()でセッションへの交換が完了してからgetSession()で
// 最終的な状態を確定させる。これにより、交換が終わる前に一瞬「会社へ参加」
// 画面が表示されてしまうことを防ぐ（詳細はsrc/admin/authCallback.js参照。
// 以前はsupabase-jsのdetectSessionInUrlに自動処理を任せていたが、実Supabase
// 環境で確認メールのリンクをクリックしてもセッションが確立されない不具合が
// あったため、明示的にexchangeするよう変更した）。
export default function AppAuthGate() {
  const [authStatus, setAuthStatus] = useState("loading");
  const [authCallbackError, setAuthCallbackError] = useState(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return undefined;
    }

    let isMounted = true;

    async function resolveInitialSession() {
      const location = { search: window.location.search, hash: window.location.hash };

      const { session } = await resolvePendingAuthSession({
        location,
        hasPendingAuthCallback,
        exchangeAuthCallback: (loc) => exchangeAuthCallback(supabase, loc),
        onExchangeSettled: ({ error }) => {
          if (error) {
            // 交換に失敗しても、招待コードの一時保持（localStorage）はここでは
            // 一切触らない。手動ログインさえ成功すれば、AuthenticatedBotScreen側の
            // 自動redeem処理がそのまま働く（詳細はAuthenticatedBotScreen.jsx参照）。
            console.error("認証コールバックの処理に失敗しました", error);
            if (isMounted) {
              setAuthCallbackError(
                "メール確認の処理に失敗しました。お手数ですが、ログインしてください（メールアドレスの確認自体は完了しています）。",
              );
            }
          } else {
            cleanGeneralAuthCallbackUrl();
          }
        },
        getSession: () => supabase.auth.getSession(),
      });

      if (!isMounted) {
        return;
      }
      setAuthStatus(session ? "signedIn" : "signedOut");
    }

    resolveInitialSession();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) {
        return;
      }
      setAuthStatus(session ? "signedIn" : "signedOut");
      if (session) {
        setAuthCallbackError(null);
      }
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const view = resolveAuthGateView({ isSupabaseConfigured, authStatus });

  if (view === "local") {
    return <App />;
  }

  if (view === "loading") {
    return (
      <main className="appShell">
        <section className="chatPanel botStatusPanel" aria-label="Concur迷子防止Botの質問">
          <p>認証状態を確認しています…</p>
        </section>
      </main>
    );
  }

  if (view === "signedOut") {
    return (
      <AuthEntryScreens
        loginTitle="ログイン"
        signUpTitle="アカウントを作成"
        allowMagicLink={false}
        // 認証コールバックの処理に失敗した直後だけは、招待コード入力からではなく
        // 直接ログイン画面から始める（アカウント作成・メール確認自体は既に
        // 完了しているため、招待コードを入力し直す必要は無い。保持されたままの
        // pending inviteは、ログイン成功後にAuthenticatedBotScreen側が自動的に
        // 使う）。
        startWithInviteCode={!authCallbackError}
        signUpSwitchLabel="はじめて利用する / アカウントを作成"
        loginBannerMessage={authCallbackError}
      />
    );
  }

  return (
    <>
      <div className="authSignedInBar" role="status">
        <button
          type="button"
          className="authSignOutButton"
          onClick={() => supabase.auth.signOut()}
        >
          ログアウト
        </button>
      </div>
      <AuthenticatedBotScreen />
    </>
  );
}
