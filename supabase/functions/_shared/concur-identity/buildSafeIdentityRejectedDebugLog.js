// 【一時的なデバッグログ・要削除】concur_identity_rejected（Identity APIが
// 401/403を返した場合）の原因調査のため、ConcurのレスポンスJSONから
// error・error_description の2フィールドだけを安全に抽出し、構造化ログ用の
// オブジェクトを組み立てる。
//
// ここが返す値だけがログへ出してよい情報であり、それ以外
// （生レスポンス本文全体・message全文・userName・メールアドレス・userID・
// 利用者プロフィール・scopeの生値・Access Token・Refresh Token・
// Client Secret・Authorizationヘッダー・リクエストURLのfilter値）は、
// この関数の引数にも戻り値にも一切含めない。
//
// error_descriptionは仕様上は人が読む説明文だが、万一機密情報を含んでいた
// 場合に備え、文字列全体を丸ごと信用するのではなく、メールアドレスらしい
// 部分・UUID（userIDの形式）らしい部分・長いトークンらしい部分を検出したら
// その箇所だけ置換（redact）してから使う。
//
// デバッグが終わったら、この関数自体と呼び出し箇所
// （lookupConcurUser.js）を削除すること。

const MAX_ERROR_LENGTH = 100;
const MAX_ERROR_DESCRIPTION_LENGTH = 200;
const LONG_TOKEN_LENGTH_THRESHOLD = 40;

// 正式なヘッダー名が不明なため、一般的に使われる候補だけに限定して確認する
// （見つからなければ何も出さない。推測で大量のヘッダーを見にいかない）。
const REQUEST_ID_HEADER_NAMES = ["x-request-id", "correlation-id", "x-correlation-id"];

const CONTROL_CHARS_PATTERN = /[\x00-\x1F\x7F]/g;
const EMAIL_LIKE_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const UUID_LIKE_PATTERN = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
const LONG_TOKEN_RUN_PATTERN = /[A-Za-z0-9\-_.]{24,}/g;
const JWT_LIKE_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const TOKEN_LIKE_CHARSET_PATTERN = /^[A-Za-z0-9\-_.]+$/;
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9-]+$/;

function stripControlChars(value) {
  return value.replace(CONTROL_CHARS_PATTERN, "");
}

// error（OAuth系の短いエラーコードを想定）の安全化。想定外の構造・危険そうな
// 値ならnullへ丸める（生の値をそのままログへ出さない）。
function sanitizeShortErrorField(rawValue) {
  if (typeof rawValue !== "string") {
    return null;
  }

  const sanitized = stripControlChars(rawValue).trim();

  if (sanitized === "" || sanitized.length > MAX_ERROR_LENGTH) {
    return null;
  }
  if (sanitized.includes("@")) {
    // メールアドレスらしい値。
    return null;
  }
  if (JWT_LIKE_PATTERN.test(sanitized)) {
    // JWT等のトークンらしい値。
    return null;
  }
  if (sanitized.length > LONG_TOKEN_LENGTH_THRESHOLD && TOKEN_LIKE_CHARSET_PATTERN.test(sanitized)) {
    // 長いトークンらしい値（Access Token等の断片である可能性を排除できないもの）。
    return null;
  }

  return sanitized;
}

// error_description（人が読む説明文）の安全化。文字列全体を丸ごと捨てるのでは
// なく、メールアドレス・UUID（userIDの形式）・長いトークンらしい部分文字列を
// 検出した箇所だけ置換（redact）し、それ以外の説明文は残す。
function sanitizeErrorDescriptionField(rawValue) {
  if (typeof rawValue !== "string") {
    return null;
  }

  let sanitized = stripControlChars(rawValue).trim();
  if (sanitized === "") {
    return null;
  }

  sanitized = sanitized.replace(EMAIL_LIKE_PATTERN, "[redacted-email]");
  sanitized = sanitized.replace(UUID_LIKE_PATTERN, "[redacted-id]");
  sanitized = sanitized.replace(LONG_TOKEN_RUN_PATTERN, "[redacted-token]");
  sanitized = sanitized.trim();

  if (sanitized === "") {
    return null;
  }
  if (sanitized.length > MAX_ERROR_DESCRIPTION_LENGTH) {
    sanitized = `${sanitized.slice(0, MAX_ERROR_DESCRIPTION_LENGTH)}…`;
  }

  return sanitized;
}

function sanitizeRequestId(rawValue) {
  if (typeof rawValue !== "string") {
    return null;
  }
  const trimmed = rawValue.trim();
  if (trimmed === "" || trimmed.length > MAX_ERROR_LENGTH) {
    return null;
  }
  if (!SAFE_REQUEST_ID_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function findRequestIdHeaderValue(headers) {
  if (!headers || typeof headers.get !== "function") {
    return null;
  }
  for (const headerName of REQUEST_ID_HEADER_NAMES) {
    const value = headers.get(headerName);
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }
  return null;
}

/**
 * @param {object} input
 * @param {number} input.status
 * @param {string} [input.bodyText] 【重要】この値自体はログへ含めない。JSON解析にのみ使う。
 * @param {{ get: (name: string) => string | null }} [input.headers]
 * @returns {{
 *   stage: "identity_rejected",
 *   status: number,
 *   error: string | null,
 *   errorDescription: string | null,
 *   responseJsonParsed: boolean,
 *   requestIdPresent: boolean,
 *   requestId: string | null,
 * }}
 */
export function buildSafeIdentityRejectedDebugLog({ status, bodyText, headers }) {
  const rawRequestIdHeaderValue = findRequestIdHeaderValue(headers);
  const requestIdPresent = rawRequestIdHeaderValue !== null;
  const requestId = requestIdPresent ? sanitizeRequestId(rawRequestIdHeaderValue) : null;

  let parsedBody = null;
  let responseJsonParsed = false;
  if (typeof bodyText === "string" && bodyText.trim() !== "") {
    try {
      parsedBody = JSON.parse(bodyText);
      responseJsonParsed = true;
    } catch {
      responseJsonParsed = false;
    }
  }

  const isPlainObject =
    responseJsonParsed && parsedBody !== null && typeof parsedBody === "object" && !Array.isArray(parsedBody);

  const error = isPlainObject ? sanitizeShortErrorField(parsedBody.error) : null;
  const errorDescription = isPlainObject ? sanitizeErrorDescriptionField(parsedBody.error_description) : null;

  return {
    stage: "identity_rejected",
    status,
    error,
    errorDescription,
    responseJsonParsed,
    requestIdPresent,
    requestId,
  };
}
