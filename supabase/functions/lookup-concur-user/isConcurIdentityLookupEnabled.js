// 【安全ゲート】check-concur-oauthのCONCUR_OAUTH_CHECK_ENABLEDとは別の、
// このFunction専用のフラグを使う（同じフラグを使い回さない）。
//
// 理由：CONCUR_OAUTH_CHECK_ENABLEDは「OAuth疎通確認（Refresh Token
// ローテーションの保存を含む）」の安全ゲートとして既に運用されている。
// 一方このFunctionは、OAuth疎通確認に加えてConcur Identity APIへの実通信
// （利用者検索）まで行う、より広い範囲の実通信を許可するスイッチである
// ため、意味を混同しないよう独立したSecret名にする。今回のセッションでは
// Secrets登録を行わないため、CONCUR_IDENTITY_LOOKUP_ENABLEDは未設定
// （＝無効）のままになる。
//
// 未設定・"false"・大文字小文字違い（"TRUE"等）・真偽値true（文字列でない）は
// 全て「無効」として扱う（安全側デフォルト。isConcurOAuthCheckEnabled.jsと
// 同じ判定方式）。
export function isConcurIdentityLookupEnabled(env) {
  return env?.CONCUR_IDENTITY_LOOKUP_ENABLED === "true";
}
