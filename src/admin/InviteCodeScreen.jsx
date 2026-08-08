import InviteCodeForm from "./InviteCodeForm";
import AuthLogo from "./AuthLogo";

// ログイン済みだがまだどの会社にも所属していないユーザー向けの初回セットアップ画面。
//
// 一般ユーザーが既存の会社を自由に選んで所属できてしまうと他社への不正所属に
// つながるため、会社ごとに発行された招待コード（companies.invite_code_hash、
// SHA-256ハッシュで保管）を入力させ、redeem_invite_code() RPC側でのみ検証する。
// roleは常にRPC内で'user'固定になり、このコンポーネントから管理者権限を
// 要求する経路は無い。
//
// 【複数社所属対応・Commit 7で変更】実際のフォーム・redeemInviteCode()呼び出しは
// InviteCodeForm.jsx（このコミットで切り出し）に委譲し、ここでは0社ユーザー向け
// 画面の枠（ロゴ・見出し・案内文）だけを担う。1社以上所属済みのユーザーが
// 別会社へ追加で参加する導線（AuthenticatedBotScreen.jsxのJoinAnotherCompanyPanel）も
// 同じInviteCodeFormを使い、フォームを複製しない。
//
// initialErrorMessageは、AuthenticatedBotScreen.jsxの自動参加処理（未ログイン時に
// 入力された招待コードを、メール確認完了後に自動でredeemする処理）が失敗した場合に、
// その理由をこの画面へ引き継いで最初から表示するためのオプション引数。
// 通常の（この画面へ直接遷移してくる）ケースでは指定されず、従来通りidle状態から始まる。
export default function InviteCodeScreen({ onJoined, initialErrorMessage = null }) {
  return (
    <main className="appShell">
      <div className="authScreen">
        <AuthLogo />
        <h1>会社への参加</h1>
        <p>
          まだどの会社にも登録されていません。会社の担当者から案内された招待コードを
          入力してください。
        </p>

        <InviteCodeForm onJoined={onJoined} initialErrorMessage={initialErrorMessage} />
      </div>
    </main>
  );
}
