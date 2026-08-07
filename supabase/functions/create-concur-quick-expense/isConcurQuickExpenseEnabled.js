// 【安全ゲート】Quick Expense連携全体（Vaultリース取得〜OAuth Refresh Token
// Grant〜complete_concur_oauth_refresh〜Identity v4検索〜Quick Expense API
// 本体）を、単一のSecretでまとめて止められるようにするための判定。
//
// check-concur-oauthのCONCUR_OAUTH_CHECK_ENABLED・lookup-concur-userの
// CONCUR_IDENTITY_LOOKUP_ENABLEDとは別の、このFunction専用のフラグを使う
// （同じフラグを使い回さない。isConcurIdentityLookupEnabled.jsと同じ理由：
// 意味の異なる安全ゲートを混同しないため）。
//
// 判定はhandleQuickExpenseRequest.js側だけで行い、index.tsはこのSecretの
// 値をenvへ転記するだけで、判断ロジックを一切持たない（index.tsを
// Deno固有のI/Oだけに保つ既存方針。supabase/functions/create-concur-quick-expense/
// index.ts冒頭コメント参照）。
//
// 未設定・"false"・大文字小文字違い（"TRUE"等）・真偽値true（文字列でない）・
// その他の文字列は全て「無効」として扱う（安全側デフォルト。
// isConcurOAuthCheckEnabled.js・isConcurIdentityLookupEnabled.jsと同じ判定方式）。
export function isConcurQuickExpenseEnabled(env) {
  return env?.CONCUR_QUICK_EXPENSE_ENABLED === "true";
}
