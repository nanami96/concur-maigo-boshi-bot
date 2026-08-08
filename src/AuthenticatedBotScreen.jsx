import { useCallback, useEffect, useRef, useState } from "react";
import BotConversation from "./BotConversation";
import InviteCodeScreen from "./admin/InviteCodeScreen";
import { redeemInviteCode } from "./data/membershipRepository";
import { resolveMembershipErrorMessage } from "./admin/membershipErrorMessages";
import {
  readPendingInviteCode,
  clearPendingInviteCode,
  resolveAutoRedeemOutcome,
} from "./data/pendingInviteCode";
import { createAutoRedeemPendingInvite } from "./data/autoRedeemPendingInvite";
import { CompanyProvider, useCompanyContext } from "./company/CompanyContext";

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
// DB側のunique(company_id, user_id)制約とredeem_invite_code()自身の
// 「同じ会社への重複所属」チェックが最終防御として働くため、同じ会社へ
// 二重に所属してしまうことは無い（複数社所属は正式仕様のため、これは
// 「1ユーザー1社」を守るものではなく「同一会社への二重登録」だけを防ぐ。
// resolveAutoRedeemOutcomeはalready_memberを「成功と同様に扱ってよい」と
// 判定する。詳細はpendingInviteCode.js・supabase/schema.sql参照）。
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

// 会社切替失敗時の、固定・安全なユーザー向けエラーメッセージ表示（Commit 5）。
// CompanySelectionGate・CompanyHeaderIndicatorの両方（headerActions経由）から
// 共通で使う、これ以上分解しない最小のメッセージ表示専用コンポーネント。
// NoMembershipGateの通信エラー表示と同じ.settingsErrorTextクラスを再利用し、
// 新しいCSSは追加しない。messageがnull/未指定の場合は何も描画しない。
export function CompanySwitchErrorMessage({ message }) {
  if (!message) {
    return null;
  }

  return (
    <p className="settingsErrorText" role="alert">
      {message}
    </p>
  );
}

