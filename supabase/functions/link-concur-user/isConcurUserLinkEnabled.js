// 【安全ゲート】このFunction専用のフラグ（CONCUR_USER_LINK_ENABLED）を使う
// （既存のCONCUR_QUICK_EXPENSE_ENABLED・CONCUR_OAUTH_CHECK_ENABLED・
// CONCUR_IDENTITY_LOOKUP_ENABLEDとは独立。同じフラグを使い回さない理由は
// isConcurIdentityLookupEnabled.jsと同じ：意味の異なる安全ゲートを混同しない
// ため）。
//
// 未設定・"false"・大文字小文字違い（"TRUE"等）・真偽値true（文字列でない）・
// その他の文字列は全て「無効」として扱う（安全側デフォルト。既存の
// isConcur*Enabled.jsと同じ判定方式）。今回のセッションではSecrets登録を
// 行わないため、CONCUR_USER_LINK_ENABLEDは未設定（＝無効）のままになる。
export function isConcurUserLinkEnabled(env) {
  return env?.CONCUR_USER_LINK_ENABLED === "true";
}
