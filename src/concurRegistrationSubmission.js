// ConcurRegistrationPanel.jsxの「Concurに登録」ボタンの送信ロジックを、React
// （useState/useRef）から切り離した純粋関数として提供する。
//
// このプロジェクトにはReact Testing Library等のDOM描画テスト基盤が無く
// （tests/配下は全て純粋関数のユニットテストのみ、
// supabase/functions/create-concur-quick-expense/handleQuickExpenseRequest.js
// と同じ「呼び出し元がI/Oを注入する」パターンを踏襲）、ボタンの表示可否・
// 二重送信防止・成功後の再送信禁止・状態リセットの判定に、実際にクリック
// イベントを発火させる代わりにこれらの関数を直接呼び出してテストする。
//
// 二重送信防止について（重要）：
// submittingRef（呼び出し元のuseRefのcurrentプロパティ）による判定を、
// Reactのphase state（setPhase）ではなくこの同期的なミュータブルフラグに
// している。理由：phase stateの更新（setPhase）は非同期な再描画を経て
// 反映されるため、ごく短い間隔で2回連続してこの関数が呼ばれた場合
// （例：テストでawaitせずに2回呼ぶ、または実際の二重クリック）、2回目の
// 呼び出し時点でまだ古いphase（"idle"等）しか見えない可能性がある。
// submittingRef.currentへの代入はawaitより前の同期的な処理のため、
// JavaScriptのシングルスレッド特性により、1回目の呼び出しがその代入を
// 終えるまで2回目の呼び出しの本体は実行されない（run-to-completionの
// 区間内）ことが保証され、確実に2回目をブロックできる。
import { createQuickExpense as defaultCreateQuickExpense } from "./data/concurApi";

export function computeRegistrationSignature(registrationData) {
  return registrationData ? JSON.stringify(registrationData) : null;
}

export function shouldRenderConcurRegistrationCard({ error, registrationData }) {
  return !(error || !registrationData);
}

export function shouldBlockConcurRegistrationSubmit({ submitting, phase }) {
  return Boolean(submitting) || phase === "success";
}

/**
 * createQuickExpense()を呼び出し、結果を{ phase, errorType }へ変換する
 * （呼び出しガード自体は持たない。runConcurRegistrationSubmit参照）。
 *
 * @param {object} input
 * @param {object} input.registrationData buildConcurRegistrationData()の戻り値。
 * @param {typeof defaultCreateQuickExpense} [input.createQuickExpense] テスト用の差し替え。
 * @param {boolean} [input.isDev] 開発環境かどうか（import.meta.env.DEV）。
 * @param {(result: object) => void} [input.onStubSuccess] 成功時、isDevがtrueの
 *   場合だけ呼ばれる（スタブ応答であることを開発者だけに分かるようにするための
 *   フック。一般利用者へは表示しない）。
 * @param {(caughtError: unknown) => void} [input.onUnexpectedError] createQuickExpense()
 *   自体が例外を投げた場合のログ出力フック。
 * @returns {Promise<{ phase: "success"|"error", errorType: string|null }>}
 */
export async function submitConcurRegistration({
  registrationData,
  createQuickExpense = defaultCreateQuickExpense,
  isDev = false,
  onStubSuccess = () => {},
  onUnexpectedError = () => {},
}) {
  try {
    const { result, error } = await createQuickExpense(registrationData);

    if (error) {
      return { phase: "error", errorType: error?.type ?? null };
    }

    if (isDev) {
      onStubSuccess(result);
    }

    return { phase: "success", errorType: null };
  } catch (caughtError) {
    onUnexpectedError(caughtError);
    return { phase: "error", errorType: null };
  }
}

/**
 * ボタン押下時の処理本体。呼び出しガード（二重送信防止・成功後の再送信禁止）
 * を含む、handleRegister()相当のロジック全体。
 *
 * @param {object} input
 * @param {{ current: boolean }} input.submittingRef 呼び出し元のuseRef。
 * @param {string} input.phase 呼び出し時点のReact phase state。
 * @param {(phase: string) => void} input.onPhaseChange setPhase相当。
 * @param {(errorType: string|null) => void} input.onErrorTypeChange setErrorType相当。
 * @returns {Promise<{ skipped: boolean, phase?: string, errorType?: string|null }>}
 */
export async function runConcurRegistrationSubmit({
  submittingRef,
  phase,
  registrationData,
  createQuickExpense = defaultCreateQuickExpense,
  isDev = false,
  onStubSuccess = () => {},
  onUnexpectedError = () => {},
  onPhaseChange,
  onErrorTypeChange,
}) {
  if (shouldBlockConcurRegistrationSubmit({ submitting: submittingRef.current, phase })) {
    return { skipped: true };
  }

  submittingRef.current = true;
  onPhaseChange("submitting");
  onErrorTypeChange(null);

  const outcome = await submitConcurRegistration({
    registrationData,
    createQuickExpense,
    isDev,
    onStubSuccess,
    onUnexpectedError,
  });

  submittingRef.current = false;
  onPhaseChange(outcome.phase);
  onErrorTypeChange(outcome.errorType);

  return { skipped: false, phase: outcome.phase, errorType: outcome.errorType };
}
