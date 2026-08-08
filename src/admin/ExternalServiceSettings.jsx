import { useState } from "react";
import { checkConcurOAuthConnection } from "../data/concurOAuthCheckRepository";
import { lookupConcurUserIdentity } from "../data/concurIdentityLookupRepository";

// 「設定」画面の「連携」タブに表示する、外部サービス連携の状態確認セクション。
// 現時点ではConcurの接続確認だけを持つが、見出しは将来の他サービス追加を
// 見込んだ名称にしている（今回はConcur以外のカードを追加しない）。
//
// checkConcurOAuthConnection()の戻り値（result）を、画面表示用の真偽値へ正規化する
// 純粋関数。Edge Function側の戻り値は安全ゲート無効時に{connected:false,
// status:"disabled"}となりhasGeolocation等のキー自体を持たないため、Boolean()で
// 一律false相当に丸める（存在しない値をundefinedのまま表示しない）。
export function formatConcurOAuthCheckResult(result) {
  return {
    connected: Boolean(result?.connected),
    hasGeolocation: Boolean(result?.hasGeolocation),
    expiresInPresent: Boolean(result?.expiresInPresent),
    refreshTokenRotated: Boolean(result?.refreshTokenRotated),
    hasQuickExpenseWriteScope: Boolean(result?.hasQuickExpenseWriteScope),
    hasUserReadScope: Boolean(result?.hasUserReadScope),
    hasIdentityUserIdsReadScope: Boolean(result?.hasIdentityUserIdsReadScope),
    // 【Phase 14で追加】画像付きQuick Expense作成に必要な追加スコープ
    // （領収書画像送信権限）の有無。scopePresentも合わせて保持する理由は
    // resolveConcurReceiptScopeStatus()のコメント参照（「確認できていない」
    // ことと「確認した結果、権限が無い」ことを区別して表示するため）。
    scopePresent: Boolean(result?.scopePresent),
    hasReceiptsWriteScope: Boolean(result?.hasReceiptsWriteScope),
  };
}

// 【Phase 14で追加】「領収書画像送信権限」表示の3値状態を解決する純粋関数。
// evaluateConcurRequiredScopes.js（Edge Function側）の設計上、scope情報自体が
// token応答に無い場合（scopePresent:false）はhasReceiptsWriteScopeも安全側で
// 常にfalseになる。これをそのまま「なし」と表示すると、「確認した結果、
// 権限が無い」のか「まだ確認できていない」のかが利用者に区別できず、
// 実際には権限があるかもしれないのに「なし」と誤解を与えるおそれがある
// （指示：推測で「なし」と断定しない）。そのため、確認できていない場合は
// 専用の"unknown"状態を返す。
export function resolveConcurReceiptScopeStatus(formatted) {
  if (!formatted?.scopePresent) {
    return "unknown";
  }
  return formatted.hasReceiptsWriteScope ? "available" : "unavailable";
}

const RECEIPT_SCOPE_BADGE = {
  available: { className: "settingsStatusBadge active", label: "あり" },
  unavailable: { className: "settingsStatusBadge inactive", label: "なし" },
  unknown: { className: "settingsStatusBadge unknown", label: "確認できません" },
};

// 接続には成功しているが、Quick Expense作成・利用者情報参照・Identity
// 利用者ID参照のいずれかの権限（scope）が不足している場合にtrueを返す
// 純粋関数。未接続の場合は「権限が足りているか」を云々する状況ではないため、
// connected:trueの場合だけ判定する（formatConcurOAuthCheckResult()の
// 戻り値を渡すこと）。
export function shouldShowConcurScopeWarning(formatted) {
  if (!formatted?.connected) {
    return false;
  }
  return !(formatted.hasQuickExpenseWriteScope && formatted.hasUserReadScope && formatted.hasIdentityUserIdsReadScope);
}

// このセクション（外部サービス連携）を表示してよいかどうかの判定。
// フロントから渡されたroleを新たに信用するのではなく、呼び出し元
// （AdminRoot.jsx）がis_platform_admin RPC経由で解決した値をそのまま
// 受け取るだけの単純なゲート。company_admin・一般ユーザーはどちらも
// isPlatformAdmin=falseとして渡されるため、この関数からは区別しない
// （区別はサーバー側のRPC・Edge Function認可で行う）。
export function shouldShowExternalServiceSettings(isPlatformAdmin) {
  return Boolean(isPlatformAdmin);
}

// 二重クリック防止のガード：既に確認中（"checking"）の場合は新たな呼び出しを
// スキップすべきかどうかを判定する純粋関数。
export function shouldSkipConcurOAuthCheck(status) {
  return status === "checking";
}

// lookupConcurUserIdentity()の戻り値（result）を、画面表示用の真偽値へ正規化する
// 純粋関数。Concur利用者の実際のUUID（userID）・氏名・メールアドレス等の
// プロフィールはこの戻り値に一切含まれない（含まれているのはfound・
// hasUserId・multipleMatchesという真偽値だけ）。
export function formatConcurUserIdentityLookupResult(result) {
  return {
    userConfirmed: Boolean(result?.found),
    userIdObtained: Boolean(result?.hasUserId),
  };
}

