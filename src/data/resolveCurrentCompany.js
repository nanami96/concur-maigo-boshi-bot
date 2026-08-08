// 複数社所属時、起動時にどの会社を「現在選択中会社(currentCompany)」とするかを
// 決定する純粋ロジック。Reactから切り離してテストできるようにする
// （pendingInviteCode.jsのresolveAutoRedeemOutcome・autoRedeemPendingInvite.jsの
// createAutoRedeemPendingInviteと同じ方針）。fetchMembership・
// readLastCompanyCode・clearLastCompanyCodeは全てDIで受け取り、
// Supabase・localStorageへ直接依存しない。
//
// 前提：fetchMembership(companyCode?)は、
// supabase/functions（実体はget_my_public_config() RPC。詳細はschema.sql・
// membershipRepository.fetchMyMembership参照）と同じ契約を持つ、すなわち
//   - companyCode未指定・所属0件            → { membership: null, error: null, ambiguous: false }
//   - companyCode未指定・所属1件            → { membership: {...}, error: null, ambiguous: false }
//     （サーバー側で自動解決。既存の1社利用者との後方互換）
//   - companyCode未指定・所属2件以上         → { membership: null, error: null, ambiguous: true }
//     （fail-closed。サーバー側は絶対に先頭行を機械的に選ばない）
//   - companyCode指定・その会社に所属している → { membership: {...}, error: null, ambiguous: false }
//   - companyCode指定・その会社に所属していない → { membership: null, error: null, ambiguous: false }
//
// 決定ロジック：
//   0件（membership:null, ambiguous:false）
//     → "no-membership"（利用不可状態。既存のNoMembershipGateへ）
//   1件（membership非null）
//     → そのままcurrentCompanyにする（自動選択）
//   2件以上（ambiguous:true）
//     → localStorageにlastCompanyCodeがあれば、それを明示指定して再取得する。
//       - 今も所属していれば → 復元成功。currentCompanyにする
//       - 既に所属していない（0行）場合 → localStorageを破棄し、"selection-required"にする
//         （退会後・削除後に古い会社コードが残り続けることを防ぐ）
//     → 無ければ、"先頭の会社"を機械的に選ぶことはしない。
//       会社一覧（company_code・company_name）を取得する手段が、現状
//       admin以外の一般利用者向けクライアントには存在しない
//       （companies テーブルはrole='admin'のみ閲覧可能。list_my_company_members()も
//       対象会社を先に指定する必要がある。詳細はsupabase/schema.sql参照）ため、
//       根拠の無い「先頭会社」を選ぶことは絶対に行わず、"selection-required"として
//       扱う（fail-closed。get_my_public_config()自身の設計方針と同じ）。
//       実際に会社を選ばせるUI・一覧取得の仕組みはCommit 3以降で追加する。
export async function resolveCurrentCompany({ fetchMembership, readLastCompanyCode, clearLastCompanyCode }) {
  const { membership, error, ambiguous } = await fetchMembership();

  if (error) {
    return { status: "error", currentCompany: null, membership: null };
  }

  if (membership) {
    return {
      status: membership.configSnapshot ? "ready" : "unpublished",
      currentCompany: toCurrentCompany(membership),
      membership,
    };
  }

  if (!ambiguous) {
    return { status: "no-membership", currentCompany: null, membership: null };
  }

  const lastCompanyCode = readLastCompanyCode();
  if (!lastCompanyCode) {
    return { status: "selection-required", currentCompany: null, membership: null };
  }

  const retry = await fetchMembership(lastCompanyCode);

  if (retry.error) {
    return { status: "error", currentCompany: null, membership: null };
  }

  if (!retry.membership) {
    clearLastCompanyCode();
    return { status: "selection-required", currentCompany: null, membership: null };
  }

  return {
    status: retry.membership.configSnapshot ? "ready" : "unpublished",
    currentCompany: toCurrentCompany(retry.membership),
    membership: retry.membership,
  };
}

// currentCompanyは「今どの会社を利用しているか」という識別情報だけを持つ
// 軽量なオブジェクトにする（config_snapshot等の設定データそのものは含めない。
// 呼び出し側は必要ならmembership.configSnapshotを別途参照する）。
//
// company.idについて：Supabase内部のUUID（companies.id）はget_my_public_config()
// 自体が返さず、admin以外の一般利用者向けクライアントには渡っていない
// （src/lib/concurRegistrationData.js冒頭コメント参照）。そのため、この
// オブジェクトはUUIDを持たず、companyCodeを一意な識別子として扱う
// （Quick Expense（create-concur-quick-expense）が送るcompanyIdも実体は
// company_codeであり、この設計と矛盾しない）。
function toCurrentCompany(membership) {
  return {
    companyCode: membership.companyCode,
    companyName: membership.companyName,
    role: membership.role,
  };
}
