import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import InviteCodeForm from "../src/admin/InviteCodeForm.jsx";

// InviteCodeScreen.jsxから切り出したフォーム本体（Commit 7）の静的レンダリングテスト。
// このプロジェクトにはReact Testing Library等が無いため、他のコンポーネント
// テスト（AuthenticatedBotScreenCompanyUI.test.jsx）と同じくrenderToStaticMarkup()で
// 検証する。実際のsubmitハンドラ（redeemInviteCode()呼び出し・エラー分類）は
// membershipRepository.test.js側で検証済みのため、ここでは静的な構造だけを見る。
describe("InviteCodeForm（Commit 7でInviteCodeScreen.jsxから切り出した共通フォーム）", () => {
  it("既定状態(idle)では、招待コード入力欄と送信ボタンだけを表示する", () => {
    const html = renderToStaticMarkup(<InviteCodeForm onJoined={() => {}} />);

    expect(html).toContain("<form");
    expect(html).toContain("招待コード");
    expect(html).toContain('type="text"');
    expect(html).toContain("参加する");
    expect(html).not.toMatch(/role="alert"/);
  });

  it("submitLabelを指定すると、送信ボタンの文言を差し替えられる", () => {
    const html = renderToStaticMarkup(<InviteCodeForm onJoined={() => {}} submitLabel="今すぐ参加" />);

    expect(html).toContain("今すぐ参加");
  });

  it("initialErrorMessageを指定すると、最初からエラーメッセージを表示する（自動参加失敗の引き継ぎ用）", () => {
    const html = renderToStaticMarkup(
      <InviteCodeForm onJoined={() => {}} initialErrorMessage="招待コードが正しくありません。会社の管理者にご確認ください。" />,
    );

    expect(html).toContain("招待コードが正しくありません。会社の管理者にご確認ください。");
    expect(html).toMatch(/role="alert"/);
  });

  it("招待コード実値をHTML中に含めない（未入力時、valueは空）", () => {
    const html = renderToStaticMarkup(<InviteCodeForm onJoined={() => {}} />);
    expect(html).toMatch(/<input[^>]*value=""/);
  });
});
