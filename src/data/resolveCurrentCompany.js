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
// companiesの中にcompanyCodeが実在するかを確認したうえで、その会社の公開config
// （get_my_public_config(p_company_code)相当）を取得する共通処理。起動時の
// 自動解決（resolveCurrentCompany）と、利用者による明示的な会社切替
// （selectCompany）の両方から使う。
//
// companiesに存在しないcompanyCodeを渡した場合はfail-closedにする
// （outcome: "not-a-member"）。クライアント側のcompanies一覧に存在しない
// companyCodeが渡ってくること自体、通常のUI操作では起こり得ないが、万一
// 不正な値が渡された場合でも、ここで早期に弾き、get_my_public_config()すら
// 呼ばない。ただしここでの検証はあくまで早期防御であり、最終防衛線は
// Commit 1で実装済みのバックエンド側の所属照合（get_my_public_config内の
// company_members照合）である（フロント側の一覧だけを信用した設計にはしない）。
async function resolveCompanyByCode({ companies, companyCode, fetchMembership }) {
  const matched = companies.find((company) => company.companyCode === companyCode);
  if (!matched) {
    return { outcome: "not-a-member", currentCompany: null, membership: null };
  }

  const { membership, error } = await fetchMembership(companyCode);

  if (error) {
    return { outcome: "error", currentCompany: null, membership: null };
  }

  if (!membership) {
    // 一覧には存在したのに、config取得時には見つからない（呼び出しの間に
    // 削除される等、極めて稀な競合）。matchedをそのまま確定させず、
    // 呼び出し元にnot-a-memberとして扱わせる（安全側）。
    return { outcome: "not-a-member", currentCompany: null, membership: null };
  }

  return { outcome: "ok", currentCompany: matched, membership };
}

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

  if (companies.length === 1) {
    const resolved = await resolveCompanyByCode({ companies, companyCode: companies[0].companyCode, fetchMembership });
    if (resolved.outcome !== "ok") {
      return { status: "error", currentCompany: null, membership: null, companies };
    }
    return {
      status: resolved.membership.configSnapshot ? "ready" : "unpublished",
      currentCompany: resolved.currentCompany,
      membership: resolved.membership,
      companies,
    };
  }

  const lastCompanyCode = readLastCompanyCode();
  if (!lastCompanyCode) {
    return { status: "selection-required", currentCompany: null, membership: null, companies };
  }

  if (!companies.some((company) => company.companyCode === lastCompanyCode)) {
    clearLastCompanyCode();
    return { status: "selection-required", currentCompany: null, membership: null, companies };
  }

  const resolved = await resolveCompanyByCode({ companies, companyCode: lastCompanyCode, fetchMembership });

  if (resolved.outcome !== "ok") {
    return { status: "error", currentCompany: null, membership: null, companies };
  }

  return {
    status: resolved.membership.configSnapshot ? "ready" : "unpublished",
    currentCompany: resolved.currentCompany,
    membership: resolved.membership,
    companies,
  };
}

// 利用者が明示的に会社を切り替えたときに呼ぶ（Commit 4）。resolveCurrentCompanyと
// 同じresolveCompanyByCodeを共有し、「companiesに実在するcompanyCodeだけを
// 受け付け、その会社のconfigが実際に取得できた場合だけ切替を確定する」という
// 検証を、起動時の自動解決と全く同じロジックで行う。
//
// atomicな切替のため、呼び出し元（CompanyContext.jsx）は戻り値のstatusが
// "ready"/"unpublished"の場合だけcurrentCompany/membershipを更新すること。
// "rejected"（companiesに存在しない・既に所属していない）・"error"
// （通信エラー等）の場合は、呼び出し元は現在のcurrentCompany/membershipを
// 一切変更してはならない（A社選択中にB社への切替に失敗しても、A社の状態を
// 維持する）。lastCompanyCodeの保存も、呼び出し元が"ready"/"unpublished"を
// 確認してから行う（失敗した切替でlastCompanyCodeを書き換えない）。
export async function selectCompany({ companyCode, companies, fetchMembership }) {
  const resolved = await resolveCompanyByCode({ companies, companyCode, fetchMembership });

  if (resolved.outcome === "not-a-member") {
    return { status: "rejected", currentCompany: null, membership: null };
  }

  if (resolved.outcome === "error") {
    return { status: "error", currentCompany: null, membership: null };
  }

  return {
    status: resolved.membership.configSnapshot ? "ready" : "unpublished",
    currentCompany: resolved.currentCompany,
    membership: resolved.membership,
  };
}

// selectCompany()の失敗時（Commit 5）に利用者へ表示する、固定・安全な文言。
// get_my_public_config()の生エラー・companyCode・会社の内部情報等は一切含めない
// （この定数の文字列だけを表示する）。CompanyContext.jsxが直接この文字列を
// 複製しないよう、resolveCompanySwitchError()経由でだけ使う。
export const COMPANY_SWITCH_ERROR_MESSAGE = "会社の切り替えに失敗しました。時間をおいてもう一度お試しください。";

// selectCompany()の戻り値のstatusから、companySwitchErrorとして表示すべき文言を
// 決定する純粋関数（Reactに依存しない。CompanyContext.jsxから使う）。
// "ready"/"unpublished"（切替成功）ならnull（エラー無し）、それ以外
// （"rejected"/"error"）なら固定メッセージを返す。
export function resolveCompanySwitchError(status) {
  if (status === "ready" || status === "unpublished") {
    return null;
  }
  return COMPANY_SWITCH_ERROR_MESSAGE;
}
