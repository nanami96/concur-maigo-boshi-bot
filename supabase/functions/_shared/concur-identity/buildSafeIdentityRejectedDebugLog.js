// 【一時的なデバッグログ・要削除】concur_identity_rejected（Identity APIが
// 401/403を返した場合）の原因調査のため、Concurのレスポンスから、
// 「どの公式エラースキーマに近いか（errorSchema）」と、各スキーマの
// 短いコード値（サニタイズ済み）・本文系フィールドの有無（真偽値のみ）だけを
// 安全に抽出し、構造化ログ用のオブジェクトを組み立てる。
//
// 【判定対象の3スキーマについて】
// Identity v4/v4.1の公式リファレンスには、エラー本文の具体的なJSON例は
// 掲載されていないが、同ドキュメント内に2種類のエラースキーマ定義
// （フィールド名のテーブルのみ）が存在する：
//   - SCIM系（RFC 7644 §3.12準拠の命名）: scimType / detail / status
//   - Concur系（Concur独自のエラー表現）: code / message / messages / type /
//     schemaPath
// これに加え、既存のOAuth token endpoint系の命名（error / error_description /
// errorCode 等）も念のため候補として確認する。実際にどの形で返っているかが
// 401原因切り分けの鍵になるため、いずれの形にも対応できるようにする。
//
// ここが返す値だけがログへ出してよい情報であり、それ以外
// （生レスポンス本文全体・detail/message/messagesの本文そのもの・userName・
// メールアドレス・userID・UUID・URL・利用者プロフィール・scopeの生値・
// Access Token・Refresh Token・Client Secret・Authorizationヘッダー・
// リクエストURLのfilter値）は、この関数の引数にも戻り値にも一切含めない。
// detail・message・messagesは「存在したかどうか（真偽値）」だけを記録し、
// 本文そのものは一切読み取り結果として保持・返却しない。
//
// デバッグが終わったら、この関数自体と呼び出し箇所
// （handleLookupConcurUserRequest.js 経由ではなく lookupConcurUser.js）を
// 削除すること。

const MAX_SHORT_CODE_LENGTH = 100;
// 公式ドキュメント上のConcur opaque refresh tokenのサンプル値は30文字前後
// （例："2d725xipty0z7ha3vlpy8b2c3hqxmw"）であることが確認できているため、
// 短いコード値としては現実的にありえない24文字超のトークン文字集合のみの
// 値は、安全側で「長いトークンらしい値」として丸める。
const LONG_TOKEN_LENGTH_THRESHOLD = 24;

// 正式なヘッダー名が不明なため、一般的に使われる候補だけに限定して確認する
// （見つからなければ何も出さない。推測で大量のヘッダーを見にいかない）。
const REQUEST_ID_HEADER_NAMES = ["x-request-id", "correlation-id", "x-correlation-id"];

// errorCode（総合的な短いコード）の候補フィールド名。この優先順位で最初に
// 安全化に成功した値を採用する。
const ERROR_CODE_FIELD_NAMES = ["error", "errorCode", "code"];

// errorSchema判定に使うフィールド名（スキーマごと）。判定優先順位は
// scim → concur → oauth → unknown（下のclassifyErrorSchema参照）。
const SCIM_SCHEMA_FIELD_NAMES = ["scimType", "detail", "status"];
const CONCUR_SCHEMA_FIELD_NAMES = ["code", "message", "messages", "type"];
const OAUTH_SCHEMA_FIELD_NAMES = ["error", "error_description"];

const CONTROL_CHARS_PATTERN = /[\x00-\x1F\x7F]/g;
const UUID_LIKE_PATTERN = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
const JWT_LIKE_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const TOKEN_LIKE_CHARSET_PATTERN = /^[A-Za-z0-9\-_.]+$/;
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9-]+$/;

function stripControlChars(value) {
  return value.replace(CONTROL_CHARS_PATTERN, "");
}

// 値が「意味のある形で存在する」かどうかだけを判定する（本文の中身は見ない・
// 返さない）。文字列は前後空白除去後に非空、配列は要素数>0、オブジェクトは
// キー数>0、それ以外（数値・真偽値等）はundefined/null以外なら存在扱い。
function isPresentValue(value) {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim() !== "";
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return true;
}

function hasAnyPresentField(body, fieldNames) {
  return fieldNames.some((fieldName) => isPresentValue(body[fieldName]));
}

// error/errorCode/code/scimTypeのような「短いコード値」を想定した安全化。
// 想定外の構造・危険そうな値ならnullへ丸める（生の値をそのままログへ
// 出さない）。
function sanitizeShortCodeField(rawValue) {
  if (typeof rawValue !== "string") {
    return null;
  }

  const sanitized = stripControlChars(rawValue).trim();

  if (sanitized === "" || sanitized.length > MAX_SHORT_CODE_LENGTH) {
    return null;
  }
  if (sanitized.includes("@")) {
    // メールアドレスらしい値。
    return null;
  }
  if (sanitized.includes("://")) {
    // URLらしい値。
    return null;
  }
  if (UUID_LIKE_PATTERN.test(sanitized)) {
    // UUID（userID等）らしい値。
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

// error → errorCode → code の優先順位で、最初に安全化へ成功した値を
// 総合的な短いコードとして採用する（既存パターンとの後方互換のための
// 総合スロット。スキーマ別の専用スロットはscimType/apiCode）。
function resolveErrorCode(body) {
  for (const fieldName of ERROR_CODE_FIELD_NAMES) {
    const sanitized = sanitizeShortCodeField(body[fieldName]);
    if (sanitized !== null) {
      return sanitized;
    }
  }
  return "unknown";
}

// scim → concur → oauth → unknown の優先順位で判定する（複数スキーマの
// フィールドが混在する場合は、より具体的な＝Identity API固有のスキーマを
// 優先する）。
function classifyErrorSchema(body) {
  if (hasAnyPresentField(body, SCIM_SCHEMA_FIELD_NAMES)) {
    return "scim";
  }
  if (hasAnyPresentField(body, CONCUR_SCHEMA_FIELD_NAMES)) {
    return "concur";
  }
  if (hasAnyPresentField(body, OAUTH_SCHEMA_FIELD_NAMES)) {
    return "oauth";
  }
  return "unknown";
}

function sanitizeRequestId(rawValue) {
  if (typeof rawValue !== "string") {
    return null;
  }
  const trimmed = rawValue.trim();
  if (trimmed === "" || trimmed.length > MAX_SHORT_CODE_LENGTH) {
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
 *   errorSchema: "scim" | "concur" | "oauth" | "unknown",
 *   scimType: string | null,
 *   apiCode: string | null,
 *   detailPresent: boolean,
 *   messagePresent: boolean,
 *   messagesPresent: boolean,
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

  const errorSchema = isPlainObject ? classifyErrorSchema(parsedBody) : "unknown";
  const errorCode = isPlainObject ? resolveErrorCode(parsedBody) : "unknown";
  const scimType = isPlainObject ? sanitizeShortCodeField(parsedBody.scimType) : null;
  const apiCode = isPlainObject ? sanitizeShortCodeField(parsedBody.code) : null;
  const detailPresent = isPlainObject ? isPresentValue(parsedBody.detail) : false;
  const messagePresent = isPlainObject ? isPresentValue(parsedBody.message) : false;
  const messagesPresent = isPlainObject ? isPresentValue(parsedBody.messages) : false;

  return {
    stage: "identity_rejected",
    status,
    errorCode,
    responseJsonParsed,
    errorSchema,
    scimType,
    apiCode,
    detailPresent,
    messagePresent,
    messagesPresent,
    requestIdPresent,
    requestId,
  };
}
