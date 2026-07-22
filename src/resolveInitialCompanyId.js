// URLクエリ（例: ?company=sample-company）から初期表示する会社を決める純粋関数。
// 将来的にログインID・SSO属性等から会社を自動判別する際も、この関数の
// 入力を差し替えるだけで対応できるようにしてある。
//
// 不正な値（存在しない会社コード）が渡された場合は、既存の挙動通り
// defaultCompanyIdへフォールバックする（URLを弄って任意の文字列を
// company_idとして送り込めないようにするため、availableCompaniesに
// 実在するIDのみ受け付ける）。
export function resolveInitialCompanyId({ search, availableCompanies, defaultCompanyId }) {
  const params = new URLSearchParams(search || "");
  const fromQuery = params.get("company");

  if (fromQuery && availableCompanies.some((company) => company.id === fromQuery)) {
    return fromQuery;
  }

  return defaultCompanyId;
}
