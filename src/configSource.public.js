import sampleCompanyConfig from "../rules/sample-company/config.json";

export const isPublicDemo = true;

// このavailableCompaniesは「本番Botで使える会社の一覧」の正データではない。
// 会社一覧・公開状態の正データはSupabase（companies / published_versions）であり、
// 本番Botの会社セレクタはsrc/usePublicCompanyList.jsがlist_public_companies()
// RPC経由で動的に取得する（会社の追加・公開はSupabase側の操作だけで完結し、
// この配列やReactコードの変更・再デプロイは不要）。
//
// ここに残っているのは、Supabase未設定/取得失敗時の最終フォールバック用途と、
// サンプルデータとしてsample-companyのビルドを保証する用途のみ。会社を追加する
// 目的でこの配列を書き換える必要はない。
export const availableCompanies = [
  {
    id: "sample-company",
    label: sampleCompanyConfig.company?.company_name || "sample-company",
  },
];

// こちらも同様にフォールバック専用。Supabase設定時の実際の設定取得は
// get_public_config RPC（src/data/publicConfigRepository.js）経由で行われ、
// この関数は「Supabase未設定」または「取得失敗」時のみ実際に使われる
// （src/resolveBotConfigSource.js参照）。
export function getConfig(companyId) {
  if (companyId !== "sample-company") {
    return undefined;
  }

  return sampleCompanyConfig;
}
