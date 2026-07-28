// Concur登録前確認（src/ConcurRegistrationPanel.jsx）のために、既存の
// config（config.json互換形式、BotConversation.jsxのconfigプロパティと同じ
// もの）から、Concur関連の設定値だけを安全に取り出すための純粋関数群。
//
// 現時点では、config.json/config_snapshotのどちらの生成経路
// （scripts/generate-config.js・src/flow/buildConfigFromFlow.js）も
// Concur関連のフィールドを一切書き込まない（このファイルを追加した時点では
// 両方とも変更していない）。そのため、実際に運用中のどの会社の設定にも
// 今のところ`config.concur`は存在せず、下記の関数は常に「未設定」側の
// 安全な既定値（空配列・"JPY"）を返す。これにより、既存会社の設定・
// 既存の動作は一切変わらない。
//
// マッピングデータの実際の保存場所（Supabaseテーブル・管理画面UI等）は
// まだ決まっていない（Concur側の接続方式・認証確認待ち）。ここでは
// 「config経由で渡された場合はそれを使う」という取り出し口だけを用意し、
// 本番のExcel取り込み・buildConfigFromFlow.js・管理画面には一切手を加えない
// （要件：本番Expense Type Codeを追加しない・Supabaseテーブルを新設しない）。

/**
 * config.concur.expenseTypeMappingsを取り出す。存在しない・配列でない場合は
 * 空配列を返す（mapBotExpenseTypeToConcur()は空配列を渡されると
 * "company_unknown"として扱い、これまで通りConcurRegistrationPanel.jsxが
 * 何も表示しない状態になるだけで、既存の判定結果表示には一切影響しない）。
 *
 * @param {object|null|undefined} config
 * @returns {Array<{ companyId: string, policyId: string, botExpenseTypeId: string, concurExpenseTypeId: string }>}
 */
export function resolveConcurExpenseTypeMappings(config) {
  const mappings = config?.concur?.expenseTypeMappings;
  return Array.isArray(mappings) ? mappings : [];
}

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
