// index.tsのログ用に、Authorizationヘッダーの中身（トークン本体）を一切含まない
// 要約だけを作る純粋関数。ocr-receipt/index.tsの認証ログと同じ内容
// （ヘッダーの有無・Bearer形式かどうか・トークンの文字数）だが、Node/vitestから
// 「トークン本体が絶対に出力に含まれない」ことを直接テストできるように、
// 独立した関数として切り出している。
export function describeAuthHeaderForLogging(authHeader) {
  if (!authHeader) {
    return "Authorizationヘッダーなし";
  }

  const isBearerFormat = /^Bearer\s+.+/i.test(authHeader);
  const tokenLength = authHeader.replace(/^Bearer\s+/i, "").length;
  return `Authorizationヘッダーあり, Bearer形式=${isBearerFormat}, トークン長=${tokenLength}`;
}
