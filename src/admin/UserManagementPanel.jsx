import { useCallback, useEffect, useState } from "react";
import {
  fetchMyCompanyMembers,
  fetchPlatformCompanyMembers,
  updateMemberRole,
  regenerateInviteCode,
} from "../data/membershipRepository";
import { resolveMembershipErrorMessage } from "./membershipErrorMessages";

const ROLE_LABELS = { user: "一般ユーザー", admin: "管理者" };

function formatTimestamp(iso) {
  if (!iso) {
    return "";
  }
  try {
    return new Date(iso).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "";
  }
}

// 管理画面の「ユーザー管理」タブ。
//
// 通常admin（companyDbId未指定）: 自社（呼び出し元がadminとして所属する会社）の
// ユーザーだけを表示する。一覧取得(list_my_company_members)・role変更
// (update_company_member_role)のどちらも、対象を自社に限定し最後のadmin降格を
// 拒否する検証をRPC側（DB側）で行っており、ここでのクライアント側チェックは
// あくまでUXのための早期フィードバックに過ぎない
// （最終的なセキュリティ境界はRPC/RLS側にある）。
//
// platform_admin（companyDbId指定あり）: AdminRoot/CompanyEditorが解決した
// 「今管理対象として選んでいる会社」のuuidを受け取り、list_platform_company_members
// で任意の会社のメンバー一覧を取得する。role変更は通常admin用のupdateMemberRoleを
// そのまま使い回せる（update_company_member_role自体がis_platform_admin() OR
// 対象会社のadminという条件でDB側検証しているため、呼び出し方を変える必要が無い）。
// 招待コードの再発行(regenerate_invite_code)はplatform_admin専用の操作としてのみ
// ここに表示する。
export default function UserManagementPanel({ companyDbId = null, isPlatformAdmin = false }) {
  const [state, setState] = useState({ status: "loading", members: [] });
  const [pendingMemberId, setPendingMemberId] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [inviteCodeState, setInviteCodeState] = useState({
    status: "idle", // idle | submitting | shown | error
    code: null,
    error: null,
  });

  const usingPlatformFetch = Boolean(isPlatformAdmin && companyDbId);

  const load = useCallback(async () => {
    setState({ status: "loading", members: [] });
    const { members, error } = usingPlatformFetch
      ? await fetchPlatformCompanyMembers(companyDbId)
      : await fetchMyCompanyMembers();

    if (error) {
      // 利用者へは定型メッセージだけを見せ、実際のエラー内容はコンソールに残す
      // （一覧取得RPCは権限が無い場合を「0件」で返す設計のため、ここに到達する
      // errorは通信障害等、本当に想定外のものだけのはず）。
      console.error("ユーザー一覧の取得に失敗しました", error);
      setState({ status: "error", members: [] });
      return;
    }

    setState({ status: "ready", members });
  }, [usingPlatformFetch, companyDbId]);

  useEffect(() => {
    load();
    setInviteCodeState({ status: "idle", code: null, error: null });
  }, [load]);

  const adminCount = state.members.filter((member) => member.role === "admin").length;

  async function handleRoleChange(member, nextRole) {
    setPendingMemberId(member.memberId);
    setErrorMessage(null);

    const { error } = await updateMemberRole(member.memberId, nextRole);

    setPendingMemberId(null);

    if (error) {
      console.error("ユーザーの権限変更に失敗しました", error);
      setErrorMessage(resolveMembershipErrorMessage(error.type));
      return;
    }

    load();
  }

  async function handleRegenerateInviteCode() {
    setInviteCodeState({ status: "submitting", code: null, error: null });

    const { inviteCode, error } = await regenerateInviteCode(companyDbId);

    if (error) {
      console.error("招待コードの再発行に失敗しました", error);
      setInviteCodeState({
        status: "error",
        code: null,
        error: resolveMembershipErrorMessage(error.type),
      });
      return;
    }

    setInviteCodeState({ status: "shown", code: inviteCode, error: null });
  }

  if (state.status === "loading") {
    return <p className="flowEmptyState">読み込み中…</p>;
  }

  if (state.status === "error") {
    return (
      <p className="flowEmptyState">
        ユーザー一覧を取得できませんでした。しばらくしてから再度お試しください。
      </p>
    );
  }

  const inviteCodeSection = usingPlatformFetch && (
    <div className="userManagementInviteCodeSection">
      <h3>招待コードの再発行</h3>
      <p>
        再発行すると、この会社の既存の招待コードは即座に無効になります。新しいコードは
        この画面にのみ一度表示され、以後は再取得できません（DBにはハッシュのみ保存されます）。
      </p>

      {inviteCodeState.status === "shown" && inviteCodeState.code && (
        <>
          <p className="settingsErrorText" role="alert">
            以下のコードは今この画面でしか表示されません。必ず控えてください。
          </p>
          <p className="authSentMessage">
            <strong>{inviteCodeState.code}</strong>
          </p>
        </>
      )}

      {inviteCodeState.status === "error" && (
        <p className="settingsErrorText">{inviteCodeState.error}</p>
      )}

      <button
        type="button"
        className="flowGhostButton"
        disabled={inviteCodeState.status === "submitting"}
        onClick={handleRegenerateInviteCode}
      >
        {inviteCodeState.status === "submitting" ? "再発行中…" : "招待コードを再発行する"}
      </button>
    </div>
  );

  if (state.members.length === 0) {
    return (
      <>
        <p className="flowEmptyState">
          ユーザー一覧を取得できませんでした（管理者権限が無い可能性があります）。
        </p>
        {inviteCodeSection}
      </>
    );
  }

  return (
    <div className="userManagementPanel">
      <p>この会社に所属するユーザーの権限を管理できます。</p>

      {errorMessage && <p className="settingsErrorText">{errorMessage}</p>}

      <div className="userManagementTableWrap">
        <table className="userManagementTable">
          <thead>
            <tr>
              <th>メールアドレス</th>
              <th>権限</th>
              <th>登録日</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {state.members.map((member) => {
              const isLastAdmin = member.role === "admin" && adminCount <= 1;
              const isPending = pendingMemberId === member.memberId;
              const nextRole = member.role === "admin" ? "user" : "admin";

              return (
                <tr key={member.memberId}>
                  <td>{member.email}</td>
                  <td>{ROLE_LABELS[member.role] || member.role}</td>
                  <td>{formatTimestamp(member.createdAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="flowGhostButton"
                      disabled={isPending || (member.role === "admin" && isLastAdmin)}
                      title={
                        member.role === "admin" && isLastAdmin
                          ? "この会社には最低1人の管理者が必要です"
                          : undefined
                      }
                      onClick={() => handleRoleChange(member, nextRole)}
                    >
                      {isPending
                        ? "更新中…"
                        : member.role === "admin"
                          ? "一般ユーザーにする"
                          : "管理者にする"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {inviteCodeSection}
    </div>
  );
}
