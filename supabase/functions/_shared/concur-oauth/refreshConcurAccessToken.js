// Concur OAuth2の「Refresh Token Grant」によるAccess Token更新を1本化する
// 呼び出し口。resolveConcurOAuthConfig.js（Secrets確認）→
// buildConcurRefreshTokenRequest.js（リクエスト組み立て）→
// fetchConcurTokenResponse.js（タイムアウト付きfetch）→
// classifyConcurOAuthHttpStatus.js（HTTPレスポンス分類）→
// validateConcurTokenResponse.js（tokenレスポンスの検証）→
// describeConcurOAuthResultForLogging.js（ログ用の安全な要約）の順で処理する。
//
// 【重要・現時点の位置づけ】
// このファイルはsupabase/functions/_shared/concur-oauth/に置かれた共有
// モジュールで、複数のEdge Functionから安全に再利用できるようにしている
// （Supabase Functionsの`_shared`ディレクトリ規約：アンダースコアで始まる
// ディレクトリは独立した関数として扱われず、他の関数からの相対import経由で
// デプロイバンドルへ取り込まれる）。
//
// 現時点では supabase/functions/check-concur-oauth/（platform_admin専用の
// OAuth疎通確認Function）だけがこの関数を呼び出す。既存の
// create-concur-quick-expense（createQuickExpenseStub.js・
// handleQuickExpenseRequest.js・index.ts）からは引き続き一切呼び出されて
// いない（「Concurに登録」ボタンを押しても、この関数・token endpointへの
// 通信は発生しない）。
//
// 【戻り値の扱いに関する重要な注意】
// ok:trueの場合に返すtokens（accessToken/refreshToken等の実際の値を含む）は、
// あくまでこの関数の「呼び出し元（将来、実際にConcur APIへリクエストする
// コードになる予定）」だけが使う内部値であり、フロントエンドや通常の
// APIレスポンス、ログへ絶対に転記してはならない。ログには必ず
// logSummary（真偽値だけの要約）だけを使うこと。
//
// 【Refresh Tokenローテーションについて】
// レスポンスに含まれるrefresh_tokenが、今回リクエストに使ったrefresh_token
// （config.refreshToken）と異なる場合、rotated: trueを返す。ただし今回は
// Supabase Secretsの自動更新・DB保存・古いRefresh Tokenの上書きは一切
// 行わない（呼び出し元へrotatedという事実だけを安全に伝える設計に留め、
// 実際の保存方法は実通信を始める別工程で決定する）。
import { resolveConcurOAuthConfig } from "./resolveConcurOAuthConfig.js";
import { buildConcurRefreshTokenRequest } from "./buildConcurRefreshTokenRequest.js";
import { fetchConcurTokenResponse } from "./fetchConcurTokenResponse.js";
import { classifyConcurOAuthHttpStatus } from "./classifyConcurOAuthHttpStatus.js";
import { validateConcurTokenResponse } from "./validateConcurTokenResponse.js";
import { describeConcurOAuthResultForLogging } from "./describeConcurOAuthResultForLogging.js";
import { buildConcurOAuthError } from "./classifyConcurOAuthError.js";

function failure(code) {
  return {
    ok: false,
    error: buildConcurOAuthError(code),
    logSummary: { ok: false, reason: code },
  };
}

/**
 * @param {object} [input]
 * @param {Record<string, string | undefined>} [input.env] CONCUR_CLIENT_ID等のSecret名をキーとした値の集合。
 * @param {typeof fetch} [input.fetchImpl] テスト用の差し替え。既定はグローバルfetch。
 * @param {number} [input.timeoutMs] token endpointへのfetchのタイムアウト（ミリ秒）。
 * @returns {Promise<
 *   | { ok: true, tokens: object, rotated: boolean, logSummary: object }
 *   | { ok: false, error: { code: string, message: string }, logSummary: object }
 * >}
 */
export async function refreshConcurAccessToken({ env, fetchImpl, timeoutMs } = {}) {
  const configResult = resolveConcurOAuthConfig(env);
  if (!configResult.ok) {
    return failure("concur_not_configured");
  }

  const request = buildConcurRefreshTokenRequest(configResult.config);

  const fetchResult = await fetchConcurTokenResponse({
    request,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  });

  if (fetchResult.outcome === "timeout") {
    return failure("concur_oauth_timeout");
  }

  if (fetchResult.outcome === "network_error") {
    return failure("concur_oauth_network_error");
  }

  const httpErrorCode = classifyConcurOAuthHttpStatus(fetchResult.response.status);
  if (httpErrorCode) {
    return failure(httpErrorCode);
  }

  let rawBody;
  try {
    rawBody = await fetchResult.response.json();
  } catch {
    // レスポンス本文がJSONとして解析できない場合。生の本文はログへ出さない。
    return failure("concur_oauth_invalid_response");
  }

  const validation = validateConcurTokenResponse(rawBody);
  if (!validation.ok) {
    return failure("concur_oauth_invalid_response");
  }

  const { tokens } = validation;
  const rotated = Boolean(tokens.refreshToken) && tokens.refreshToken !== configResult.config.refreshToken;

  return {
    ok: true,
    tokens,
    rotated,
    logSummary: { ok: true, rotated, ...describeConcurOAuthResultForLogging(tokens) },
  };
}
