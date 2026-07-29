import { useEffect, useRef, useState } from "react";
import copyIcon from "../assets/copy-icon.png";

// 招待コード表示用のボックス＋コピー機能。CreatePlatformCompanyScreen.jsx
// （会社作成完了画面）・UserManagementPanel.jsx（招待コード再発行）の両方から
// 共有する。招待コードは平文でこの画面にしか表示されない（DBにはハッシュのみ
// 保存される）という既存仕様のUI表現を担うだけで、このコンポーネント自体は
// コピー処理以外の副作用を持たない。
const FEEDBACK_DURATION_MS = 2000;

// トースト（成功／失敗）のアイコンは、コピーボタンの画像アイコンとは別クラス
// （.inviteCodeToastIcon）にする。同じ.inviteCodeCopyIconのままだと、ボタン用に
// サイズ変更した際にトースト側の見た目まで意図せず変わってしまうため。
function CheckIcon() {
  return (
    <svg
      className="inviteCodeToastIcon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      focusable="false"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      className="inviteCodeToastIcon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      focusable="false"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
      />
    </svg>
  );
}

// navigator.clipboard.writeText()を呼ぶだけの薄いラッパー。DOM描画テスト基盤が
// このプロジェクトに無いため、コピー成功／失敗の分岐だけでもテストできるよう
// コンポーネントから切り出している（clipboard APIが無い環境・権限拒否等、
// writeText自体が例外を投げる場合も含めて安全にfalseを返す）。
export async function copyInviteCodeToClipboard(code) {
  try {
    if (!navigator.clipboard?.writeText) {
      return { success: false };
    }
    await navigator.clipboard.writeText(code);
    return { success: true };
  } catch {
    return { success: false };
  }
}

export default function InviteCodeBox({ code }) {
  const [feedback, setFeedback] = useState(null); // null | "success" | "error"
  const timerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  async function handleCopy() {
    const { success } = await copyInviteCodeToClipboard(code);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    setFeedback(success ? "success" : "error");
    timerRef.current = setTimeout(() => setFeedback(null), FEEDBACK_DURATION_MS);
  }

  return (
    <div className="inviteCodeWrap">
      <div className="inviteCodeBox">
        <span className="inviteCodeValue">{code}</span>
        <button type="button" className="inviteCodeCopyButton" onClick={handleCopy}>
          <img src={copyIcon} alt="" aria-hidden="true" className="inviteCodeCopyIcon" />
          コピー
        </button>
      </div>

      {feedback === "success" && (
        <div className="inviteCodeToast success" role="status">
          <CheckIcon />
          招待コードをコピーしました
        </div>
      )}
      {feedback === "error" && (
        <div className="inviteCodeToast error" role="alert">
          <ErrorIcon />
          コピーに失敗しました
        </div>
      )}
    </div>
  );
}
