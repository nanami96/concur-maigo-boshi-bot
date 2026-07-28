// Concur Quick Expense APIとの実通信を行う部分の「差し替え予定地」。
//
// 現時点ではConcurの認証情報の扱いが社内確認中であり、OAuth・アクセス
// トークン取得・Concur APIへのHTTPリクエストは一切行わない。この関数は
// 固定のダミー値だけを返すスタブであり、外部通信（fetch等）は一切発生しない。
//
// 関数名・戻り値のstatusに明示的に "stub" を含めているのは、本物のAPI
// 通信であるかのように見える命名・ログを避けるため（ハンドラー側の
// ログにもConcur実通信を示唆する文言は出さない。index.ts参照）。
//
// 将来Concur側の認証・API仕様が確定した時点で、この関数の中身だけを
// 実際のConcur Quick Expense API呼び出しに差し替える想定。呼び出し元
// （handleQuickExpenseRequest.js）・入力検証（validateQuickExpenseRequest.js）
// は変更不要なように、引数・戻り値の形（{ result, error }）は維持すること。
//
// 実装時に扱うことになる関心事（現時点ではまだ何も行わない）：
//   - Concurのアクセストークン取得・キャッシュ（src/data/concurApi.jsの
//     getAccessToken()相当の処理をこの関数の内部、またはこの関数が呼ぶ
//     別モジュールで行う）。
//   - Concur API側が実際に必要とするリクエストボディへの変換
//     （validatedPayloadのフィールド名とConcur側の正式フィールド名が
//     一致するとは限らない）。
//   - Concur API・認証エンドポイントが利用できない場合の
//     "concur_not_configured" エラー（現時点では未実装・未使用）。

/**
 * @param {ReturnType<typeof import("./validateQuickExpenseRequest.js").validateQuickExpenseRequest>["result"]} validatedPayload
 *   validateQuickExpenseRequest()で検証済みのリクエスト内容。現時点のスタブ
 *   実装では参照しない（将来の実装でConcurへ送る内容の組み立てに使う）。
 * @returns {Promise<{ result: { quickExpenseId: string, status: string } | null, error: { code: string, message: string, details?: Array<{ field: string, reason: string }> } | null }>}
 */
export async function createQuickExpenseStub(validatedPayload) {
  return {
    result: {
      quickExpenseId: "stub_quick_expense_id",
      status: "stubbed",
    },
    error: null,
  };
}
