import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";

// get_public_config(company_code) を最低限のバリデーション付きで呼ぶ。
// この関数は「認証不要」であることが前提（利用者Bot画面から直接呼ばれる）。
// anonキーだけで呼び出せる想定で、service_role等は一切使わない。
function isValidConfigShape(config) {
  return Boolean(
    config &&
      typeof config === "object" &&
      Array.isArray(config.questions) &&
      Array.isArray(config.rules),
  );
}

// 会社が存在しない場合と、存在するがまだ一度も公開されていない場合は、
// get_public_config側で意図的に区別されず、どちらも0行（config: null, error: null）
// になる。呼び出し側はこれを「未公開」として一律に扱うこと。
export async function fetchPublicConfig(companyCode) {
  if (!isSupabaseConfigured) {
    return { config: null, publishedAt: null, error: null };
  }

  try {
    const { data, error } = await supabase.rpc("get_public_config", {
      p_company_code: companyCode,
    });

    if (error) {
      return { config: null, publishedAt: null, error: { type: "unknown", message: error.message } };
    }

    // get_public_configは returns table (...) の集合を返す関数のため、
    // supabase-jsからは常に配列で返ってくる（0件 or 1件）。
    const row = Array.isArray(data) ? data[0] : data;

    if (!row) {
      return { config: null, publishedAt: null, error: null };
    }

    if (!isValidConfigShape(row.config_snapshot)) {
      return {
        config: null,
        publishedAt: null,
        error: { type: "unknown", message: "config_snapshotの形式が不正です。" },
      };
    }

    return { config: row.config_snapshot, publishedAt: row.published_at, error: null };
  } catch (caughtError) {
    return { config: null, publishedAt: null, error: { type: "network", message: caughtError.message } };
  }
}
