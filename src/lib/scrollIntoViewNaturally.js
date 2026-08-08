// prefers-reduced-motionを尊重しつつ、対象要素が見える位置まで自然にスクロール
// する共通処理。BotConversation.jsx・ReceiptOcrPanel.jsx・
// ConcurRegistrationPanel.jsxなど、会話フロー内でボタン操作により新しい内容が
// 表示されるたびに使う（各所での重複実装を避けるためこのファイルへ集約）。
export function scrollElementIntoViewNaturally(target, block) {
  if (!target) {
    return;
  }

  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  target.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block,
  });
}
