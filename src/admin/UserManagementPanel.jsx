import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchMyCompanyMembers,
  fetchPlatformCompanyMembers,
  updateMemberRole,
  removeCompanyMember,
  fetchCurrentUserId,
  regenerateInviteCode,
} from "../data/membershipRepository";
import { resolveMembershipErrorMessage } from "./membershipErrorMessages";
import ConfirmDialog from "./ConfirmDialog";
import InviteCodeBox from "./InviteCodeBox";

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
// 通常admin: AdminRoot/CompanyEditorが解決した「今管理対象として選んでいる
// 会社」のcompanyDbIdを使い、fetchMyCompanyMembers(companyDbId)
// （list_my_company_members(p_company_id)）で対象会社のメンバー一覧を取得する
// （Commit 6より前は常にcompanyDbId: nullで無引数呼び出しに任せていたが、
// admin所属会社がちょうど1件の利用者しか正しく動かなかった。admin所属会社が
// 2件以上ある利用者でも、選択中の会社へ正しくスコープされるようにした）。
// 一覧取得(list_my_company_members)・role変更(update_company_member_role)の
// どちらも、対象会社のadminであることの検証・最後のadmin降格の拒否をRPC側
// （DB側）で行っており、ここでのクライアント側チェックはあくまでUXのための
// 早期フィードバックに過ぎない（最終的なセキュリティ境界はRPC/RLS側にある）。
//
// platform_admin（companyDbId指定あり）: AdminRoot/CompanyEditorが解決した
// 「今管理対象として選んでいる会社」のuuidを受け取り、list_platform_company_members
// で任意の会社のメンバー一覧を取得する。role変更は通常admin用のupdateMemberRoleを
// そのまま使い回せる（update_company_member_role自体がis_platform_admin() OR
// 対象会社のadminという条件でDB側検証しているため、呼び出し方を変える必要が無い）。
// 招待コードの再発行(regenerate_invite_code)はplatform_admin専用の操作としてのみ
// ここに表示する。
//
// 「会社から削除」（remove_company_member）：company_membersの対象行だけを削除する
// 操作で、Supabase Authのアカウント自体（auth.users）は一切削除しない
// （詳細はsupabase/schema.sqlのremove_company_member()コメント参照）。
// 自分自身の行・最後のadminの行はRPC側で拒否されるため、UI側（isSelf・
// isLastAdminによるdisabled制御）はあくまでUXのための早期フィードバックに過ぎない。
export default function UserManagementPanel({
  companyDbId = null,
  isPlatformAdmin = false,
  // ヘッダーの「会社を管理」＞「招待コードを再発行」ショートカット
  // （AdminRoot.jsx→AdminWorkspace経由）から使う。true になったら招待コード
  // 再発行セクションまでスクロール・フォーカスし、完了したら
  // onScrolledToInviteCode()を呼んで呼び出し元のフラグを倒してもらう
  // （このコンポーネント自身はタブ切り替えのたびにmount/unmountされるため、
  // 「既に処理済みか」をこのコンポーネント内だけでは覚えておけない。
  // そのため状態はAdminWorkspace側に持たせ、ここでは渡された指示に
  // 従うだけにしている）。
  shouldScrollToInviteCode = false,
  onScrolledToInviteCode,
}) {
  const [state, setState] = useState({ status: "loading", members: [] });
  const [pendingMemberId, setPendingMemberId] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [removeRequest, setRemoveRequest] = useState(null);
  const inviteCodeSectionRef = useRef(null);
  const inviteCodeHeadingRef = useRef(null);
  const [currentUserId, setCurrentUserId] = useState(null);
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
      : await fetchMyCompanyMembers(companyDbId);

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
    setErrorMessage(null);
    setSuccessMessage(null);
  }, [load]);

  // 「会社から削除」ボタンを自分自身の行に表示しない（disabledにする）ための
  // UI用の判定にのみ使う。会社選択（companyDbId）が変わることはない値なので
  // 依存配列は空でよい（ログイン中に自分自身のuser_idが変わることはない）。
  useEffect(() => {
    let cancelled = false;
    fetchCurrentUserId().then(({ userId }) => {
      if (!cancelled) {
        setCurrentUserId(userId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ショートカットからの遷移直後は、state.statusがまだ"loading"で
  // 招待コード再発行セクション自体がDOMにまだ無い（下のstate.status==="loading"の
  // 早期returnを参照）。固定時間のsetTimeoutで「待ったつもり」にするのではなく、
  // 一覧取得が完了しセクションが実際に描画されたこと（state.status変化）を
  // 検知してからscrollIntoViewする。取得が"error"に倒れた場合はスクロール対象
  // 自体が存在しないため、その場合も（何もせず）指示を消費済み扱いにする。
  useEffect(() => {
    if (!shouldScrollToInviteCode || state.status === "loading") {
      return;
    }

    const sectionElement = inviteCodeSectionRef.current;
    if (sectionElement) {
      sectionElement.scrollIntoView({ behavior: "smooth", block: "start" });
      sectionElement.classList.add("flowJumpHighlight");
      window.setTimeout(() => sectionElement.classList.remove("flowJumpHighlight"), 1500);
      inviteCodeHeadingRef.current?.focus();
    }

    onScrolledToInviteCode?.();
  }, [shouldScrollToInviteCode, state.status, onScrolledToInviteCode]);

  const adminCount = state.members.filter((member) => member.role === "admin").length;

  async function handleRoleChange(member, nextRole) {
    setPendingMemberId(member.memberId);
    setErrorMessage(null);
    setSuccessMessage(null);

    const { error } = await updateMemberRole(member.memberId, nextRole);

    setPendingMemberId(null);

    if (error) {
      console.error("ユーザーの権限変更に失敗しました", error);
      setErrorMessage(resolveMembershipErrorMessage(error.type));
      return;
    }

    load();
  }

  function handleRemoveClick(member) {
    setErrorMessage(null);
    setSuccessMessage(null);
    setRemoveRequest({
      member,
      title: "このユーザーを会社から削除しますか？",
      message: `${member.email} をこの会社から削除します。`,
      note: "この操作を行うと、この会社のBotや管理画面を利用できなくなります。この会社への所属のみ解除され、ログイン情報は削除されません。",
      confirmLabel: "会社から削除",
    });
  }

  function handleCancelRemove() {
    setRemoveRequest(null);
  }

  async function handleConfirmRemove() {
    const member = removeRequest?.member;
    setRemoveRequest(null);

    if (!member) {
      return;
    }

    setPendingMemberId(member.memberId);
    setErrorMessage(null);
    setSuccessMessage(null);

    const { error } = await removeCompanyMember(member.memberId);

    setPendingMemberId(null);

    if (error) {
      console.error("ユーザーの削除に失敗しました", error);
      setErrorMessage(resolveMembershipErrorMessage(error.type));
      return;
    }

    setSuccessMessage("ユーザーを会社から削除しました。");
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
    <div className="userManagementInviteCodeSection" ref={inviteCodeSectionRef}>
      {/* tabIndex={-1}：スクリプトからfocus()できるが、通常のTab移動では
          素通りする（見出しがTab順に割り込まない）。ヘッダーの「招待コードを
          再発行」ショートカット経由でここへ来た利用者に、スクリーンリーダー等でも
          「今ここに来た」ことが伝わるようにするためだけの用途。 */}
      <h3 ref={inviteCodeHeadingRef} tabIndex={-1}>
        招待コードの再発行
      </h3>
      <p>
        再発行すると、この会社の既存の招待コードは即座に無効になります。新しいコードは
        この画面にのみ一度表示され、以後は再取得できません（DBにはハッシュのみ保存されます）。
      </p>

      {inviteCodeState.status === "shown" && inviteCodeState.code && (
        <>
          <p className="settingsErrorText" role="alert">
            以下のコードは今この画面でしか表示されません。必ず控えてください。
          </p>
          <InviteCodeBox code={inviteCodeState.code} />
        </>
      )}

      {inviteCodeState.status === "error" && (
        <p className="settingsErrorText">{inviteCodeState.error}</p>
      )}

      <button
        type="button"
        className="importConfirmButton"
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
      {successMessage && <p className="authSentMessage">{successMessage}</p>}

      {inviteCodeSection}

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
              const isSelf = Boolean(currentUserId) && member.userId === currentUserId;
              const nextRole = member.role === "admin" ? "user" : "admin";

              const removeDisabledReason = isSelf
                ? "自分自身は会社から削除できません"
                : isLastAdmin
                  ? "この会社には最低1人の管理者が必要です"
                  : undefined;

              return (
                <tr key={member.memberId}>
                  <td>{member.email}</td>
                  <td>{ROLE_LABELS[member.role] || member.role}</td>
                  <td>{formatTimestamp(member.createdAt)}</td>
                  <td>
                    <div className="userManagementActions">
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
                      <button
                        type="button"
                        className="dangerGhostButton"
                        disabled={isPending || isSelf || isLastAdmin}
                        title={removeDisabledReason}
                        onClick={() => handleRemoveClick(member)}
                      >
                        会社から削除
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        request={removeRequest}
        onConfirm={handleConfirmRemove}
        onCancel={handleCancelRemove}
      />
    </div>
  );
}
