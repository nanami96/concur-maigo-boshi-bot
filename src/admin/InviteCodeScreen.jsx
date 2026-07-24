import { useState } from "react";
import { redeemInviteCode } from "../data/membershipRepository";
import { resolveMembershipErrorMessage } from "./membershipErrorMessages";
import AuthLogo from "./AuthLogo";

// ログイン済みだがまだどの会社にも所属していないユーザー向けの初回セットアップ画面。
//
// 一般ユーザーが既存の会社を自由に選んで所属できてしまうと他社への不正所属に
// つながるため、会社ごとに発行された招待コード（companies.invite_code_hash、
// SHA-256ハッシュで保管）を入力させ、redeem_invite_code() RPC側でのみ検証する。
// roleは常にRPC内で'user'固定になり、このコンポーネントから管理者権限を
// 要求する経路は無い。
//
// initialErrorMessageは、AuthenticatedBotScreen.jsxの自動参加処理（未ログイン時に
// 入力された招待コードを、メール確認完了後に自動でredeemする処理）が失敗した場合に、
// その理由をこの画面へ引き継いで最初から表示するためのオプション引数。
// 通常の（この画面へ直接遷移してくる）ケースでは指定されず、従来通りidle状態から始まる。
export default function InviteCodeScreen({ onJoined, initialErrorMessage = null }) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState(initialErrorMessage ? "error" : "idle"); // idle | submitting | error
  const [errorMessage, setErrorMessage] = useState(initialErrorMessage);

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmed = code.trim();

    if (!trimmed) {
      return;
    }

    setStatus("submitting");
    setErrorMessage(null);

    const { company, error } = await redeemInviteCode(trimmed);

    if (error) {
      // 利用者へは定型の日本語メッセージだけを見せ、実際のエラー内容
      // （SQLの詳細・種別）はコンソールにのみ残す（開発時の原因特定用）。
      console.error("招待コードの参加処理に失敗しました", error);
      setStatus("error");
      setErrorMessage(resolveMembershipErrorMessage(error.type));
      return;
    }

    setStatus("idle");
    onJoined?.(company);
  }

  return (
    <main className="appShell">
      <div className="authScreen">
        <AuthLogo />
        <h1>会社への参加</h1>
        <p>
          まだどの会社にも登録されていません。会社の担当者から案内された招待コードを
          入力してください。
        </p>

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

          {status === "error" && <p className="settingsErrorText">{errorMessage}</p>}

          <button
            type="submit"
            className="importConfirmButton"
            disabled={status === "submitting" || !code.trim()}
          >
            {status === "submitting" ? "確認中…" : "参加する"}
          </button>
        </form>
      </div>
    </main>
  );
}
