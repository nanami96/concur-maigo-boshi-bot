// 案内メッセージ・注意事項（rule.message / rule.warningMessage / expenseType.note）は
// EditableText.jsx（プレーンなtextarea）で入力される、Markdown等の記法を一切持たない
// 自由記述テキスト。管理者がこの中にURLを直接貼り付けても、これまでは単なる文字列と
// してそのまま表示され、クリックできなかった。
//
// 入力欄側（textarea）は変更せず、表示側だけで「http(s)://から始まる文字列」を
// 検出し、その部分だけ<a>要素へ置き換える。
//
// 「空白以外すべて」ではなく、URLとして妥当な文字集合だけにマッチさせている点が重要：
// 日本語の文章では「詳細はhttps://example.com/pageをご覧ください」のように、URLの
// 直後にスペース無しで日本語が続くことが多い。もし[^\s]+のように空白以外を全て
// 許可すると、後続の日本語部分までURLに取り込んでしまう。日本語（ひらがな・
// カタカナ・漢字・全角記号）はURLの構成文字集合に含まれないため、文字集合を
// 明示的に絞ることで自然にそこで区切られる。
// また、URLの直後にスペース無しで句点（。）や閉じ括弧が続く場合（例:「こちらです。」）も
// 同様に、末尾の記号は明示的に除外してリンクの外側へ戻す。
const URL_PATTERN = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g;
const TRAILING_PUNCTUATION_PATTERN = /[.,;:!?、。，．」』】）)\]}]+$/;

export function renderTextWithLinks(text) {
  if (!text) {
    return text;
  }

  const nodes = [];
  let cursor = 0;
  let match;

  URL_PATTERN.lastIndex = 0;
  while ((match = URL_PATTERN.exec(text)) !== null) {
    const matchStart = match.index;
    let url = match[0];

    const trailing = url.match(TRAILING_PUNCTUATION_PATTERN);
    if (trailing) {
      url = url.slice(0, url.length - trailing[0].length);
    }

    if (!url) {
      continue;
    }

    if (matchStart > cursor) {
      nodes.push(text.slice(cursor, matchStart));
    }

    nodes.push(
      <a key={matchStart} href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>,
    );

    cursor = matchStart + url.length;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}
