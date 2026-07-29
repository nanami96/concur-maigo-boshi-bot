// SAP Concur「Quick Expense」API連携のための設計・実装。
//
// 全体構成（既存のsupabase/functions/ocr-receipt・src/data/ocrReceiptRepository.jsと
// 同じ考え方）：
//
//   React（このファイル） → Supabase Edge Function → Concur API
//
// なぜこの構成にするか：
//   このプロジェクトのフロントはReact/Vite + GitHub Pages（静的ホスティング、
//   サーバーサイドコード無し）で、ビルド後のJSに含めた値は誰でも読める
//   （src/lib/supabaseClient.jsのコメントにも明記の既存方針）。Concur側の
//   Client ID・Client Secret（および将来必要になりうるCompany-level
//   refresh token等）は強力な秘密情報であり、フロントに置く・フロントから
//   直接Concurへリクエストすることは絶対に行わない。そのため
//   supabase/functions/ocr-receipt と同じサーバー側プロキシ構成を取り、
//   Concurの認証情報はEdge Function専用のSupabase Secretsとして保存する
//   （想定するSecret名の例：CONCUR_CLIENT_ID・CONCUR_CLIENT_SECRET・
//   CONCUR_TOKEN_URL・CONCUR_API_BASE_URL。実際に必要な項目はConcurの
//   認証方式（OAuth2のどのグラント種別を使うか）が決まった時点で確定する。
//   現時点ではこのプロジェクトのどこにもこれらの認証情報を追加していない）。
//
//   Edge Functionは「1関数＝1責務」というocr-receiptの構成に合わせ、
//   createQuickExpense()には専用のEdge Function（下記
//   CREATE_QUICK_EXPENSE_FUNCTION_NAME、supabase/functions/
//   create-concur-quick-expense/）を割り当てている（1つのEdge Functionを
//   actionで分岐する構成は採用しなかった）。getAccessToken()・
//   uploadReceipt()はまだそれぞれ専用のEdge Functionを持たない
//   （未作成・名前も未確定。下の各関数のコメント参照）。
//
//   supabase/functions/create-concur-quick-expense は現時点ではConcurへの
//   実通信を一切行わないスタブ応答のみを返す（固定のダミー結果。
//   handleQuickExpenseRequest.js・createQuickExpenseStub.js参照）。実際の
//   Concur通信は、createQuickExpenseStub.jsの中身だけを差し替えることで
//   将来追加する想定。
//
// getAccessToken()についての設計メモ（重要）：
//   Concurの生アクセストークンは強力な秘密情報であり、Azure Document
//   IntelligenceのAPIキーと同様にブラウザには一切渡さない。そのため
//   将来の実装でも、この関数がEdge Functionから受け取るのは「Concurと
//   通信できる状態かどうか（例：{ connected: true }）」のような状態情報
//   までとし、生のアクセストークン文字列そのものをフロントの変数・
//   ネットワークレスポンスに載せない設計とする。
//
// 戻り値の形について：
//   既存のsrc/data/ocrReceiptRepository.js（analyzeReceiptImage）と同じ
//   { result, error } の形に揃えている。呼び出し側（React側）のエラー
//   ハンドリングを既存のOCR機能と同じパターンで書けるようにするため。

import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

// createQuickExpense()が呼び出すEdge Function名
// （supabase/functions/create-concur-quick-expense/index.ts）。
const CREATE_QUICK_EXPENSE_FUNCTION_NAME = "create-concur-quick-expense";

// createQuickExpense()はJSON本文のみ（画像を含まない）の軽量なリクエストで、
// Edge Function側も現時点ではスタブ応答を即座に返すだけのため、OCR
// （画像アップロード＋Azure側ポーリングに合わせた40秒、
// ocrReceiptRepository.jsのOCR_INVOKE_TIMEOUT_MS参照）より短い値にする。
// 実際のConcur通信に差し替えた後、Concur API側の応答時間に応じて
// 見直すこと。
const CREATE_QUICK_EXPENSE_INVOKE_TIMEOUT_MS = 15_000;

