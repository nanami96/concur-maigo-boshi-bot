import { useCallback, useEffect, useRef, useState } from "react";
import BotConversation from "./BotConversation";
import InviteCodeScreen from "./admin/InviteCodeScreen";
import { fetchMyMembership, redeemInviteCode } from "./data/membershipRepository";
import { resolveMembershipErrorMessage } from "./admin/membershipErrorMessages";
import {
  readPendingInviteCode,
  clearPendingInviteCode,
  resolveAutoRedeemOutcome,
} from "./data/pendingInviteCode";
import { createAutoRedeemPendingInvite } from "./data/autoRedeemPendingInvite";

// 未ログイン時点で「会社へ参加」画面（InviteCodeEntryScreen.jsx）に入力された招待コードを、
// ログイン確定後に自動的にredeem_invite_code()へ渡すためのゲート。
//
// pendingな招待コードがある場合は、それを使って自動的に会社参加を試みる
// （ユーザーが再度招待コードを入力する必要が無いようにするため）。無い場合は
// 従来通りInviteCodeScreen（手動入力）をそのまま表示する。
//
// 二重実行対策：実際の排他制御・pending破棄の判断はautoRedeemPendingInvite.jsの
// createAutoRedeemPendingInvite()に集約している（Reactから切り離してテスト
// できるようにするため）。コンポーネントの生存期間中ずっと同じインスタンス
// （useRefで保持）を使い続けるため、React StrictModeのeffect二重実行や
// 何らかの理由での再レンダーが重なっても、実際にredeem_invite_code() RPCが
// 2回同時に呼ばれることはない。仮に何らかの経路で2回呼ばれてしまっても、
// DB側のcompany_members_user_id_key（1ユーザー1社のunique制約）と
// redeem_invite_code()自身の「既に所属済み」チェックが最終防御として働くため、
// 2社に同時所属してしまうことは無い（resolveAutoRedeemOutcomeはalready_memberを
// 「成功と同様に扱ってよい」と判定する。詳細はpendingInviteCode.js参照）。
function NoMembershipGate({ onJoined }) {
  const [phase, setPhase] = useState(() => (readPendingInviteCode() ? "auto-redeeming" : "manual"));
  const [autoErrorMessage, setAutoErrorMessage] = useState(null);
  const autoRedeemRef = useRef(null);
  if (!autoRedeemRef.current) {
    autoRedeemRef.current = createAutoRedeemPendingInvite({
      readPendingInviteCode,
      redeemInviteCode,
      clearPendingInviteCode,
      resolveAutoRedeemOutcome,
    });
  }

  const attemptAutoRedeem = useCallback(async () => {
    setPhase("auto-redeeming");
    setAutoErrorMessage(null);

    const { attempted, outcome, error } = await autoRedeemRef.current();

    if (!attempted) {
      return;
    }

    if (outcome === "success") {
      onJoined();
      return;
    }

    if (outcome === "retry") {
      // 通信エラー等：招待コードはまだ有効かもしれないため破棄しない
      // （createAutoRedeemPendingInvite側もclearしていない）。
      // 「再試行する」で同じコードのまま再実行できるようにする。
      setPhase("auto-retry");
      return;
    }

    // clear_and_manual：無効な招待コード等、再試行しても解決しないエラー。
    console.error("招待コードの自動参加処理に失敗しました", error);
    setAutoErrorMessage(resolveMembershipErrorMessage(error.type));
    setPhase("manual");
  }, [onJoined]);

  useEffect(() => {
    if (phase === "auto-redeeming") {
      attemptAutoRedeem();
    }
  }, [phase, attemptAutoRedeem]);

  if (phase === "auto-redeeming") {
    return (
      <main className="appShell">
        <section className="chatPanel botStatusPanel" aria-label="Concur迷子防止Botの質問">
          <p>会社への参加処理を行っています…</p>
        </section>
      </main>
    );
  }

  if (phase === "auto-retry") {
    return (
      <main className="appShell">
        <div className="authScreen">
          <h1>会社への参加</h1>
          <p className="settingsErrorText" role="alert">
            通信エラーが発生しました。通信状態を確認して再度お試しください。
          </p>
          <button
            type="button"
            className="importConfirmButton"
            onClick={() => setPhase("auto-redeeming")}
          >
            再試行する
          </button>
          <button
            type="button"
            className="authModeSwitchLink"
            onClick={() => {
              clearPendingInviteCode();
              setPhase("manual");
            }}
          >
            招待コードを入力し直す
          </button>
        </div>
      </main>
    );
  }

  return <InviteCodeScreen onJoined={onJoined} initialErrorMessage={autoErrorMessage} />;
}

