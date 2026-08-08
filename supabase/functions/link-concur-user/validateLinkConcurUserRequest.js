// link-concur-user（Edge Function本体はindex.ts）のリクエスト本文検証だけを
// 切り離した純粋関数。Deno固有のAPIには一切依存しないため、Node/vitestから
// 直接importしてテストできる（他のvalidate*Request.jsと同じ方針）。
//
// 検証項目：
//   - companyCode（company_code）… _shared/validateCompanyCodeValue.jsへ委譲
//     （既存のcheck-concur-oauth・lookup-concur-userと同じ基準）。
//   - concurLoginId … _shared/concur-identity/validateConcurIdentityLookupRequest.js
//     のvalidateConcurUserNameValue()をそのまま再利用する（Identity API
//     （GET /profile/identity/v4/Users）のuserNameと全く同じ意味の値のため、
//     判定基準を2箇所に別々実装しない。create-concur-quick-expenseの
//     validateQuickExpenseRequest.jsが以前使っていたのと同じ関数）。
//
// 失敗理由は区別せず、呼び出し元へは単一の固定コード
// （concur_user_link_invalid_request）としてのみ伝える（入力値そのものは
// ログ・レスポンスへ一切含めない）。
import { validateCompanyCodeValue } from "../_shared/validateCompanyCodeValue.js";
import { validateConcurUserNameValue } from "../_shared/concur-identity/validateConcurIdentityLookupRequest.js";

/**
 * @param {unknown} body リクエスト本文をJSON.parseした値。
 * @returns {{ ok: true, companyCode: string, concurLoginId: string } | { ok: false }}
 */
export function validateLinkConcurUserRequest(body) {
  if (!body || typeof body !== "object") {
    return { ok: false };
  }

  const companyCodeCheck = validateCompanyCodeValue(body.companyCode);
  if (!companyCodeCheck.ok) {
    return { ok: false };
  }

  const concurLoginIdCheck = validateConcurUserNameValue(body.concurLoginId);
  if (!concurLoginIdCheck.ok) {
    return { ok: false };
  }

  return {
    ok: true,
    companyCode: companyCodeCheck.companyCode,
    concurLoginId: concurLoginIdCheck.userName,
  };
}