// 「利用者を確認する」ボタンを無効化すべきかどうかを判定する純粋関数。
// 入力が空欄（trim後）の場合、または既に確認中（二重クリック防止）の場合は
// 無効化する。
export function shouldDisableConcurUserIdentityLookup({ status, userNameInput }) {
  return status === "checking" || String(userNameInput ?? "").trim() === "";
}

// platform_admin専用：Concur OAuth（Refresh Token Grant）の疎通確認を行う
// check-concur-oauth Edge Functionを呼び出すカード。
//
// 表示権限について：フロントから渡されたroleを新たに信用するのではなく、
// 呼び出し元（AdminRoot.jsx）が既存のfetchIsPlatformAdmin()（is_platform_admin
// RPC）で解決した isPlatformAdmin をそのまま受け取るだけで、この
// コンポーネント自身が権限判定ロジックを持つことはない。Edge Function側の
// platform_admin認可（resolveConcurOAuthCheckAuthorization.js）も変更していない
// ため、最終的なセキュリティ境界は引き続きサーバー側（RPC・Edge Function）に
// ある。isPlatformAdminがfalseの場合はセクション自体を描画しない
// （company_admin・一般ユーザーには一切表示されない）。
//
// 【会社別OAuth接続対応で追加】companyCodeは呼び出し元（AdminRoot.jsxの
// AdminWorkspace）が既に保持している、現在管理画面で表示中の会社の
// company_codeをそのまま受け取るだけで、この画面自身が会社を選択・解決する
// ロジックは持たない。checkConcurOAuthConnection()・lookupConcurUserIdentity()
// （どちらもこの会社のConcur OAuth接続を対象に確認する）へそのまま渡す。
export default function ExternalServiceSettings({ isPlatformAdmin = false, companyCode }) {
  const [concurCheckState, setConcurCheckState] = useState({
    status: "idle", // idle | checking | result | error
    result: null,
    errorType: null,
  });
  const [identityLookupUserName, setIdentityLookupUserName] = useState("");
  const [identityLookupState, setIdentityLookupState] = useState({
    status: "idle", // idle | checking | result | error
    result: null,
    errorType: null,
  });

  if (!shouldShowExternalServiceSettings(isPlatformAdmin)) {
    return null;
  }

  async function handleCheckConcurConnection() {
    if (shouldSkipConcurOAuthCheck(concurCheckState.status)) {
      // 二重クリック防止（ボタンのdisabledに加えて、状態でも念のため防ぐ）。
      return;
    }

    setConcurCheckState({ status: "checking", result: null, errorType: null });

    const { result, error } = await checkConcurOAuthConnection(companyCode);

    if (error) {
      // 利用者へは固定エラーコードだけを見せる（Token・Secret・レスポンス本文は
      // 一切表示しない）。詳細な原因調査が必要な場合はコンソールログを参照する。
      console.error("Concur接続確認に失敗しました", error);
      setConcurCheckState({ status: "error", result: null, errorType: error.type });
      return;
    }

    setConcurCheckState({ status: "result", result, errorType: null });
  }

  async function handleLookupConcurUserIdentity() {
    if (shouldDisableConcurUserIdentityLookup({ status: identityLookupState.status, userNameInput: identityLookupUserName })) {
      // 二重クリック防止・入力空欄防止（ボタンのdisabledに加えて、状態でも念のため防ぐ）。
      return;
    }

    setIdentityLookupState({ status: "checking", result: null, errorType: null });

    const { result, error } = await lookupConcurUserIdentity(identityLookupUserName.trim(), companyCode);

    if (error) {
      // 利用者へは固定エラーコードだけを見せる（Token・Secret・利用者プロフィール・
      // 入力したConcurログインID自体は一切表示しない）。詳細な原因調査が必要な
      // 場合はコンソールログを参照する。
      console.error("Concur利用者確認に失敗しました", error);
      setIdentityLookupState({ status: "error", result: null, errorType: error.type });
      return;
    }

    setIdentityLookupState({ status: "result", result, errorType: null });
  }

  return (
    <div className="settingsPanel externalServiceSettingsPanel">
      <h2 className="settingsExternalServicesHeading">外部サービス連携</h2>

      <div className="settingsCard settingsConcurConnectionSection">
        <h3>Concur</h3>
        <p>
          Concurとの接続状態を確認します。
          <br />
          接続確認を実行すると、Concurの認証サーバーへ通信します。
        </p>
        <p className="settingsHint">この操作はplatform_adminのみ実行できます。</p>

        <button
          type="button"
          className="importConfirmButton"
          disabled={concurCheckState.status === "checking"}
          onClick={handleCheckConcurConnection}
        >
          {concurCheckState.status === "checking" ? "確認中…" : "Concur接続を確認する"}
        </button>

        {concurCheckState.status === "result" && concurCheckState.result && (() => {
          const formatted = formatConcurOAuthCheckResult(concurCheckState.result);
          const receiptScopeBadge = RECEIPT_SCOPE_BADGE[resolveConcurReceiptScopeStatus(formatted)];
          return (
            <>
              <ul className="concurOAuthCheckResultList">
                <li>
                  <span>接続状態</span>
                  <span className={formatted.connected ? "settingsStatusBadge active" : "settingsStatusBadge inactive"}>
                    {formatted.connected ? "接続済み" : "未接続"}
                  </span>
                </li>
                <li>
                  <span>位置情報</span>
                  <span className={formatted.hasGeolocation ? "settingsStatusBadge active" : "settingsStatusBadge inactive"}>
                    {formatted.hasGeolocation ? "あり" : "なし"}
                  </span>
                </li>
                <li>
                  <span>有効期限情報</span>
                  <span className={formatted.expiresInPresent ? "settingsStatusBadge active" : "settingsStatusBadge inactive"}>
                    {formatted.expiresInPresent ? "あり" : "なし"}
                  </span>
                </li>
                <li>
                  <span>Refresh Token更新</span>
                  <span className={formatted.refreshTokenRotated ? "settingsStatusBadge active" : "settingsStatusBadge inactive"}>
                    {formatted.refreshTokenRotated ? "あり" : "なし"}
                  </span>
                </li>
                <li>
                  <span>Quick Expense作成権限</span>
                  <span className={formatted.hasQuickExpenseWriteScope ? "settingsStatusBadge active" : "settingsStatusBadge inactive"}>
                    {formatted.hasQuickExpenseWriteScope ? "あり" : "なし"}
                  </span>
                </li>
                <li>
                  <span>利用者情報参照権限</span>
                  <span className={formatted.hasUserReadScope ? "settingsStatusBadge active" : "settingsStatusBadge inactive"}>
                    {formatted.hasUserReadScope ? "あり" : "なし"}
                  </span>
                </li>
                <li>
                  <span>Identity利用者ID参照権限</span>
                  <span className={formatted.hasIdentityUserIdsReadScope ? "settingsStatusBadge active" : "settingsStatusBadge inactive"}>
                    {formatted.hasIdentityUserIdsReadScope ? "あり" : "なし"}
                  </span>
                </li>
                <li>
                  <span>領収書画像送信権限</span>
                  <span className={receiptScopeBadge.className}>{receiptScopeBadge.label}</span>
                </li>
              </ul>

              {shouldShowConcurScopeWarning(formatted) && (
                <p className="settingsWarningText">
                  接続は成功していますが、API利用に必要な権限が不足しています。
                </p>
              )}
            </>
          );
        })()}

        {concurCheckState.status === "error" && (
          <p className="settingsErrorText">
            エラーコード: {concurCheckState.errorType || "unknown"}
          </p>
        )}

        <div className="settingsConcurIdentityLookupSection">
          <h4>Concur利用者の確認</h4>
          <p>
            指定したConcurログインIDに対応する利用者が、Concur側に登録されているかを確認します。
          </p>
          <p className="settingsHint">
            この操作はplatform_adminのみ実行できます。入力したConcurログインIDや取得結果の実際の値は、
            この画面には表示されません（確認済みかどうかだけを表示します）。
          </p>

          <input
            type="text"
            className="settingsTextInput"
            value={identityLookupUserName}
            onChange={(event) => setIdentityLookupUserName(event.target.value)}
            placeholder="ConcurログインID"
            aria-label="ConcurログインID"
            disabled={identityLookupState.status === "checking"}
          />

          <button
            type="button"
            className="importConfirmButton"
            disabled={shouldDisableConcurUserIdentityLookup({ status: identityLookupState.status, userNameInput: identityLookupUserName })}
            onClick={handleLookupConcurUserIdentity}
          >
            {identityLookupState.status === "checking" ? "確認中…" : "利用者を確認する"}
          </button>

          {identityLookupState.status === "result" && identityLookupState.result && (
            <ul className="concurOAuthCheckResultList">
              {(() => {
                const formatted = formatConcurUserIdentityLookupResult(identityLookupState.result);
                return (
                  <>
                    <li>
                      <span>利用者</span>
                      <span className={formatted.userConfirmed ? "settingsStatusBadge active" : "settingsStatusBadge inactive"}>
                        {formatted.userConfirmed ? "確認済み" : "未確認"}
                      </span>
                    </li>
                    <li>
                      <span>userID</span>
                      <span className={formatted.userIdObtained ? "settingsStatusBadge active" : "settingsStatusBadge inactive"}>
                        {formatted.userIdObtained ? "取得済み" : "未取得"}
                      </span>
                    </li>
                  </>
                );
              })()}
            </ul>
          )}

          {identityLookupState.status === "error" && (
            <p className="settingsErrorText">
              エラーコード: {identityLookupState.errorType || "unknown"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
