// 【重要・安全ゲート】現時点では、Concur側から新しいRefresh Tokenが
// 返された場合（ローテーション）の安全な保存先（Supabase Secretsの自動更新・
// DB保存等）が未実装である。保存できないままtoken endpointへ実通信すると、
// ローテーションが発生した際に新しいRefresh Tokenを握りつぶすことになり、
// 古いRefresh Tokenがそのまま設定に残り続けるリスクがある（Concur側の実装
// 次第では、ローテーション後に旧Refresh Tokenが失効し、次回の疎通確認自体が
// 失敗するようになる可能性がある）。
//
// そのため、CONCUR_OAUTH_CHECK_ENABLEDというSecretが明示的に文字列
// "true"である場合だけ、実際にtoken endpointへの通信（refreshConcurAccessToken()
// の呼び出し）を許可する。未設定・"false"・大文字小文字違い（"TRUE"等）・
// 真偽値true（文字列でない）は全て「無効」として扱う（安全側デフォルト）。
// このSecretは今回のコミット時点では登録しない（登録・実通信は別工程）。
export function isConcurOAuthCheckEnabled(env) {
  return env?.CONCUR_OAUTH_CHECK_ENABLED === "true";
}
