// 【一時的なデバッグログ・要削除】concur_identity_rejected（Identity APIが
// 401/403を返した場合）の原因調査のため、Concurのレスポンスから「許可リスト」
// に載っている安全な情報だけを取り出し、構造化ログ用のオブジェクトを組み立てる。
//
// ここが返す値だけがログへ出してよい情報であり、それ以外
// （生レスポンス本文全体・error_description全文・message全文・userName・
// メールアドレス・userID・利用者プロフィール・scopeの生値・Access Token・
// Refresh Token・Client Secret・Authorizationヘッダー・リクエストURLの
// filter値）は、この関数の引数にも戻り値にも一切含めない。
//
// デバッグが終わったら、この関数自体と呼び出し箇所
// （lookupConcurUser.js）を削除すること。

const MAX_FIELD_LENGTH = 100;
const LONG_TOKEN_LENGTH_THRESHOLD = 40;

// 候補フィールド名（値の中身ではなく、キー名だけを見て安全に読み取ってよいと
// 判断したもの）。error_description・messageはここに含めない＝読み取っても
// ログへは出さない。
const ERROR_CODE_FIELD_NAMES = ["error", "code", "errorCode"];

// 正式なヘッダー名が不明なため、一般的に使われる候補だけに限定して確認する
// （見つからなければ何も出さない。推測で大量のヘッダーを見にいかない）。
const REQUEST_ID_HEADER_NAMES = ["x-request-id", "correlation-id", "x-correlation-id"];

const CONTROL_CHARS_PATTERN = /[\x00-\x1F\x7F]/g;
const EMAIL_LIKE_PATTERN = /@/;
const JWT_LIKE_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const TOKEN_LIKE_CHARSET_PATTERN = /^[A-Za-z0-9\-_.]+$/;
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9-]+$/;

function stripControlChars(value) {
  return value.replace(CONTROL_CHARS_PATTERN, "");
}

// errorCode候補の値を、想定外の構造・危険そうな値なら"unknown"へ丸める。
function sanitizeErrorCode(rawValue) {
  if (typeof rawValue !== "string") {
    return "unknown";
  }

  const sanitized = stripControlChars(rawValue).trim();

  if (sanitized === "" || sanitized.length > MAX_FIELD_LENGTH) {
    return "unknown";
  }
  if (EMAIL_LIKE_PATTERN.test(sanitized)) {
    return "unknown";
  }
  if (JWT_LIKE_PATTERN.test(sanitized)) {
    return "unknown";
  }
  if (sanitized.length > LONG_TOKEN_LENGTH_THRESHOLD && TOKEN_LIKE_CHARSET_PATTERN.test(sanitized)) {
    // 長いトークンらしい値（Access Token等の断片である可能性を排除できないもの）。
    return "unknown";
  }

  return sanitized;
}

function extractErrorCode(parsedBody) {
  if (parsedBody === null || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
    return "unknown";
  }

  for (const fieldName of ERROR_CODE_FIELD_NAMES) {
    const value = parsedBody[fieldName];
    if (typeof value === "string" && value.trim() !== "") {
      return sanitizeErrorCode(value);
    }
  }

  return "unknown";
}

function sanitizeRequestId(rawValue) {
  if (typeof rawValue !== "string") {
    return null;
  }
  const trimmed = rawValue.trim();
  if (trimmed === "" || trimmed.length > MAX_FIELD_LENGTH) {
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
 *   errorCode: string,
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

  const errorCode = responseJsonParsed ? extractErrorCode(parsedBody) : "unknown";

  return {
    stage: "identity_rejected",
    status,
    errorCode,
    responseJsonParsed,
    requestIdPresent,
    requestId,
  };
}
