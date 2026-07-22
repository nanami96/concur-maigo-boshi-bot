import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";
import { resolveAuthGateView } from "./authGateStatus";
import { hasPendingAuthCallback, exchangeAuthCallback, resolvePendingAuthSession } from "./authCallback";
import AuthEntryScreens from "./AuthEntryScreens";
import { fetchMyRole, fetchIsPlatformAdmin } from "../data/membershipRepository";

// Magic Linkの認証コールバック処理（exchangeAuthCallback呼び出し）の直後に呼ぶ
// （成功・失敗どちらの場合も呼ぶ。詳細は呼び出し元のresolveInitialSession参照）。
// LoginScreen.jsxのbuildRedirectUrlは#adminを含まないクリーンなURLへ戻す設計に
// しているため、この時点ではまだ#adminになっていないことがある。ここでURLを
// #adminへ書き換える（history.replaceStateなので、余分な履歴エントリは増えない）。
// あわせて、認証コールバックの痕跡として残っている?code=・authFlow=クエリも
// 取り除く。
// 既に#adminにいる場合（＝ページ再読み込みなどで、URL操作を伴わない
// 通常のセッション復元の場合）は、?code=の掃除だけ行いURLを書き換えない。
function redirectToAdminAfterSignIn() {
  const url = new URL(window.location.href);
  const hadCode = url.searchParams.has("code") || url.searchParams.has("authFlow");
  url.searchParams.delete("code");
  // authFlow=adminは、main.jsxのisAdminAuthCallback()が管理画面ツリーへ
  // ルーティングするかどうかを判定するためだけのマーカーで、ログイン処理が
  // 完了した後はURLに残す意味が無いため、?code=と同様にここで取り除く。
  url.searchParams.delete("authFlow");

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
// 意図的に疎結合にしてあり、AuthGateはSupabaseの設定状況・ログイン状態・
// role（company_members.role）・platform_adminかどうかだけを見て
// 「AdminRootを表示してよいか」を判断する。AdminRoot側はAuthGateの存在を
// 一切知らなくてよい（propsで認証状態を渡していない。AdminRoot自身が
// 必要ならplatform_admin判定を独自に取得する。詳細はAdminRoot.jsx参照）。
//
// Phase 7以降、company_membersには一般利用者(role='user')も登録されるため、
// 「ログイン済みであること」だけでは管理画面アクセスの許可条件として不十分になった。
// Phase 8以降はさらに、company_members上ではadminではない（あるいは
// どの会社にも所属していない）ユーザーでも、platform_admins（全社を横断管理する
// サービス運営者）であれば管理画面へアクセスできるようにする。
//
// 権限判定の優先順位は「role==='admin' か is_platform_admin() のどちらか一方でも
// 真ならAdminRootを表示」というOR条件のみで、優先順位という概念自体を持たない
// （どちらの経路で許可されたかをAuthGate自身が区別する必要は無い。会社セレクタの
// 表示等、platform_adminとしての振る舞いの違いはAdminRoot側の責務）。
// 両方偽の場合のみ「管理者権限がありません」を表示し、AdminRootをレンダリングしない
// （UIで隠すだけでなく、AdminRoot配下のあらゆるSupabase操作は既存RLS・RPCの
// role='admin' or is_platform_admin()条件がDB側の最終防御になっている。
// 本チェックはUX目的の早期拒否）。
//
// 利用者向けBot画面（AppAuthGate/App.jsx）はこのコンポーネントを経由しない。
export default function AuthGate({ children }) {
  const [authStatus, setAuthStatus] = useState("loading");
  const [roleStatus, setRoleStatus] = useState("checking"); // checking | admin | forbidden | error

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return undefined;
    }

    let isMounted = true;

    async function resolveInitialSession() {
      const location = { search: window.location.search, hash: window.location.hash };

      // Magic Linkのリンクから戻ってきた直後。以前はsupabase-jsの
      // detectSessionInUrlに自動処理を任せていたが、明示的に
      // exchangeAuthCallback()（src/admin/authCallback.js）を呼び、
      // 成功・失敗を確実に検知できるようにした（詳細は同ファイル参照）。
      const { session } = await resolvePendingAuthSession({
        location,
        hasPendingAuthCallback,
        exchangeAuthCallback: (loc) => exchangeAuthCallback(supabase, loc),
        onExchangeSettled: ({ error }) => {
          if (error) {
            console.error("Magic Linkログインの処理に失敗しました", error);
          }
          // 成功・失敗いずれの場合も、URLを#admin付きのクリーンな状態へ
          // 正規化しておく（失敗時に?code=・authFlow=等が残ったままだと、
          // リロードのたびに再度この分岐へ入り続けてしまうため）。
          redirectToAdminAfterSignIn();
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
      if (!session) {
        setRoleStatus("checking");
      }
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (authStatus !== "signedIn") {
      return undefined;
    }

    let cancelled = false;
    setRoleStatus("checking");

    Promise.all([fetchMyRole(), fetchIsPlatformAdmin()]).then(
      ([{ role, error: roleError }, { isPlatformAdmin, error: platformError }]) => {
        if (cancelled) {
          return;
        }
        if (roleError || platformError) {
          console.error("権限の確認に失敗しました", roleError || platformError);
          setRoleStatus("error");
          return;
        }
        setRoleStatus(isPlatformAdmin || role === "admin" ? "admin" : "forbidden");
      },
    );

    return () => {
      cancelled = true;
    };
  }, [authStatus]);

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
    return <AuthEntryScreens loginTitle="管理画面ログイン" signUpTitle="アカウントを作成" />;
  }

  const signedInBar = (
    <div className="authSignedInBar" role="status">
      <button type="button" className="authSignOutButton" onClick={() => supabase.auth.signOut()}>
        ログアウト
      </button>
    </div>
  );

  if (roleStatus === "checking") {
    return (
      <>
        {signedInBar}
        <main className="appShell adminShell">
          <div className="authScreen">
            <p>権限を確認しています…</p>
          </div>
        </main>
      </>
    );
  }

  if (roleStatus === "error") {
    return (
      <>
        {signedInBar}
        <main className="appShell adminShell">
          <div className="authScreen">
            <p>権限の確認に失敗しました。しばらくしてから再度お試しください。</p>
          </div>
        </main>
      </>
    );
  }

  if (roleStatus === "forbidden") {
    return (
      <>
        {signedInBar}
        <main className="appShell adminShell">
          <div className="authScreen">
            <h1>管理者権限がありません</h1>
            <p>この画面は会社の管理者のみ利用できます。管理者にお問い合わせください。</p>
            <a className="resetButton" href="#">
              利用者画面へ戻る
            </a>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      {signedInBar}
      {children}
    </>
  );
}
