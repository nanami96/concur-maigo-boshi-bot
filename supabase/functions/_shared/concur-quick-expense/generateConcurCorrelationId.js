// Quick Expense v4公式ドキュメント（api-reference/expense/quick-expense/
// v4.quick-expense.md）のconcur-correlationidヘッダー用に、リクエストごとに
// 新しいUUIDを生成するだけの関数。
//
// 【根拠（公式ドキュメントのみ）】
// リクエスト・レスポンスのHeaders節、両方に同一の記載がある：
//   "concur-correlationid ... is a [Concur / SAP Concur] specific custom
//   header used for technical support in the form of a RFC 4122 A
//   Universally Unique IDentifier (UUID) URN Namespace"
// "Required"の指定は無い（任意ヘッダー）ため、呼び出し元が独自の値を
// 渡さなかった場合は、この関数でリクエストごとに新しいUUIDを生成する
// （呼び出し元は明示的にcorrelationIdを渡すことで上書きもできる。
// buildConcurQuickExpenseRequest.js参照）。
//
// 【安全性について】ここで生成する値は技術サポート用の相関ID（単なる
// ランダムなUUID）であり、userID・経費内容・Access Token・Refresh Token・
// Client Secret等の機密情報・業務データは一切含まない。Authorization等の
// 機密情報と結合・合成することもない。
//
// crypto.randomUUID()はDeno（Edge Function実行環境）・Node（vitest実行
// 環境）双方のグローバルAPIで、外部通信を一切伴わない。
export function generateConcurCorrelationId() {
  return crypto.randomUUID();
}
