import { useState } from "react";
import { savePendingInviteCode } from "../data/pendingInviteCode";

// 新規一般ユーザー向け、未ログイン時点で最初に表示する「会社へ参加」画面。
//
// この時点ではまだ未認証のため、company_membersへ直接登録することは一切しない
// （redeem_invite_code() RPCはauthenticatedのみ実行可能）。「次へ」を押した時点で
// 入力値をクライアント側に一時保持し(pendingInviteCode.js参照)、この後の
// アカウント作成→メール確認完了後に自動的にredeem_invite_code()へ渡す
// （AuthenticatedBotScreen.jsx参照）。
//
// ここでの検証は「空でない・極端に長くない」程度の形式チェックのみに留める。
// 匿名ユーザーへ「このコードは有効/無効」「この会社が存在する」といった情報を
// 一切返さない（会社名・会社の存在を匿名ユーザーが列挙・推測できる経路を作らないため。
// 実際の正当性検証は認証後のredeem_invite_code()側でのみ行う）。
export default function InviteCodeEntryScreen({ onNext, onSwitchToLogin }) {
  const [code, setCode] = useState("");
  const [errorMessage, setErrorMessage] = useState(null);

  function handleSubmit(event) {
    event.preventDefault();
    const trimmed = code.trim();

    if (!trimmed) {
      return;
    }

    if (trimmed.length > 200) {
      // 実際の招待コードはハッシュ由来の短い16進文字列のため、通常はここに
      // 到達しない。極端に長い入力だけを形式エラーとして弾く（それ以外の
      // 妥当性はここでは判断しない）。
      setErrorMessage("招待コードの形式が正しくありません。");
      return;
    }

    setErrorMessage(null);
    savePendingInviteCode(trimmed);
    onNext(trimmed);
  }

  return (
    <main className="appShell adminShell">
      <div className="authScreen">
        <h1>会社へ参加</h1>
        <p className="authScreenLead">会社の担当者から案内された招待コードを入力してください。</p>

        <form onSubmit={handleSubmit} className="authForm">
          <label className="flowFieldLabel">
            招待コード
            <input
              type="text"
              className="settingsTextInput"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="会社から案内されたコード"
              required
              autoComplete="off"
            />
          </label>

          {errorMessage && <p className="settingsErrorText">{errorMessage}</p>}

          <button type="submit" className="importConfirmButton" disabled={!code.trim()}>
            次へ
          </button>
        </form>

        <button type="button" className="authModeSwitchLink" onClick={onSwitchToLogin}>
          すでにアカウントをお持ちの方はログイン
        </button>
      </div>
    </main>
  );
}
