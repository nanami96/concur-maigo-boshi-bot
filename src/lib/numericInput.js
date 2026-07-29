// 金額入力欄で、確定前に数字（0-9）以外の文字を取り除くための共通処理。
// type="number"のinput要素は環境によって"e"・"+"・"-"・"."等の入力を許して
// しまう（特にキーボード直接入力時、ブラウザによって挙動が異なる）ため、
// type="text"へ変更したうえでonChange時にこの関数で明示的に数字だけへ
// 絞り込む（src/ReceiptOcrPanel.jsx・src/ManualExpenseEntryPanel.jsxの
// 金額欄で共通利用。ロジックを2箇所に別々実装しないため、ここへ集約する）。
export function sanitizeDigitsOnly(value) {
  return String(value ?? "").replace(/[^0-9]/g, "");
}
