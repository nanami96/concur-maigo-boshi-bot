// check-concur-oauth（Edge Function本体はindex.ts）のリクエスト本文検証だけを
// 切り離した純粋関数。Deno固有のAPIには一切依存しないため、Node/vitestから
// 直接importしてテストできる（他のvalidate*Request.jsと同じ方針）。
//
// 【会社別OAuth接続対応で追加】以前はこのFunctionがrequest bodyを一切
// 読み取らなかった（認証情報・token URL・Refresh Tokenは全てSecrets/Vault
// 由来で、フロントから送られた値を信用する余地自体が存在しなかったため）。
// 会社ごとに異なるConcur OAuth接続を持てるようになったことに伴い、対象会社を
// 明示指定できるようcompanyCode（company_code）だけを必須項目として追加する。
// company UUID自体はクライアントから一切受け取らない
// （handleConcurOAuthCheckRequest.js・resolve_concur_oauth_company_id RPC
// 参照。company_codeから会社UUIDへの解決は必ずサーバー側で行う）。
import { validateCompanyCodeValue } from "../_shared/validateCompanyCodeValue.js";

/**
 * @param {unknown} body リクエスト本文をJSON.parseした値。
 * @returns {{ ok: true, companyCode: string } | { ok: false }}
 */
export function validateConcurOAuthCheckRequest(body) {
  if (!body || typeof body !== "object") {
    return { ok: false };
  }

  return validateCompanyCodeValue(body.companyCode);
}
