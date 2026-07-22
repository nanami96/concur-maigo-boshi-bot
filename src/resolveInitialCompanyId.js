// URLクエリ（例: ?company=sample-company）から初期表示する会社を決める純粋関数。
// 将来的にログインID・SSO属性等から会社を自動判別する際も、この関数の
// 入力を差し替えるだけで対応できるようにしてある。
//
// 会社一覧はSupabase側で動的に増減する（会社を登録・公開するだけで増える）ため、
// 「静的な既知一覧に実在するIDのみ受け付ける」という以前の検証方式は使えない。
// 代わりに、company_codeとして妥当な"形"（小文字英数字とハイフンのみ）かどうかだけを
// 検証し、実際にその会社が存在し公開されているかどうかの判定は行わない
// （その判定は、この後に呼ばれるget_public_config側に一任する）。
//
// これは危険な設計ではない：companyIdの唯一の使い道は
//   ・get_public_config(company_code) / getConfig(companyId) の検索キー
//   ・<select>のvalue・表示用ラベルの選択（Reactが自動エスケープするため安全）
// のみであり、SQLインジェクションやパストラバーサルのような危険な使われ方を
// しない。get_public_config自身が「存在しない・未公開の会社コード」を安全に
// 「該当なし」として扱う設計になっているため、ここでは形式チェックだけに留め、
// 存在確認のための追加のネットワーク往復（一覧取得→検証→設定取得、の3段階）を
// 発生させない（Bot起動を速くし、実装もシンプルに保つ）。
const COMPANY_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function resolveInitialCompanyId({ search, defaultCompanyId }) {
  const params = new URLSearchParams(search || "");
  const fromQuery = params.get("company");

  if (fromQuery && COMPANY_CODE_PATTERN.test(fromQuery)) {
    return fromQuery;
  }

  return defaultCompanyId;
}
