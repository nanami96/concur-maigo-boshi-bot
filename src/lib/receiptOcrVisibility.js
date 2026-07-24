// 結果画面で「領収書を読み取る」OCR機能（ReceiptOcrPanel.jsx）を
// 表示すべきかどうかの判定。
//
// 経費タイプの領収書要否そのものの判定基準は増やさない。既存の
// BotConversation.jsxのgetReceiptStatus()が「領収書：必要/不要/未設定」の
// バッジ表示に使っているのと全く同じ値（expenseType.receiptRequired）を
// そのまま参照するだけで、新しい独自の要否判定ロジックは一切追加しない。
//
// receiptRequiredがtrue（必要）の場合だけ表示する、という単純な一致条件には
// せず、「false（不要）の場合だけ明示的に隠す」という否定条件にしている理由：
// receiptRequiredがnull/undefined等（未設定・データ不整合）の場合に
// これを「不要」と勝手に見なしてOCR機能を隠してしまうと、本来は領収書が
// 必要かもしれない経費タイプでOCRが使えなくなる方が実害が大きい
// （疑わしいときは隠さない＝安全側に倒す）。
export function shouldShowReceiptOcr({ enableReceiptOcr, receiptRequired }) {
  if (!enableReceiptOcr) {
    return false;
  }
  return receiptRequired !== false;
}
