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

  // ログイン画面（特にパスワード入力欄）はスマホの仮想キーボード表示に伴い、
  // ブラウザが入力欄を画面内に収めようとページを下方向へスクロールしていることが
  // ある。ログイン成功でauthStatusが"signedIn"に変わりログイン画面から
  // AuthenticatedBotScreen（Bot本体）へDOMごと入れ替わっても、これはブラウザの
  // scroll位置そのものには影響しないため、このスクロール位置がそのまま残り、
  // Bot画面のタイトルより下（「戻る」「最初から」や最初の質問付近）が
  // 見えている状態から表示されてしまっていた（ページ遷移を伴わないSPAのため、
  // ブラウザ標準のスクロール位置リセットも働かない）。
  // authStatusが"signedIn"になった直後（＝ログイン成功時・リロードによる
  // セッション復元時・再ログイン時のいずれも該当）だけ、ページ最上部へ
  // 明示的に戻す。BotConversation側で質問に回答して会話を進めている間は
  // authStatusは変化しない（ログイン状態が変わるわけではない）ため、
  // 回答のたびにここが再実行されて会話中のスクロール位置を乱すことはない。
  useEffect(() => {
    if (authStatus === "signedIn") {
      window.scrollTo(0, 0);
    }
  }, [authStatus]);

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

  // .authSignedInBar（画面最上部の独立した全幅バー）は、スマホ幅では
  // BotConversation.jsx内のeyebrowRowにある同機能のボタン（mobileSignOutButton）に
  // 表示を譲る（styles.cssの.authSignedInBar:has(+ .appShell .chatPanel)で
  // 非表示にする）。そのため、同じsignOut処理をAuthenticatedBotScreenへも渡し、
  // どちらのボタンからログアウトしても同じ挙動になるようにする。
  const signOut = () => supabase.auth.signOut();

  return (
    <>
      <div className="authSignedInBar" role="status">
        <button type="button" className="authSignOutButton" onClick={signOut}>
          ログアウト
        </button>
      </div>
      <AuthenticatedBotScreen onSignOut={signOut} />
    </>
  );
}