/**
 * Concur APIのアクセストークンが利用可能な状態にする（取得・必要なら更新）。
 *
 * 実装予定：専用のEdge Function（未作成・名前未定）を呼び出す。Client ID・
 * Client Secret等はEdge Function側がSupabase Secretsから読み取り、Concurの
 * 認証エンドポイントへ問い合わせる（グラント種別・リクエスト形式はConcur側の
 * 仕様確定後に実装する）。
 *
 * 上記コメントの通り、フロントには生のアクセストークンを返さない設計とする。
 *
 * @returns {Promise<{ result: { connected: boolean } | null, error: { type: string, message: string | null } | null }>}
 */
export async function getAccessToken() {
  if (!isSupabaseConfigured) {
    return { result: null, error: { type: "unknown", message: "Supabaseが設定されていません。" } };
  }

  // TODO: 専用のEdge Function（未作成）を呼び出す。Edge Function側でConcurの
  //       トークンエンドポイントへ問い合わせ、生のアクセストークンは返さず、
  //       接続可否のみをこの関数の戻り値に含める。エラー分類
  //       （classifyQuickExpenseFunctionError相当）もあわせて実装する。
  return { result: null, error: { type: "not_implemented", message: "未実装です（設計段階）。" } };
}

// classifyOcrFunctionError（ocrReceiptRepository.js）と同じ考え方で、
// supabase.functions.invoke()のerrorをこのプロジェクト共通の
// { type, message } 形へ分類する。create-concur-quick-expenseのエラー本文は
// { code, message, details } の形（供給元：handleQuickExpenseRequest.js・
// validateQuickExpenseRequest.js）のため、codeをtypeとして扱い、
// detailsをそのまま引き継ぐ。
//
// ocrReceiptRepository.jsのclassifyOcrFunctionErrorを直接importして
// 再利用しない理由：あちらはOCR機能専用のモジュールであり、OCRの動作
// 検証済みコードを今回の変更で不用意に触れないようにするため（ロジックの
// 形だけを踏襲し、実体は複製する）。
export async function classifyQuickExpenseFunctionError(error) {
  if (!error) {
    return { type: null, message: null, details: [] };
  }

  if (error instanceof FunctionsFetchError) {
    // クライアント側timeout（下記ensureValidSession・invoke呼び出し）による
    // Abortも、supabase-js内部では通常のfetch失敗と同じくFunctionsFetchErrorと
    // して届く（.contextに元のAbortErrorが入る）。
    if (error.context?.name === "AbortError") {
      return { type: "timeout", message: null, details: [] };
    }
    return { type: "network", message: null, details: [] };
  }

  if (error instanceof FunctionsRelayError) {
    return { type: "unknown", message: null, details: [] };
  }

  if (error instanceof FunctionsHttpError) {
    // error.contextはinvoke()内部でconsumeされる前のResponseそのもの
    // （supabase-jsのFunctionsClient.invoke()参照）のため、.statusは
    // .json()の成否に関わらずここで確実に読める。
    const status = error.context?.status;

    try {
      const body = await error.context.json();
      if (body?.error?.code) {
        return {
          type: body.error.code,
          message: body.error.message || null,
          details: Array.isArray(body.error.details) ? body.error.details : [],
        };
      }
    } catch {
      // Edge Functionが想定外の形（JSON以外）を返した場合は下のstatusベースの
      // 判定へフォールバックする。
    }

    // 本文がこのEdge Function独自の{error:{code,message,details}}形式でなくても
    // （例：Supabaseプラットフォーム自体がこの関数のコードより前でリクエストを
    // 拒否した場合、本文の形は自前のものと異なる）、HTTPステータスが401であれば
    // 認証切れとして扱う。
    if (status === 401) {
      return { type: "unauthorized", message: null, details: [] };
    }

    return { type: "unknown", message: null, details: [] };
  }

  return { type: "unknown", message: null, details: [] };
}

