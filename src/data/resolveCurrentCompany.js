// 複数社所属時、起動時にどの会社を「現在選択中会社(currentCompany)」とし、
// その会社の公開設定をどう取得するかを決定する純粋ロジック。Reactから
// 切り離してテストできるようにする（pendingInviteCode.jsのresolveAutoRedeemOutcome・
// autoRedeemPendingInvite.jsのcreateAutoRedeemPendingInviteと同じ方針）。
// fetchCompanies・fetchMembership・readLastCompanyCode・clearLastCompanyCodeは
// 全てDIで受け取り、Supabase・localStorageへ直接依存しない。
//
// 【複数社所属対応・Commit 3で変更】Commit 2ではget_my_public_config()自体の
// fail-closedな例外（fetchMyMembership()のambiguous:trueフラグ）を頼りに
// 「2件以上か」を判定していたが、Commit 3でlist_my_companies() RPC（本人の
// 所属会社一覧だけを返す、責務が分離された専用RPC。supabase/schema.sql参照）が
// 追加されたため、そちらを使う設計へ整理した。fetchMyMembership()自体の
// ambiguous検出ロジックはRPCの契約として引き続き正しい（防御的に残している）が、
// このモジュールはもう「会社が何件あるか」をambiguous例外経由では判定しない。
//
// 2段階のパイプラインに分離する（責務を混ぜない。get_my_public_config()と
// list_my_companies()の責務を混ぜないようにという要件のため）：
//   1. fetchCompanies() … 所属会社一覧の取得・どの会社をcurrentCompanyにするかの
//      決定だけを行う（0件/1件/2件以上・localStorageからの復元）。config
//      （公開設定）の取得は一切行わない。
//   2. fetchMembership(companyCode) … 1.でcurrentCompanyが確定した場合だけ、
//      その会社の公開config（get_my_public_config(p_company_code)相当）を
//      取得する。currentCompanyが確定していない状態（no-membership・
//      selection-required・error）では絶対に呼ばない。
//
// 決定ロジック（1.）：
//   0件    → "no-membership"（利用不可状態。既存のNoMembershipGateへ）
//   1件    → その1件をそのままcurrentCompanyにする（自動選択。既存の
//            1社利用者との後方互換）
//   2件以上 → localStorageにlastCompanyCodeがあり、かつ現在の所属一覧に
//            実際に含まれていれば、それをcurrentCompanyにする（復元成功）。
//            含まれていなければ（退会・削除等で既に所属していない）
//            localStorageを破棄し、"selection-required"にする。
//            lastCompanyCodeが無ければ、一覧の先頭（companies[0]）を
//            機械的に選ぶことは絶対に行わない。"selection-required"として
//            扱う（fail-closed）。実際に会社を選ばせるUIはCommit 4以降で
//            追加する。
export async function resolveCurrentCompany({
  fetchCompanies,
  fetchMembership,
  readLastCompanyCode,
  clearLastCompanyCode,
}) {
  const { companies, error: companiesError } = await fetchCompanies();

  if (companiesError) {
    return { status: "error", currentCompany: null, membership: null, companies: [] };
  }

  if (companies.length === 0) {
    return { status: "no-membership", currentCompany: null, membership: null, companies };
  }

  let currentCompany;

  if (companies.length === 1) {
    currentCompany = companies[0];
  } else {
    const lastCompanyCode = readLastCompanyCode();
    if (!lastCompanyCode) {
      return { status: "selection-required", currentCompany: null, membership: null, companies };
    }

    const matched = companies.find((company) => company.companyCode === lastCompanyCode);
    if (!matched) {
      clearLastCompanyCode();
      return { status: "selection-required", currentCompany: null, membership: null, companies };
    }

    currentCompany = matched;
  }

  const { membership, error: membershipError } = await fetchMembership(currentCompany.companyCode);

  if (membershipError) {
    return { status: "error", currentCompany: null, membership: null, companies };
  }

  if (!membership) {
    // list_my_companies()では所属していたはずなのに、get_my_public_config()側では
    // 見つからない（呼び出しの間に削除される等、極めて稀な競合が起きた場合の
    // 防御）。currentCompanyを確定させたまま矛盾したconfigを使うより、
    // 安全側（error）に倒し、再読み込みで解決させる。
    return { status: "error", currentCompany: null, membership: null, companies };
  }

  return {
    status: membership.configSnapshot ? "ready" : "unpublished",
    currentCompany,
    membership,
    companies,
  };
}
