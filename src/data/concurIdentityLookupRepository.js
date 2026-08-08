import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

// platform_admin専用の「Concur利用者の確認」入力欄（src/admin/ExternalServiceSettings.jsx）が
// 呼び出す、supabase/functions/lookup-concur-user 専用のRepository。既存の
// src/data/concurOAuthCheckRepository.jsと同じ{ result, error }形・同じ
// セッション確認パターンを踏襲する。
//
// 【重要・表示可能な情報の範囲】lookup-concur-userは検索結果として
// { found, hasUserId, multipleMatches } という真偽値だけを返す設計で、
// Concur利用者の実際のUUID（userID）・氏名・メールアドレス等のプロフィール、
// Access Token・Refresh Tokenは一切含まれない（supabase/functions/
// lookup-concur-user/buildLookupConcurUserResponse.js参照）。呼び出し元
// （ExternalServiceSettings.jsx）はエラー時に固定エラーコードだけを表示し
// レスポンス本文は一切表示しない方針のため、この関数が返すerrorも
// { type }（固定コードのみ）とし、message等は保持しない
// （concurOAuthCheckRepository.jsと同じ方針）。
const LOOKUP_CONCUR_USER_FUNCTION_NAME = "lookup-concur-user";

// Identity API呼び出しはOAuthのRefresh Token Grant取得＋Vault保存＋Concur
// Identity APIへの検索通信を1リクエスト内で行うため、check-concur-oauthより
// やや長めのタイムアウトにする。
const LOOKUP_CONCUR_USER_INVOKE_TIMEOUT_MS = 20_000;

// classifyConcurOAuthCheckFunctionError（concurOAuthCheckRepository.js）と
// 同じ考え方でinvoke()のerrorを固定コード（type）へ分類する。既存を直接
// importして再利用しない理由も同じ（既存機能に影響を与えないよう複製する、
// というこのプロジェクトの既存方針）。message・detailsは意図的に保持しない。
export async function classifyLookupConcurUserFunctionError(error) {
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

// lookupConcurUserIdentity()の直前にセッションの有無を確認する。
// concurOAuthCheckRepository.jsのensureValidSession()と同じ理由・同じ実装
// （既存機能に影響を与えないよう複製している）。
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
 * platform_admin専用：指定したConcurログインID（userName）に対応する利用者を
 * Concur Identity APIで検索するlookup-concur-user Edge Functionを呼び出す。
 *
 * 【会社別OAuth接続対応で変更】以前はリクエスト本文にuserNameしか含めず、
 * 常に既定のConcur OAuth接続を使っていたが、会社ごとに異なる接続を持てる
 * ようになったことに伴い、確認対象の会社（companyCode、company_code）も
 * 本文で送るようになった。company UUIDは一切送らない（Edge Function側が
 * companyCodeからサーバー側で解決する。supabase/functions/lookup-concur-user/
 * index.ts参照）。
 *
 * @param {string} userName 検索対象のConcurログインID（未trimでも可。
 *   Edge Function側で改めてtrim・検証される）。
 * @param {string} companyCode 確認対象の会社（company_code）。管理画面で
 *   現在表示中の会社を渡す想定（呼び出し元：src/admin/ExternalServiceSettings.jsx）。
 * @returns {Promise<{
 *   result: { found: boolean, hasUserId: boolean, multipleMatches: boolean, status?: string } | null,
 *   error: { type: string } | null
 * }>}
 */
export async function lookupConcurUserIdentity(userName, companyCode) {
  if (!isSupabaseConfigured) {
    return { result: null, error: { type: "unknown" } };
  }

  if (!(await ensureValidSession())) {
    return { result: null, error: { type: "unauthorized" } };
  }

  try {
    const { data, error } = await supabase.functions.invoke(LOOKUP_CONCUR_USER_FUNCTION_NAME, {
      body: { userName, companyCode },
      timeout: LOOKUP_CONCUR_USER_INVOKE_TIMEOUT_MS,
    });

    if (error) {
      const classified = await classifyLookupConcurUserFunctionError(error);
      return { result: null, error: { type: classified.type } };
    }

    return { result: data?.result ?? null, error: null };
  } catch {
    return { result: null, error: { type: "network" } };
  }
}
