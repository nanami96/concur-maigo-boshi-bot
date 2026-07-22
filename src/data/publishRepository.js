import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";

// RPC（publish_company_draft、supabase/schema.sql参照）がraise exceptionした際の
// errcodeを、呼び出し側が扱いやすい種別へ変換する。
//   28000 … 認証が確認できない（セッション切れの可能性）
//   42501 … 対象会社のcompany_membersではない（権限なし）
//   P0002 … 公開しようとした会社にまだ下書きが存在しない
function classifyPublishError(error) {
  const code = error.code;

  if (code === "28000") {
    return { type: "auth", message: error.message };
  }
  if (code === "42501") {
    return { type: "forbidden", message: error.message };
  }
  if (code === "P0002") {
    return { type: "no_draft", message: error.message };
  }
  return { type: "unknown", message: error.message };
}

// 下書きを正式公開する。company_id・下書きの中身はDB側（RPC内部）で
// draft_configsから読み直すため、ここではconfig_snapshot（アプリ側で
// buildConfigFromFlowを使って計算したもの）だけを渡す。
// published_versionsへのINSERTとcompanies.current_published_version_idの
// UPDATEは、RPC内で1トランザクションとして原子的に行われる。
export async function publishDraft({ companyDbId, configSnapshot }) {
  if (!isSupabaseConfigured) {
    return { row: null, error: { type: "unknown", message: "Supabaseが設定されていません。" } };
  }

  try {
    const { data, error } = await supabase.rpc("publish_company_draft", {
      p_company_id: companyDbId,
      p_config_snapshot: configSnapshot,
    });

    if (error) {
      return { row: null, error: classifyPublishError(error) };
    }

    return { row: data, error: null };
  } catch (caughtError) {
    return { row: null, error: { type: "network", message: caughtError.message } };
  }
}

// 公開履歴（新しい順）。一般利用者向けUIにUUIDをそのまま出す想定はないが、
// 内部的な識別のためidは保持しておく。
export async function fetchPublishHistory(companyDbId, { limit = 20 } = {}) {
  if (!isSupabaseConfigured) {
    return { rows: [], error: null };
  }

  try {
    const { data, error } = await supabase
      .from("published_versions")
      .select("id, published_at, published_by")
      .eq("company_id", companyDbId)
      .order("published_at", { ascending: false })
      .limit(limit);

    if (error) {
      return { rows: [], error: { type: "unknown", message: error.message } };
    }

    return { rows: data || [], error: null };
  } catch (caughtError) {
    return { rows: [], error: { type: "network", message: caughtError.message } };
  }
}

// 現在この会社が向いているpublished_versions.id（未公開ならnull）。
export async function fetchCurrentPublishedVersionId(companyDbId) {
  if (!isSupabaseConfigured) {
    return { currentPublishedVersionId: null, error: null };
  }

  try {
    const { data, error } = await supabase
      .from("companies")
      .select("current_published_version_id")
      .eq("id", companyDbId)
      .maybeSingle();

    if (error) {
      return { currentPublishedVersionId: null, error: { type: "unknown", message: error.message } };
    }

    return { currentPublishedVersionId: data?.current_published_version_id ?? null, error: null };
  } catch (caughtError) {
    return { currentPublishedVersionId: null, error: { type: "network", message: caughtError.message } };
  }
}
