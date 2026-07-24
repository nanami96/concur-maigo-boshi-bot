// membershipRepository.jsのclassifyMembershipRpcErrorが返す種別キーを、
// 利用者向けの日本語メッセージへ変換する。authErrorMessages.js（Supabase Auth
// 自体のエラー）とは別に、company_members関連RPC（redeem_invite_code・
// update_company_member_role等）専用のメッセージ集としてここに置く。
const MEMBERSHIP_ERROR_MESSAGES = {
  already_member: "既にどこかの会社に所属しています。",
  invalid_code: "招待コードが正しくありません。会社の管理者にご確認ください。",
  platform_forbidden: "この操作にはサービス運営者権限が必要です。",
  forbidden: "この操作には管理者権限が必要です。",
  last_admin: "この会社の管理者は最低1人必要なため、降格できません。",
  last_admin_removal: "この会社の管理者は最低1人必要なため、削除できません。",
  cannot_remove_self: "自分自身を会社から削除することはできません。",
  invalid_role: "指定された権限が不正です。",
  invalid_company_code:
    "会社コードの形式が正しくありません（小文字英数字とハイフンのみ、先頭は英数字）。",
  company_name_required: "会社名を入力してください。",
  company_code_taken: "その会社コードは既に使われています。別のコードを指定してください。",
  not_found: "対象のデータが見つかりませんでした。",
  auth: "ログインの有効期限が切れている可能性があります。再度ログインしてください。",
  network: "通信エラーが発生しました。通信状態を確認して再度お試しください。",
  unknown: "処理に失敗しました。しばらくしてから再度お試しください。",
};

export function resolveMembershipErrorMessage(errorType) {
  if (!errorType) {
    return null;
  }
  return MEMBERSHIP_ERROR_MESSAGES[errorType] || MEMBERSHIP_ERROR_MESSAGES.unknown;
}