// 2社以上に所属しており、かつlocalStorageに有効な前回会社が無い状態
// （resolveCurrentCompany.js参照）で表示する、明示的な会社選択画面（Commit 4）。
// 独自dropdownは実装せず、標準の<button>を1社ずつ並べる（キーボード操作可能な
// 標準UIを優先する方針。CandidateList（経費タイプ候補の選択）と同じ
// candidateList/candidateCard/candidateSelectButtonクラスを再利用し、新しい
// CSSを増やさない）。選択に成功するとCompanyContextのstatusが
// ready/unpublishedへ遷移し、この画面から自然に抜ける。
// switchError（Commit 5）：この画面での選択が失敗した場合も、通常のBot画面と
// 同じCompanySwitchErrorMessageで表示する。
export function CompanySelectionGate({ companies, isSwitching, switchError, onSelect }) {
  return (
    <main className="appShell">
      <section className="chatPanel botStatusPanel" aria-label="Concur迷子防止Botの質問">
        <h1>会社を選択してください</h1>
        <p>複数の会社に所属しています。利用する会社を選んでください。</p>
        <CompanySwitchErrorMessage message={switchError} />
        <div className="candidateList">
          {companies.map((company) => (
            <div className="candidateCard" key={company.companyCode}>
              <h4 className="candidateName">{company.companyName}</h4>
              <button
                className="candidateSelectButton"
                type="button"
                disabled={isSwitching}
                onClick={() => onSelect(company.companyCode)}
              >
                この会社を利用する
              </button>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

// ヘッダー（BotConversation.jsxのheaderActions）へ表示する、現在利用中会社の
// 表示・切替UI（Commit 4）。
//
// 1社所属の場合：companySelector/companySelectorLabelクラス（既存の
// App.jsx・admin/AdminRoot.jsxの会社セレクタと同じスタイル定義、
// styles.css参照）を再利用しつつ、テキスト表示だけにする（select等は
// 表示しない。不要なdropdownを出さない方針）。
//
// 2社以上の場合：同じくApp.jsx・AdminRoot.jsxと全く同じマークアップ構造
// （label.companySelector > span.companySelectorLabel + span.companySelectWrap
// > select）を再利用した標準の<select>で切替できるようにする。
// option側にはcompanyCode（内部値）、表示テキストにはcompanyName
// （利用者向け名称）を使う。切替処理自体はCompanyContext.selectCompany()へ
// 委譲し、ここではSupabase呼び出しを一切行わない。
export function CompanyHeaderIndicator({ currentCompany, companies, isSwitching, onSelectCompany }) {
  if (companies.length <= 1) {
    return (
      <span className="companySelector">
        <span className="companySelectorLabel">会社：{currentCompany.companyName}</span>
      </span>
    );
  }

  return (
    <label className="companySelector">
      <span className="companySelectorLabel">会社</span>
      <span className="companySelectWrap">
        <select
          aria-label="会社を選択"
          value={currentCompany.companyCode}
          disabled={isSwitching}
          onChange={(event) => onSelectCompany(event.target.value)}
        >
          {companies.map((company) => (
            <option key={company.companyCode} value={company.companyCode}>
              {company.companyName}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

// ログイン済みであることが確定した後（AppAuthGate経由）に表示する、
// 一般利用者Bot画面の本体。
//
// company_codeをユーザーに選ばせたり入力させたりすることは一切無い。
// 所属会社の解決（0件/1件/2件以上・localStorageからの復元）はCompanyContext.jsx
// （実体はresolveCurrentCompany.js）へ集約した。会社セレクタ・?company=・
// 他社一覧はこの画面のどこにも存在しない
// （list_public_companies/?companyのロジックはApp.jsx側にしか無く、
// この画面からは一切importしていない）。
//
// 【複数社所属対応・Commit 2で変更】以前はこのコンポーネント自身がfetchMyMembership()を
// 直接呼んでいたが、CompanyProviderへ委譲した（重複したRPC呼び出し・状態の
// 二重管理を避けるため）。CompanyProviderで画面全体をラップし、実際の描画は
// AuthenticatedBotScreenContentが useCompanyContext() 経由で行う。
export default function AuthenticatedBotScreen({ onSignOut }) {
  return (
    <CompanyProvider>
      <AuthenticatedBotScreenContent onSignOut={onSignOut} />
    </CompanyProvider>
  );
}

function AuthenticatedBotScreenContent({ onSignOut }) {
  const {
    status,
    currentCompany,
    membership,
    companies,
    isSwitching,
    companySwitchError,
    reload,
    selectCompany,
  } = useCompanyContext();

  if (status === "loading") {
    return (
      <main className="appShell">
        <section className="chatPanel botStatusPanel" aria-label="Concur迷子防止Botの質問">
          <p>読み込んでいます…</p>
        </section>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="appShell">
        <section className="chatPanel botStatusPanel" aria-label="Concur迷子防止Botの質問">
          <p>現在、設定を読み込めません。しばらくしてから再度お試しください。</p>
        </section>
      </main>
    );
  }

  if (status === "no-membership") {
    return <NoMembershipGate onJoined={reload} />;
  }

  // 2社以上に所属しており、かつlocalStorageに有効な前回会社が無い状態
  // （resolveCurrentCompany.js参照）。Commit 4で、所属会社一覧から明示的に
  // 選んでもらう画面（CompanySelectionGate）へ置き換えた。
  if (status === "selection-required") {
    return (
      <CompanySelectionGate
        companies={companies}
        isSwitching={isSwitching}
        switchError={companySwitchError}
        onSelect={selectCompany}
      />
    );
  }

  const isAdmin = currentCompany.role === "admin";

  // 管理画面（#admin）はAdminViewportGateにより1024px未満ではPC利用案内へ
  // 差し替わり編集UIを表示しないため、その導線であるこのリンク自体も
  // スマホ幅では意味を持たない。adminLinkButtonクラスでCSS側から
  // 1024px未満のみ非表示にする（styles.css参照。role='admin'かどうかの
  // 判定自体はここでは変更していない）。
  //
  // 【複数社所属対応・Commit 4で追加、Commit 5でエラー表示を追加】会社表示・
  // 切替（CompanyHeaderIndicator）をheaderActionsの先頭へ追加した。1社所属時は
  // テキスト表示のみ（select無し）、2社以上ではApp.jsx・admin/AdminRoot.jsxと
  // 同じ既存の.companySelector構造を再利用した標準<select>にする（新しい
  // dropdown実装・大規模レイアウト変更は行っていない）。CompanySwitchErrorMessage
  // は、直近の切替が失敗した場合だけ.headerActions内に表示される
  // （.headerActionsはflex-wrapのため、折り返して選択UIの下に表示される）。
  //
  // このheaderActionsはready・unpublishedの両方で全く同じJSXをそのまま使う
  // （複製しない。unpublished状態でも他の所属会社へ切り替えられるようにする
  // ため。詳細は下のunpublishedブロック参照）。
  const headerActions = (
    <>
      <CompanyHeaderIndicator
        currentCompany={currentCompany}
        companies={companies}
        isSwitching={isSwitching}
        onSelectCompany={selectCompany}
      />
      <CompanySwitchErrorMessage message={companySwitchError} />
      {isAdmin && (
        <a className="resetButton adminLinkButton" href="#admin">
          管理画面へ
        </a>
      )}
    </>
  );

  if (status === "unpublished") {
    // 【複数社所属対応・Commit 5で変更】以前はheaderActions（会社切替UI）を
    // 一切表示していなかったが、現在会社がunpublishedでも他の所属会社
    // （公開済みの場合がある）へ切り替えられるようにするため、ready状態と
    // 全く同じheaderActionsをここでも表示する。BotConversation.jsx自身は
    // 使わない（そちらのstatus="unavailable"表示にすると、admin向けの
    // 「管理画面で設定を作成・公開してください」という案内が失われるため）。
    // .headerActionsクラス自体は.appHeaderの外でも単独で使えるutilityクラス
    // （styles.css参照）なので、既存の.appHeaderのタイトル行を複製せずに
    // 済んでいる。
    return (
      <main className="appShell">
        <div className="headerActions">{headerActions}</div>
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
      config={membership.configSnapshot}
      status="ready"
      headerActions={headerActions}
      onSignOut={onSignOut}
      // 領収書OCR（ReceiptOcrPanel.jsx）はSupabase Edge Functionを呼ぶため、
      // ログイン済み（＝ここに到達できている）ユーザーの画面でだけ有効にする。
      // App.jsx（Supabase未設定のローカル開発・公開デモ、ログイン無し）側では
      // このpropを渡していないため既定のfalseのままとなり、OCRの導線自体が
      // 表示されない（実際の認証・権限チェックはEdge Function側が最終防御）。
      enableReceiptOcr
      currentCompanyCode={currentCompany.companyCode}
    />
  );
}
