import { useState } from "react";
import { checkConcurOAuthConnection } from "../data/concurOAuthCheckRepository";

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
      </div>
    </div>
  );
}
