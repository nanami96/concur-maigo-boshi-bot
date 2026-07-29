// Concur登録前確認（src/ConcurRegistrationPanel.jsx）のために、既存の
// config（config.json互換形式、BotConversation.jsxのconfigプロパティと同じ
// もの）から、Concur関連の設定値だけを安全に取り出すための純粋関数群。
//
// 経費タイプID＝Concur EXP_KEYという設計（正式リファクタリング）により、
// 以前ここにあったresolveConcurExpenseTypeMappings()（config.concur.
// expenseTypeMappingsという独立したマッピング表を取り出す関数）は不要になった。
// 判定された経費タイプのid（result.expenseType.id）をそのままConcur側の
// 識別子として使うため、Bot経費タイプID→Concur識別子の変換テーブル自体が
// 存在しない。

// 既存のconfig.json/config_snapshot・supabase/schema.sqlを確認したが、
// 会社ごとのデフォルト通貨という概念はどこにも存在しない（調査済み）。
// 「既存のデフォルト通貨があれば優先する」という要件に該当する既存項目が
// 無いため、ここでは新しいconfigフィールドを勝手に作らず、常に"JPY"を返す
// （念のためconfigを引数として受け取る関数の形にしておき、将来こうした
// 項目が実際に追加された場合はこの関数の中だけを差し替えれば済むように
// している）。
export function resolveDefaultCurrencyCode(config) {
  void config;
  return "JPY";
}