// createQuickExpense()の直前にセッションの有無を確認する。
// ocrReceiptRepository.jsのensureValidSession()と同じ理由・同じ実装
// （supabase.functions.invoke()は呼び出し時点のsession（access_token）を
// 使ってAuthorizationヘッダーを組み立てるが、このプロジェクトのフロントは
// 新形式のpublishable keyを使っているため、sessionが無い状態でinvoke()を
// 呼ぶとAuthorizationヘッダー自体が付与されないままリクエストが送られる。
// この状態でEdge Functionを呼んでも意味が無いため、ここで打ち切る）。
// ocrReceiptRepository.js側の実装は変更せず、同じロジックをこちらにも
// 複製している（既存のOCR機能に影響を与えないため）。
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
 * Concurへ新しいQuick Expense（簡易経費エントリ）を作成する。
 *
 * 現時点ではsupabase/functions/create-concur-quick-expenseはスタブ応答
 * （固定のダミー結果）しか返さない。Concur APIへの実通信・OAuth認証・
 * アクセストークンの取得は一切行われない（Edge Function側のコメント参照）。
 *
 * @param {object} expenseData Edge Function（create-concur-quick-expense）が
 *   検証する項目（companyId・policyId・expenseTypeId（＝Concur側のEXP_KEY）・
 *   transactionDate・amount・currencyCode・receiptRequired、任意で
 *   vendorName・memo）。フィールドの詳細は
 *   supabase/functions/create-concur-quick-expense/validateQuickExpenseRequest.js
 *   を参照。領収書画像（receiptFile等）は含めない
 *   （レシート添付はuploadReceipt()側の別責務）。
 *
 * @returns {Promise<{ result: { quickExpenseId: string, status: string } | null, error: { type: string, message: string | null, details?: Array<{ field: string, reason: string }> } | null }>}
 */
export async function createQuickExpense(expenseData) {
  if (!isSupabaseConfigured) {
    return { result: null, error: { type: "unknown", message: "Supabaseが設定されていません。" } };
  }

  if (!(await ensureValidSession())) {
    return { result: null, error: { type: "unauthorized", message: null } };
  }

  try {
    const { data, error } = await supabase.functions.invoke(CREATE_QUICK_EXPENSE_FUNCTION_NAME, {
      body: expenseData,
      timeout: CREATE_QUICK_EXPENSE_INVOKE_TIMEOUT_MS,
    });

    if (error) {
      const classified = await classifyQuickExpenseFunctionError(error);
      return {
        result: null,
        error: { type: classified.type, message: classified.message, details: classified.details },
      };
    }

    // Edge Function（handleQuickExpenseRequest.js）はHTTP 200のときだけ
    // { result, error: null } を返す設計のため、ここでのdataは常に
    // 成功結果そのもの。
    return { result: data?.result ?? null, error: null };
  } catch (caughtError) {
    return { result: null, error: { type: "network", message: caughtError.message } };
  }
}

/**
 * 既存のQuick Expenseへ領収書画像を添付する。
 *
 * @param {string} quickExpenseId createQuickExpense()で作成したQuick ExpenseのID。
 * @param {File} file 添付する領収書の画像ファイル
 *   （src/data/ocrReceiptRepository.jsのanalyzeReceiptImageと同様、
 *   FormData経由でEdge Functionへ送る想定）。
 *
 * 実装予定：専用のEdge Function（未作成・名前未定）へquickExpenseIdとfileを
 * 送る。Edge Function側でConcur Quick Expense APIの領収書添付エンドポイントへ
 * 中継する。
 *
 * @returns {Promise<{ result: { attached: boolean } | null, error: { type: string, message: string | null } | null }>}
 */
export async function uploadReceipt(quickExpenseId, file) {
  if (!isSupabaseConfigured) {
    return { result: null, error: { type: "unknown", message: "Supabaseが設定されていません。" } };
  }

  // TODO: FormDataにquickExpenseId・fileを詰めて専用のEdge Function（未作成）を
  //       呼び出す（ocrReceiptRepository.jsのanalyzeReceiptImage参照）。
  //       Concur側APIへの実際のアップロード処理はこのTODOの実装時に行う。
  return { result: null, error: { type: "not_implemented", message: "未実装です（設計段階）。" } };
}
