// 未ログイン時点で入力された招待コードを、アカウント作成〜メール確認完了までの間
// 一時的に保持するための小さなモジュール。
//
// 保存先にlocalStorageを選んだ理由（sessionStorage・URL・Supabase user metadataとの比較）：
//   ・sessionStorage: タブ間で共有されないため、確認メールのリンクを「新しいタブ」で
//     開いた場合（多くのメールクライアントのデフォルト挙動）に招待コードが失われる。
//     この失敗パターンを最優先で避けたいため採用しない。
//   ・URL（query/hash）: 招待コードは資格情報ほど強い秘密ではないものの、
//     不要にブラウザ履歴・アクセスログ・analytics等へ残ってしまうため避ける。
//   ・Supabase user metadata（signUpのoptions.data）: 別デバイス・別ブラウザで
//     メールを開いた場合でも復元できる点で理論上はより堅牢だが、
//     signUp呼び出しの形を変える必要がある・後始末に認証後のupdateUser呼び出しが
//     追加で必要になる等、MVPとしては実装コストに見合わない。
//   ・localStorage: 同じブラウザ内であればタブ・ウィンドウをまたいで共有されるため、
//     確認メールを新しいタブで開いても引き継がれる。URLにもログにも残らない。
//     唯一の弱点は「別デバイス・別ブラウザでメールを開いた場合は引き継げない」ことだが、
//     その場合でもログイン後は自動的に（既存の）InviteCodeScreenへフォールバックし、
//     招待コードを手動で再入力するだけで済む（詰みにはならない）。
//     MVPとして最も単純かつ安全側に倒れているため、これを採用する。
//
// 招待コード自体はDBへの登録時、実際にはredeem_invite_code() RPC側でのみ検証される
// （このモジュールは「値を一時的に覚えておくだけ」で、有効性の検証は一切行わない）。
const STORAGE_KEY = "pendingInviteCode";

// 確認メールを開くまでの猶予として十分な長さ（例えばメールを後回しにして
// 数時間後に確認する等）を見込みつつ、無期限に残り続けないようにする。
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function getStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    // プライベートブラウジング等でlocalStorageへのアクセス自体が例外を投げる
    // 環境があるため、その場合は「保持しない」扱いにする（機能劣化するだけで、
    // 招待コードの手動再入力へ安全にフォールバックできる）。
    return null;
  }
}

export function savePendingInviteCode(code) {
  const storage = getStorage();
  if (!storage || !code) {
    return;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ code, savedAt: Date.now() }));
  } catch {
    // 容量制限等で保存に失敗しても、後続のログイン後手動入力フローへフォールバックできる。
  }
}

export function readPendingInviteCode() {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }

  if (!raw) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearPendingInviteCode();
    return null;
  }

  if (!parsed || typeof parsed.code !== "string" || typeof parsed.savedAt !== "number") {
    clearPendingInviteCode();
    return null;
  }

  if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
    clearPendingInviteCode();
    return null;
  }

  return parsed.code;
}

export function clearPendingInviteCode() {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // 削除に失敗しても実害は無い（次回読み出し時にMAX_AGE_MSで自然に無効化される）。
  }
}

// 自動redeemの結果（membershipRepository.classifyMembershipRpcErrorが返す種別）から、
// 次にどう振る舞うべきかだけを判定する純粋関数。errorTypeがnull/undefinedなら成功。
//
//   "success"           成功、または既に所属済み（redeemを二重に実行した結果と
//                       区別できないが、いずれの場合もpendingを破棄して以後は
//                       通常のmembership表示へ進めてよい）
//   "retry"             通信エラー等、再試行の余地がある。pendingは破棄しない
//   "clear_and_manual"  無効な招待コード等、再試行しても無駄なエラー。pendingを
//                       破棄し、手動の招待コード入力画面へフォールバックする
export function resolveAutoRedeemOutcome(errorType) {
  if (!errorType) {
    return "success";
  }
  if (errorType === "already_member") {
    return "success";
  }
  if (errorType === "network") {
    return "retry";
  }
  return "clear_and_manual";
}
