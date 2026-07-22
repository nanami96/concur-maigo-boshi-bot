import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";
import { resolveAuthGateView } from "./authGateStatus";
import LoginScreen from "./LoginScreen";

// Magic Linkのログインが完了した直後（onAuthStateChangeがSIGNED_INを通知した時）に
// 呼ぶ。LoginScreen.jsxのbuildRedirectUrlは#adminを含まないクリーンなURLへ
// 戻す設計にしているため、ログイン完了時点ではまだ#adminになっていないことがある。
// ここでURLを#adminへ書き換える（history.replaceStateなので、余分な
// 履歴エントリは増えない）。あわせて、Supabaseが処理し損ねて残っている
// 可能性がある?code=クエリも念のため取り除く。
// 既に#adminにいる場合（＝ページ再読み込みなどで、URL操作を伴わない
// 通常のセッション復元の場合）は、?code=の掃除だけ行いURLを書き換えない。
function redirectToAdminAfterSignIn() {
  const url = new URL(window.location.href);
  const hadCode = url.searchParams.has("code");
  url.searchParams.delete("code");

  if (url.hash.startsWith("#admin")) {
    if (hadCode) {
      window.history.replaceState(null, "", url.toString());
    }
    return;
  }

  url.hash = "admin";
  window.history.replaceState(null, "", url.toString());
}

// #admin のときだけ通す認証ゲート。AdminRoot（実際の編集ロジック）とは
// 意図的に疎結合にしてあり、AuthGateはSupabaseの設定状況とログイン状態だけを見て
// 「AdminRootを表示してよいか」を判断する。AdminRoot側はAuthGateの存在を
// 一切知らなくてよい（propsで認証状態を渡していない）。
//
// 利用者向けBot画面（App.jsx）はこのコンポーネントを経由しないため、
// 認証は一切要求されない。
export default function AuthGate({ children }) {
  const [authStatus, setAuthStatus] = useState("loading");

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return undefined;
    }

    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) {
        return;
      }
      setAuthStatus(data.session ? "signedIn" : "signedOut");
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) {
        return;
      }
      setAuthStatus(session ? "signedIn" : "signedOut");

      // SIGNED_INは「今まさにログインが完了した」タイミングでも、
      // 「既存セッションが復元された」タイミングでも発火しうるが、
      // redirectToAdminAfterSignInは既に#adminにいる場合は何もしない
      // （?code=の掃除以外）ため、どちらのケースでも安全に呼べる。
      if (event === "SIGNED_IN") {
        redirectToAdminAfterSignIn();
      }
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const view = resolveAuthGateView({ isSupabaseConfigured, authStatus });

  if (view === "local") {
    return (
      <>
        <div className="authLocalModeBanner" role="status">
          ローカル開発モードで動作しています（Supabase未設定）。認証・データの保存は行われません。
        </div>
        {children}
      </>
    );
  }

  if (view === "loading") {
    return (
      <main className="appShell adminShell">
        <div className="authScreen">
          <p>認証状態を確認しています…</p>
        </div>
      </main>
    );
  }

  if (view === "signedOut") {
    return <LoginScreen />;
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
      {children}
    </>
  );
}