// ログイン済みであることが確定した後（AppAuthGate経由）に表示する、
// 一般利用者Bot画面の本体。
//
// company_codeをユーザーに選ばせたり入力させたりすることは一切無い。
// get_my_public_config() RPC（membershipRepository.fetchMyMembership）が
// auth.uid()だけから所属会社を解決するため、会社セレクタ・?company=・
// 他社一覧はこの画面のどこにも存在しない
// （list_public_companies/?companyのロジックはApp.jsx側にしか無く、
// この画面からは一切importしていない）。
export default function AuthenticatedBotScreen({ onSignOut }) {
  const [state, setState] = useState({ status: "loading", membership: null });

  const load = useCallback(async () => {
    setState({ status: "loading", membership: null });

    const { membership, error } = await fetchMyMembership();

    if (error) {
      console.error("所属会社・公開設定の取得に失敗しました", error);
      setState({ status: "error", membership: null });
      return;
    }

    if (!membership) {
      setState({ status: "no-membership", membership: null });
      return;
    }

    setState({
      status: membership.configSnapshot ? "ready" : "unpublished",
      membership,
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (state.status === "loading") {
    return (
      <main className="appShell">
        <section className="chatPanel botStatusPanel" aria-label="Concur迷子防止Botの質問">
          <p>読み込んでいます…</p>
        </section>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="appShell">
        <section className="chatPanel botStatusPanel" aria-label="Concur迷子防止Botの質問">
          <p>現在、設定を読み込めません。しばらくしてから再度お試しください。</p>
        </section>
      </main>
    );
  }

  if (state.status === "no-membership") {
    return <NoMembershipGate onJoined={load} />;
  }

  const isAdmin = state.membership.role === "admin";

  // 管理画面（#admin）はAdminViewportGateにより1024px未満ではPC利用案内へ
  // 差し替わり編集UIを表示しないため、その導線であるこのリンク自体も
  // スマホ幅では意味を持たない。adminLinkButtonクラスでCSS側から
  // 1024px未満のみ非表示にする（styles.css参照。role='admin'かどうかの
  // 判定自体はここでは変更していない）。
  const headerActions = isAdmin ? (
    <a className="resetButton adminLinkButton" href="#admin">
      管理画面へ
    </a>
  ) : null;

  if (state.status === "unpublished") {
    return (
      <main className="appShell">
        <section className="chatPanel botStatusPanel" aria-label="Concur迷子防止Botの質問">
          <p>現在、この会社の利用設定は準備中です。</p>
          {isAdmin && <p>管理画面で設定を作成・公開してください。</p>}
        </section>
        {isAdmin && (
          <p className="flowEmptyState">
            <a className="resetButton adminLinkButton" href="#admin">
              管理画面へ
            </a>
          </p>
        )}
      </main>
    );
  }

  return (
    <BotConversation
      config={state.membership.configSnapshot}
      status="ready"
      headerActions={headerActions}
      onSignOut={onSignOut}
      // 領収書OCR（ReceiptOcrPanel.jsx）はSupabase Edge Functionを呼ぶため、
      // ログイン済み（＝ここに到達できている）ユーザーの画面でだけ有効にする。
      // App.jsx（Supabase未設定のローカル開発・公開デモ、ログイン無し）側では
      // このpropを渡していないため既定のfalseのままとなり、OCRの導線自体が
      // 表示されない（実際の認証・権限チェックはEdge Function側が最終防御）。
      enableReceiptOcr
    />
  );
}
