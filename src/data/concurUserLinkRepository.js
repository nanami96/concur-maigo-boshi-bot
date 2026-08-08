import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

// 【Phase 13で追加】ConcurログインIDをuser_id×company_id単位で紐付ける
// （毎回の入力を不要にする）ための、supabase/functions/link-concur-user
// および supabase/schema.sql Phase 13のRPC（get_my_concur_link_status・
// unlink_my_concur_user）専用のRepository。
//
// 【重要・表示可能な情報の範囲】get_my_concur_link_status()はhas_link
// （真偽値）とverified_atだけを返す設計で、Concurログインの生値・
// Concur内部のUser ID（UUID）は一切含まれない（supabase/schema.sql参照）。
// この関数もその範囲を超える値をコンポーネントへ渡さない。
const LINK_CONCUR_USER_FUNCTION_NAME = "link-concur-user";

// Identity API呼び出しはOAuthのRefresh Token Grant取得＋Vault保存＋Concur
// Identity APIへの検索通信＋DB保存を1リクエスト内で行うため、
// lookup-concur-userと同程度のタイムアウトにする。
const LINK_CONCUR_USER_INVOKE_TIMEOUT_MS = 20_000;

// classifyLookupConcurUserFunctionError（concurIdentityLookupRepository.js）と
// 同じ考え方でinvoke()のerrorを固定コード（type）へ分類する。既存を直接
// importして再利用しない理由も同じ（既存機能に影響を与えないよう複製する、
// というこのプロジェクトの既存方針）。message・detailsは意図的に保持しない。
export async function classifyLinkConcurUserFunctionError(error) {
  if (!error) {
    return { type: null };
  }

  if (error instanceof FunctionsFetchError) {
    if (error.context?.name === "AbortError") {
      return { type: "timeout" };
    }
    return { type: "network" };
  }

  if (error instanceof FunctionsRelayError) {
    return { type: "unknown" };
  }

  if (error instanceof FunctionsHttpError) {
    const status = error.context?.status;

    try {
      const body = await error.context.json();
      if (body?.error?.code) {
        return { type: body.error.code };
      }
    } catch {
      // Edge Functionが想定外の形（JSON以外）を返した場合は下のstatusベースの
      // 判定へフォールバックする。
    }

    if (status === 401) {
      return { type: "unauthorized" };
    }

    return { type: "unknown" };
  }

  return { type: "unknown" };
}

// linkConcurUser()の直前にセッションの有無を確認する。
// concurIdentityLookupRepository.jsのensureValidSession()と同じ理由・
// 同じ実装（既存機能に影響を与えないよう複製している）。
async function ensureValidSession() {
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.access_token) {
      return true;
    }

    const { data: refreshed } = await supabase.auth.refreshSession();
    return Boolean(refreshed?.session?.access_token);
  } catch {
    return false;
  }
}

/**
 * ログイン中ユーザー自身の、指定した会社に対するConcurログインID紐付け状態
 * （真偽値のみ）を取得する。get_my_concur_link_status(text) RPCを呼ぶだけの
 * 単純な処理のため、他のRPC呼び出し（src/data/membershipRepository.js）と
 * 同じくensureValidSessionは行わない（supabase-jsクライアントが自動的に
 * 現在のセッションのAuthorizationを使う。RPC自体もauth.uid()がnullなら
 * 0行を返すため、未ログイン時も安全にfalse相当として扱える）。
 *
 * @param {string} companyCode
 * @returns {Promise<{
 *   result: { hasLink: boolean, verifiedAt: string|null } | null,
 *   error: { type: string, message: string } | null
 * }>}
 */
export async function getConcurUserLinkStatus(companyCode) {
  if (!isSupabaseConfigured) {
    return { result: null, error: { type: "unknown", message: "Supabaseが設定されていません。" } };
  }

  try {
    const { data, error } = await supabase.rpc("get_my_concur_link_status", { p_company_code: companyCode });

    if (error) {
      return { result: null, error: { type: "unknown", message: error.message } };
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return { result: { hasLink: false, verifiedAt: null }, error: null };
    }

    return {
      result: { hasLink: Boolean(row.has_link), verifiedAt: row.verified_at ?? null },
      error: null,
    };
  } catch (caughtError) {
    return { result: null, error: { type: "network", message: caughtError.message } };
  }
}

/**
 * Identity APIで実在確認したうえで、指定したConcurログインIDをログイン中
 * ユーザー自身の、指定した会社への紐付けとして保存する
 * （link-concur-user Edge Function）。
 *
 * @param {string} companyCode
 * @param {string} concurLoginId
 * @returns {Promise<{
 *   result: { linked: boolean, status?: string } | null,
 *   error: { type: string } | null
 * }>}
 */
export async function linkConcurUser(companyCode, concurLoginId) {
  if (!isSupabaseConfigured) {
    return { result: null, error: { type: "unknown" } };
  }

  if (!(await ensureValidSession())) {
    return { result: null, error: { type: "unauthorized" } };
  }

  try {
    const { data, error } = await supabase.functions.invoke(LINK_CONCUR_USER_FUNCTION_NAME, {
      body: { companyCode, concurLoginId },
      timeout: LINK_CONCUR_USER_INVOKE_TIMEOUT_MS,
    });

    if (error) {
      const classified = await classifyLinkConcurUserFunctionError(error);
      return { result: null, error: { type: classified.type } };
    }

    return { result: data?.result ?? null, error: null };
  } catch {
    return { result: null, error: { type: "network" } };
  }
}

/**
 * ログイン中ユーザー本人の、指定した会社に対するConcurログインID紐付けを
 * 解除する（unlink_my_concur_user(text) RPC）。
 *
 * @param {string} companyCode
 * @returns {Promise<{ result: { unlinked: boolean } | null, error: { type: string, message: string } | null }>}
 */
export async function unlinkConcurUser(companyCode) {
  if (!isSupabaseConfigured) {
    return { result: null, error: { type: "unknown", message: "Supabaseが設定されていません。" } };
  }

  try {
    const { data, error } = await supabase.rpc("unlink_my_concur_user", { p_company_code: companyCode });

    if (error) {
      return { result: null, error: { type: "unknown", message: error.message } };
    }

    return { result: { unlinked: data === true }, error: null };
  } catch (caughtError) {
    return { result: null, error: { type: "network", message: caughtError.message } };
  }
}
