import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

// platform_admin専用の「Concur接続確認」ボタン（src/admin/UserManagementPanel.jsx）が
// 呼び出す、supabase/functions/check-concur-oauth 専用のRepository。既存の
// src/data/ocrReceiptRepository.js・src/data/concurApi.jsと同じ{ result, error }
// 形・同じセッション確認パターンを踏襲する。
//
// 【重要・表示可能な情報の範囲】check-concur-oauthは疎通確認の結果として
// { connected, hasGeolocation, expiresInPresent, refreshTokenRotated,
// scopePresent, hasQuickExpenseWriteScope, hasUserReadScope,
// hasIdentityUserIdsReadScope } という真偽値だけを返す設計で、Access Token・
// Refresh Token本体・Secrets・OAuthサーバーの生レスポンス・scopeの生値・
// 他のscope名は一切含まれない（supabase/functions/check-concur-oauth/
// buildConcurOAuthCheckResponse.js参照）。呼び出し元（UserManagementPanel.jsx）は
// エラー時に固定エラーコードだけを表示しレスポンス本文は一切表示しない方針のため、
// この関数が返すerrorは{ type }（固定コードのみ）とし、message等は保持しない
// （既存のOCR/Quick Expense向けRepositoryが保持するmessageとは意図的に異なる）。
const CHECK_CONCUR_OAUTH_FUNCTION_NAME = "check-concur-oauth";

// 疎通確認1回の応答時間はConcur側のtoken endpoint通信を含むが、大きなペイロードを
// 伴わない軽量なリクエストのため、create-concur-quick-expenseと同じ値にする
// （src/data/concurApi.jsのCREATE_QUICK_EXPENSE_INVOKE_TIMEOUT_MS参照）。
const CHECK_CONCUR_OAUTH_INVOKE_TIMEOUT_MS = 15_000;

// classifyOcrFunctionError（ocrReceiptRepository.js）・
// classifyQuickExpenseFunctionError（concurApi.js）と同じ考え方でinvoke()の
// errorを固定コード（type）へ分類する。既存の2つを直接importして再利用しない
// 理由も同じ（既存機能に影響を与えないよう複製する、というこのプロジェクトの
// 既存方針）。message・detailsは意図的に保持しない（呼び出し元がレスポンス
// 本文を一切表示しない設計のため）。
export async function classifyConcurOAuthCheckFunctionError(error) {
  if (!error) {
    return { type: null };
  }

  if (error instanceof FunctionsFetchError) {
    // フロント側のtimeout（下記CHECK_CONCUR_OAUTH_INVOKE_TIMEOUT_MS）による
    // Abortも、supabase-js内部では通常のfetch失敗と同じくFunctionsFetchErrorと
    // して届く（.contextに元のAbortErrorが入る）。
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

    // 本文がこのEdge Function独自の{error:{code,message}}形式でなくても
    // （例：Supabaseプラットフォーム自体のverify_jwtがこの関数のコードより
    // 前でリクエストを拒否した場合）、HTTPステータスが401であれば認証切れと
    // して扱う。
    if (status === 401) {
      return { type: "unauthorized" };
    }

    return { type: "unknown" };
  }

  return { type: "unknown" };
}

// checkConcurOAuthConnection()の直前にセッションの有無を確認する。
// ocrReceiptRepository.js・concurApi.jsのensureValidSession()と同じ理由・
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
    // getSession/refreshSession自体が失敗した場合も「セッション無し」と同じ
    // 扱いにする（fail-closed）。
    return false;
  }
}

/**
 * platform_admin専用：Concur OAuth（Refresh Token Grant）の疎通確認を行う
 * check-concur-oauth Edge Functionを呼び出す。リクエスト本文は送らない
 * （Edge Function側もbodyを一切読み取らない設計。index.ts冒頭コメント参照）。
 *
 * @returns {Promise<{
 *   result: {
 *     connected: boolean,
 *     hasGeolocation?: boolean,
 *     expiresInPresent?: boolean,
 *     refreshTokenRotated?: boolean,
 *     scopePresent?: boolean,
 *     hasQuickExpenseWriteScope?: boolean,
 *     hasUserReadScope?: boolean,
 *     hasIdentityUserIdsReadScope?: boolean,
 *     status?: string,
 *   } | null,
 *   error: { type: string } | null
 * }>}
 */
export async function checkConcurOAuthConnection() {
  if (!isSupabaseConfigured) {
    return { result: null, error: { type: "unknown" } };
  }

  if (!(await ensureValidSession())) {
    return { result: null, error: { type: "unauthorized" } };
  }

  try {
    const { data, error } = await supabase.functions.invoke(CHECK_CONCUR_OAUTH_FUNCTION_NAME, {
      timeout: CHECK_CONCUR_OAUTH_INVOKE_TIMEOUT_MS,
    });

    if (error) {
      const classified = await classifyConcurOAuthCheckFunctionError(error);
      return { result: null, error: { type: classified.type } };
    }

    // Edge Function（handleConcurOAuthCheckRequest.js）はHTTP 200のときだけ
    // { result, error: null } を返す設計のため、ここでのdataは常に成功結果
    // そのもの（安全ゲート無効時の { connected: false, status: "disabled" }
    // も含む）。
    return { result: data?.result ?? null, error: null };
  } catch {
    return { result: null, error: { type: "network" } };
  }
}
