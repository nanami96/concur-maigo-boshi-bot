import { useState } from "react";
import { createPlatformCompany } from "../data/membershipRepository";
import { resolveMembershipErrorMessage } from "./membershipErrorMessages";

// platform_admin専用の「＋新しい会社を作成」画面。
//
// 会社コード・会社名を入力して作成すると、create_platform_company() RPC
// （schema.sql参照）が会社コードの検証・重複チェック・招待コードの生成・
// ハッシュ化・companiesへのINSERTを1トランザクションで行う。
// 招待コードは平文でこの画面にだけ一度表示され、以後DBから再取得することは
// できない（DBにはSHA-256ハッシュのみ保存される）。「確認しました」を押すまで
// 次へ進めないようにし、コピーし忘れを防ぐ。
export default function CreatePlatformCompanyScreen({ onCreated, onCancel }) {
  const [companyCode, setCompanyCode] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [status, setStatus] = useState("form"); // form | submitting | error | created
  const [errorMessage, setErrorMessage] = useState(null);
  const [createdCompany, setCreatedCompany] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmedCode = companyCode.trim();
    const trimmedName = companyName.trim();

    if (!trimmedCode || !trimmedName) {
      return;
    }

    setStatus("submitting");
    setErrorMessage(null);

    const { company, error } = await createPlatformCompany({
      companyCode: trimmedCode,
      companyName: trimmedName,
    });

    if (error) {
      console.error("会社の作成に失敗しました", error);
      setStatus("error");
      setErrorMessage(resolveMembershipErrorMessage(error.type));
      return;
    }

    setCreatedCompany(company);
    setStatus("created");
  }

  if (status === "created" && createdCompany) {
    return (
      <div className="initialSetupScreen">
        <h2>「{createdCompany.companyName}」を作成しました</h2>
        <p className="settingsErrorText" role="alert">
          以下の招待コードは今この画面でしか表示されません。必ず控えてから、
          会社の担当者へ安全な方法で伝えてください（このコード自体はDBに保存されません）。
        </p>
        <p className="authSentMessage">
          <strong>{createdCompany.inviteCode}</strong>
        </p>
        <button
          type="button"
          className="importConfirmButton"
          onClick={() => onCreated?.(createdCompany)}
        >
          確認しました。設定を進める
        </button>
      </div>
    );
  }

  return (
    <div className="initialSetupScreen">
      <h2>新しい会社を作成</h2>
      <p>会社コード・会社名を入力してください。招待コードは作成後に自動生成されます。</p>

      <form onSubmit={handleSubmit} className="authForm">
        <label className="flowFieldLabel">
          会社コード
          <input
            type="text"
            className="settingsTextInput"
            value={companyCode}
            onChange={(event) => setCompanyCode(event.target.value)}
            placeholder="例：customer-a（小文字英数字とハイフンのみ）"
            required
            autoComplete="off"
          />
        </label>

        <label className="flowFieldLabel">
          会社名
          <input
            type="text"
            className="settingsTextInput"
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            placeholder="例：カスタマー株式会社"
            required
            autoComplete="off"
          />
        </label>

        {status === "error" && <p className="settingsErrorText">{errorMessage}</p>}

        <button
          type="submit"
          className="importConfirmButton"
          disabled={status === "submitting" || !companyCode.trim() || !companyName.trim()}
        >
          {status === "submitting" ? "作成中…" : "作成する"}
        </button>
      </form>

      <button type="button" className="flowGhostButton" onClick={onCancel}>
        キャンセル
      </button>
    </div>
  );
}
