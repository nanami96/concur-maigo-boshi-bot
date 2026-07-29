// index.ts（buildAuthAdapters）が get_my_public_config() RPC の戻り値から、
// 認証・所属確認に必要な最小限の情報だけを取り出す部分を切り離した純粋関数。
// Deno/Supabaseクライアントに一切依存しないため、Node/vitestから直接
// テストできる（describeAuthHeaderForLogging.jsと同じ方針）。
//
// なぜ company_members テーブルを直接JOINしてcompany_codeを取らないか
// （設計上の重要な理由）：
//   company_members.company_id は companies.id（Supabase内部UUID）への
//   外部キーであり、company_code（人が識別するためのスラッグ）そのものでは
//   ない。company_codeを得るにはcompaniesテーブルの参照が必要だが、
//   companiesテーブルのRLS（companies_select_admin）は「所属会社のadmin、
//   またはplatform_adminだけ閲覧できる」ため、一般利用者（role='user'。
//   Quick Expense作成は本来この一般利用者が使う機能）のセッションで
//   companiesテーブルを直接SELECTしようとしても0行しか返らず、
//   company_codeを解決できない。
//   一方、既存のget_my_public_config()（Phase 7、SECURITY DEFINER）は
//   まさに「ログイン中ユーザーの所属会社をrole問わず自動判定し、
//   company_codeを含めて返す」ために作られたRPCであり、一般利用者Bot画面
//   （useResolvedBotConfig.js等）が既に本番で使っている。この既存の仕組みを
//   再利用することで、新しいSECURITY DEFINER関数・RLS変更を一切追加せずに
//   company_codeを取得できる。
//
// expenseTypesもここで一緒に取り出す（経費タイプID＝Concur EXP_KEYという
// 設計への正式リファクタリングにより、以前ここで取り出していた
// concurExpenseTypeMappings（Concur Expense Type Mapping、別テーブル）は廃止した）。
//   get_my_public_config()が返すconfig_snapshotは、公開中のBot画面が実際に
//   参照しているものと全く同じ値（=下書きではなく公開済みの設定）であり、
//   config_snapshot.expenseTypesはbuildConfigFromFlow.jsが常に配列として
//   埋め込む。
//   下書き（draft_configs）ではなく公開済み設定を正とする理由：
//     ・一般利用者が実際に見ているBot画面・ConcurRegistrationPanel.jsxは
//       常に公開済み設定だけを反映しており、下書きの内容は一切見えない。
//       送信内容の検証も、利用者が実際に見た内容と同じ基準で行うべきである。
//     ・そもそも一般利用者（role='user'）はdraft_configsをRLS
//       （draft_configs_select_admin）で読めないため、下書きを正にする
//       実装は技術的にも成立しない。
function resolveExpenseTypes(configSnapshot) {
  const expenseTypes = configSnapshot?.expenseTypes;
  return Array.isArray(expenseTypes) ? expenseTypes : [];
}

export function resolveMembershipFromPublicConfigRow(row) {
  if (!row || typeof row.company_code !== "string" || row.company_code.trim() === "") {
    return null;
  }

  return {
    company_code: row.company_code,
    role: row.role ?? null,
    expenseTypes: resolveExpenseTypes(row.config_snapshot),
  };
}
