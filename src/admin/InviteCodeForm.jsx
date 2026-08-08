import { useState } from "react";
import { redeemInviteCode } from "../data/membershipRepository";
import { resolveMembershipErrorMessage } from "./membershipErrorMessages";

// 招待コード入力フォームの本体（Commit 7でInviteCodeScreen.jsxから切り出し）。
//
// 0社ユーザーの初回参加画面（InviteCodeScreen.jsx）と、1社以上所属済みの
// ユーザーが別会社へ追加で参加する導線（AuthenticatedBotScreen.jsxの
// JoinAnotherCompanyPanel）の両方から共通で使う。redeemInviteCode()の呼び出し・
// エラー分類・表示メッセージへの変換はここへ集約し、フォームJSX自体は
// 複製しない（呼び出し元は見出し・説明文等の画面の枠だけを担う）。
//
// このコンポーネント自身は「ユーザーが現在何社に所属しているか」を一切
// 気にしない（redeem_invite_code() RPCが「参加しようとした会社への
// 重複所属」だけを拒否する設計のため、既存の所属数に関わらず全く同じ
// 振る舞いでよい。詳細はsupabase/schema.sqlのredeem_invite_code()参照）。
export default function InviteCodeForm({ onJoined, initialErrorMessage = null, submitLabel = "参加する" }) {
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
      // 招待コードの実値自体はここでも一切ログへ出さない。
      console.error("招待コードの参加処理に失敗しました", error);
      setStatus("error");
      setErrorMessage(resolveMembershipErrorMessage(error.type));
      return;
    }

    setCode("");
    setStatus("idle");
    onJoined?.(company);
  }

  return (
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

      {status === "error" && (
        <p className="settingsErrorText" role="alert">
          {errorMessage}
        </p>
      )}

      <button type="submit" className="importConfirmButton" disabled={status === "submitting" || !code.trim()}>
        {status === "submitting" ? "確認中…" : submitLabel}
      </button>
    </form>
  );
}
