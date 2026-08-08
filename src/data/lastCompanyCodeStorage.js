// 複数社所属時、「前回利用した会社」を記憶するための小さなモジュール。
// pendingInviteCode.jsと同じ理由（タブ・ウィンドウをまたいでも共有され、
// 確認メールの経路等に依存しない）でlocalStorageを使う。
//
// pendingInviteCode.jsと異なり有効期限は設けない。こちらは「一時的な受け渡し」
// ではなく、利用者が複数社に所属している間ずっと参照され続ける長期的な好みの
// 保存だからである（期限切れにしても安全上のメリットは無く、単に「久しぶりに
// ログインしただけ」の利用者が毎回会社選択を求められるだけのデメリットになる）。
//
// キー名"lastCompanyCode"は既存のpendingInviteCode.jsと同じ命名規則
// （プレフィックス無しの素のcamelCase）に合わせている。
const STORAGE_KEY = "lastCompanyCode";

function getStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    // プライベートブラウジング等でlocalStorageへのアクセス自体が例外を投げる
    // 環境があるため、その場合は「保持しない」扱いにする（機能劣化するだけで、
    // 毎回の会社解決処理へ安全にフォールバックできる）。
    return null;
  }
}

export function readLastCompanyCode() {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    return typeof raw === "string" && raw.trim() !== "" ? raw : null;
  } catch {
    return null;
  }
}

export function saveLastCompanyCode(companyCode) {
  const storage = getStorage();
  if (!storage || typeof companyCode !== "string" || companyCode.trim() === "") {
    return;
  }
  try {
    storage.setItem(STORAGE_KEY, companyCode);
  } catch {
    // 保存に失敗しても実害は無い（次回起動時に会社選択が必要になるだけ）。
  }
}

export function clearLastCompanyCode() {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // 削除に失敗しても実害は無い。
  }
}
