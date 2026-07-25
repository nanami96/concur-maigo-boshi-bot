import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

// 領収書読み取りPoC専用のRepository。supabase.functions.invoke()経由で
// Supabase Edge Function（supabase/functions/ocr-receipt）を呼び出す。
//
// Azure Document IntelligenceのAPIキーはこのファイル・フロントのどこにも
// 一切登場しない（Edge Function側のSecretとしてのみ存在する。詳細は
// supabase/functions/ocr-receipt/index.ts冒頭のコメント参照）。
//
// supabase.functions.invoke()は、現在ログイン中セッションのアクセストークンを
// 自動的にAuthorizationヘッダーへ付与する（membershipRepository.jsの各RPC
// 呼び出しと同じ、既存のsupabaseクライアント経由の認証方式）。呼び出し側
// （ReceiptOcrPanel.jsx）が明示的にトークンを扱う必要は無い。
//
// Edge Function自身のポーリング処理（supabase/functions/ocr-receipt/index.ts の
// POLL_MAX_ATTEMPTS×POLL_INTERVAL_MS）には最大約24秒のタイムアウトが既にあるが、
// 従来はこのフロント側（supabase.functions.invoke()呼び出し）にタイムアウト指定が
// 無かった。モバイル回線の瞬断・電波状況の悪化等でリクエスト/レスポンスの
// 途中でTCP接続自体が応答不能になった場合、fetch()のPromiseはブラウザの
// 既定動作としてresolveもrejectもされないまま残り得る（サーバー側が
// どれだけ早く応答を返せても、そもそも届かない/戻らないケースには効かない）。
// ReceiptOcrPanel.jsx側はこの結果をawaitしているだけなので、Promiseが
// 一切決着しないと「領収書を読み取っています…」から永久に抜けられなくなる
// （本番のiPhone実機で発生した「ローディングのまま止まる」不具合の根本原因）。
// timeoutを指定すると、supabase-js（@supabase/functions-js）が内部で
// AbortControllerを生成しこの時間で自動的にfetchをabortしてくれるため、
// 必ずPromiseが決着するようになる。値はEdge Function側の最大処理時間
// （約24-30秒）にアップロード・往復分の余裕を足した40秒とする。
const OCR_INVOKE_TIMEOUT_MS = 40_000;

export async function classifyOcrFunctionError(error) {
  if (!error) {
    return { type: null, message: null };
  }

  if (error instanceof FunctionsFetchError) {
    // フロント側のtimeout（上記OCR_INVOKE_TIMEOUT_MS）によるAbortも、supabase-js
    // 内部では通常のfetch失敗と同じくFunctionsFetchErrorとして届く（.contextに
    // 元のAbortErrorが入る）。単なる通信断と区別し、利用者へは「時間切れ」として
    // 案内する（OCR_ERROR_MESSAGES.timeoutは既にEdge Function側の504と共通で
    // 使っている文言）。
    if (error.context?.name === "AbortError") {
      return { type: "timeout", message: null };
    }
    return { type: "network", message: null };
  }

  if (error instanceof FunctionsRelayError) {
    return { type: "unknown", message: null };
  }

  if (error instanceof FunctionsHttpError) {
    // error.contextはinvoke()内部でconsumeされる前のResponseそのもの
    // （supabase-jsのFunctionsClient.invoke()参照）のため、.statusは
    // .json()の成否に関わらずここで確実に読める。
    const status = error.context?.status;

    try {
      const body = await error.context.json();
      if (body?.error?.code) {
        return { type: body.error.code, message: body.error.message || null };
      }
    } catch {
      // Edge Functionが想定外の形（JSON以外）を返した場合は下のstatusベースの
      // 判定へフォールバックする。
    }

    // 本文がこのEdge Function独自の{error:{code,message}}形式でなくても
    // （例：Supabaseプラットフォーム自体のverify_jwtがこの関数のコードより
    // 前でリクエストを拒否した場合、本文の形は自前のものと異なる）、
    // HTTPステータスが401であれば認証切れとして扱う。timeout・通信エラー
    // 等の別カテゴリへ誤分類しないためのフォールバック。
    if (status === 401) {
      return { type: "unauthorized", message: null };
    }

    return { type: "unknown", message: null };
  }

  return { type: "unknown", message: null };
}

// OCR開始直前にセッションの有無を確認する。supabase.functions.invoke()は
// 呼び出し時点のsession（access_token）を使ってAuthorizationヘッダーを
// 組み立てるが、このプロジェクトのフロントは新形式のpublishable keyを使って
// いるため、sessionが無い状態でinvoke()を呼ぶとAuthorizationヘッダー自体が
// 付与されないままリクエストが送られ、Edge Function側でunauthorized（401）に
// なる（@supabase/supabase-jsのlib/fetch.ts、fetchWithAuthのomitApiKeyAsBearer
// 実装を確認済み）。この状態でAzure呼び出しへ進んでも意味が無く、OCR特有の
// エラー（タイムアウト・解析失敗等）として利用者に見せるべきではないため、
// invoke()を呼ぶ前にここで打ち切る。
// getSession()は期限が近ければ内部で自動的にリフレッシュを試みるが、それでも
// 復元できない場合の保険として、ここでrefreshSession()を一度だけ追加で試す
// （無限リトライ・毎回の強制更新はしない）。
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
    // 扱いにする（fail-closed。Azure呼び出しへ進めて余計なOCRエラーを
    // 見せるより、まず再ログインを促す方が安全）。
    return false;
  }
}

// 領収書画像（File）をEdge Functionへ送り、正規化済みのOCR結果を受け取る。
// 戻り値のresultは { transactionDate, merchantName, totalAmount, currencyCode,
// confidence: { transactionDate, merchantName, totalAmount } } の形
// （supabase/functions/ocr-receipt/normalizeReceiptResult.js参照）。
// ReceiptType（経費タイプの手がかりになりうる分類）はこの戻り値に一切含まれない。
export async function analyzeReceiptImage(file) {
  if (!isSupabaseConfigured) {
    return { result: null, error: { type: "unknown", message: "Supabaseが設定されていません。" } };
  }

  if (!(await ensureValidSession())) {
    return { result: null, error: { type: "unauthorized", message: null } };
  }

  const formData = new FormData();
  formData.append("file", file);

  try {
    const { data, error } = await supabase.functions.invoke("ocr-receipt", {
      body: formData,
      timeout: OCR_INVOKE_TIMEOUT_MS,
    });

    if (error) {
      const classified = await classifyOcrFunctionError(error);
      return {
        result: null,
        error: { type: classified.type, message: classified.message },
      };
    }

    return { result: data, error: null };
  } catch (caughtError) {
    return { result: null, error: { type: "network", message: caughtError.message } };
  }
}
