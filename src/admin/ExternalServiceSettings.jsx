import { useState } from "react";
import { checkConcurOAuthConnection } from "../data/concurOAuthCheckRepository";
import { lookupConcurUserIdentity } from "../data/concurIdentityLookupRepository";

// 「設定」画面の末尾に表示する、外部サービス連携の状態確認セクション。
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
  };
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
export default function ExternalServiceSettings({ isPlatformAdmin = false }) {
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

    const { result, error } = await checkConcurOAuthConnection();

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

    const { result, error } = await lookupConcurUserIdentity(identityLookupUserName.trim());

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

        {concurCheckState.status === "result" && concurCheckState.result && (
          <ul className="concurOAuthCheckResultList">
            {(() => {
              const formatted = formatConcurOAuthCheckResult(concurCheckState.result);
              return (
                <>
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
                </>
              );
            })()}
          </ul>
        )}

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
