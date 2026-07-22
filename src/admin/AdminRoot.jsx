import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { availableCompanies, getConfig } from "@configSource";
import { buildFlowFromConfig } from "../flow/buildFlowFromConfig";
import { useWorkspaceEditor } from "./useWorkspaceEditor";
import { useDraftSave } from "./useDraftSave";
import { usePublish } from "./usePublish";
import {
  getCompanyDbId,
  fetchDraft,
  resolveInitialWorkspaceState,
  mapDraftRowToWorkspaceState,
} from "../data/draftConfigRepository";
import DraftSaveBar from "./DraftSaveBar";
import PublishPanel from "./PublishPanel";
import UnsavedChangesDialog from "./UnsavedChangesDialog";
import FlowOutlineEditor from "./FlowOutlineEditor";
import FlowTreeReadOnlyView from "./FlowTreeReadOnlyView";
import FlowPreview from "./FlowPreview";
import ConfigCheckPanel from "./ConfigCheckPanel";
import CompanySettings from "./CompanySettings";
import PolicySettings from "./PolicySettings";
import ExpenseTypeSettings from "./ExpenseTypeSettings";
import InitialSetupScreen from "./InitialSetupScreen";

const NEW_COMPANY_ID = "__new__";

const SECTIONS = [
  { id: "settings", label: "設定" },
  { id: "flow", label: "質問フロー" },
];

const SETTINGS_TABS = [
  { id: "company", label: "基本設定" },
  { id: "policies", label: "ポリシー" },
  { id: "expenseTypes", label: "経費タイプ" },
];

const FLOW_TABS = [
  { id: "editor", label: "質問フロー編集" },
  { id: "tree", label: "全体をツリーで見る" },
  { id: "preview", label: "プレビュー" },
  { id: "checks", label: "設定チェック" },
];

// 管理画面ワークスペース本体。company/policies/expenseTypes/flow を
// useWorkspaceEditor 1つで一元管理し、「設定」（基本設定・ポリシー・経費タイプ）と
// 「質問フロー」（編集・ツリー・プレビュー・設定チェック）の2階層タブで切り替える。
// baseData は毎レンダー editor の現在値から組み立てるため、経費タイプ名の変更等が
// 質問フロー編集・プレビュー・ツリー・設定チェックへ即座に反映される。
function AdminWorkspace({
  initialState,
  initialSection,
  initialSettingsTab,
  companyCode,
  initialUpdatedAt,
  onPersistenceChange,
}) {
  const editor = useWorkspaceEditor(initialState);
  const [section, setSection] = useState(initialSection || "flow");
  const [settingsTab, setSettingsTab] = useState(initialSettingsTab || "company");
  const [flowTab, setFlowTab] = useState("editor");
  const [previewStartQuestionId, setPreviewStartQuestionId] = useState(null);

  const baseData = useMemo(
    () => ({
      company: editor.company,
      policies: editor.policies,
      expenseTypes: editor.expenseTypes,
    }),
    [editor.company, editor.policies, editor.expenseTypes],
  );

  const persistence = useDraftSave({
    companyCode,
    editorState: editor,
    initialUpdatedAt,
  });

  const publish = usePublish({
    companyDbId: persistence.companyDbId,
    editorState: editor,
    isDraftDirty: persistence.isDirty,
    saveNow: persistence.saveNow,
  });

  const [revertStatus, setRevertStatus] = useState("idle"); // idle | loading | error
  const [revertErrorMessage, setRevertErrorMessage] = useState(null);

  // 「保存前の状態に戻す」：現在のReact stateを単純に初期値へ戻すのではなく、
  // Supabase上の「最後に保存済みの下書き」を正として再取得する
  // （他タブ・他管理者が別の内容を保存していた場合も、それが正しく反映される）。
  // 取得に失敗した場合は、現在の未保存編集を一切変更しない。
  async function handleRevertToSaved() {
    if (!persistence.companyDbId) {
      return { success: false };
    }

    setRevertStatus("loading");
    setRevertErrorMessage(null);

    const { row, error } = await fetchDraft(persistence.companyDbId);

    if (error || !row) {
      console.error("保存前の状態への復帰に失敗しました", error);
      setRevertStatus("error");
      setRevertErrorMessage(
        error?.type === "network"
          ? "通信エラーが発生しました。通信状態を確認して再度お試しください。"
          : "保存済みの下書きを取得できませんでした。しばらくしてから再度お試しください。",
      );
      return { success: false };
    }

    editor.loadState(mapDraftRowToWorkspaceState(row));
    persistence.loadCleanState(row.updated_at);
    setRevertStatus("idle");
    return { success: true };
  }

  useEffect(() => {
    onPersistenceChange?.({ isDirty: persistence.isDirty, saveNow: persistence.saveNow });
  }, [onPersistenceChange, persistence.isDirty, persistence.saveNow]);

  // 自動保存を廃止したため、未保存の変更があるままページを離れる
  // （F5・タブを閉じる・別サイトへ移動等）と編集内容が失われる可能性が
  // 従来より高くなった。dirtyな時だけブラウザ標準の離脱確認を出す
  // （#admin配下でのみ有効。Bot利用者画面(App.jsx)はこのコンポーネントを
  // 経由しないため影響しない）。
  useEffect(() => {
    function handleBeforeUnload(event) {
      if (!persistence.isDirty) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [persistence.isDirty]);

  const handleStartPreviewFrom = (questionId) => {
    setPreviewStartQuestionId(questionId);
    setSection("flow");
    setFlowTab("preview");
  };

  const handleJumpToFlowNode = ({ questionId, optionId }) => {
    setSection("flow");
    setFlowTab("editor");
    const targetId = optionId ? `fo-${optionId}` : questionId ? `fq-${questionId}` : null;

    if (!targetId) {
      return;
    }

    window.requestAnimationFrame(() => {
      const element = document.getElementById(targetId);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        element.classList.add("flowJumpHighlight");
        window.setTimeout(() => element.classList.remove("flowJumpHighlight"), 1500);
      }
    });
  };

  const handleJumpToSettings = (target) => {
    const tabByTarget = { company: "company", policies: "policies", expenseTypes: "expenseTypes" };
    setSection("settings");
    setSettingsTab(tabByTarget[target] || "company");
  };

  return (
    <>
      <DraftSaveBar
        persistence={persistence}
        onRevert={handleRevertToSaved}
        revertStatus={revertStatus}
        revertErrorMessage={revertErrorMessage}
      />
      <PublishPanel publish={publish} />

      {editor.undoMessage && (
        <div className="undoToast">
          <span>{editor.undoMessage}</span>
          <button type="button" onClick={editor.undo}>
            元に戻す
          </button>
          <button
            type="button"
            className="undoToastDismiss"
            aria-label="通知を閉じる"
            onClick={editor.dismissUndoMessage}
          >
            ×
          </button>
        </div>
      )}

      <nav className="adminSectionTabs" aria-label="設定領域の切り替え">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={section === item.id ? "adminSectionButton selected" : "adminSectionButton"}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {section === "settings" && (
        <>
          <nav className="adminTabs" aria-label="設定の切り替え">
            {SETTINGS_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={settingsTab === tab.id ? "adminTabButton selected" : "adminTabButton"}
                onClick={() => setSettingsTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="adminTabPanel">
            {settingsTab === "company" && (
              <CompanySettings editor={editor} onGoToPolicies={() => setSettingsTab("policies")} />
            )}
            {settingsTab === "policies" && <PolicySettings editor={editor} />}
            {settingsTab === "expenseTypes" && <ExpenseTypeSettings editor={editor} />}
          </div>
        </>
      )}

      {section === "flow" && (
        <>
          <nav className="adminTabs" aria-label="質問フローの切り替え">
            {FLOW_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={flowTab === tab.id ? "adminTabButton selected" : "adminTabButton"}
                onClick={() => {
                  if (tab.id === "preview") {
                    setPreviewStartQuestionId(null);
                  }
                  setFlowTab(tab.id);
                }}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="adminTabPanel">
            {flowTab === "editor" && (
              <FlowOutlineEditor
                editor={editor}
                expenseTypes={baseData.expenseTypes}
                onStartPreviewFrom={handleStartPreviewFrom}
              />
            )}

            {flowTab === "tree" && <FlowTreeReadOnlyView flow={editor.flow} baseData={baseData} />}

            {flowTab === "preview" && (
              <FlowPreview
                flow={editor.flow}
                baseData={baseData}
                startQuestionId={previewStartQuestionId}
                onClearStart={() => setPreviewStartQuestionId(null)}
              />
            )}

            {flowTab === "checks" && (
              <ConfigCheckPanel
                company={editor.company}
                policies={editor.policies}
                expenseTypes={editor.expenseTypes}
                flow={editor.flow}
                onJumpToNode={handleJumpToFlowNode}
                onJumpToSettings={handleJumpToSettings}
              />
            )}
          </div>
        </>
      )}
    </>
  );
}

// 既存会社（config.jsonがある会社）の編集。config.json→flowへの変換は
// 既存のbuildFlowFromConfigをそのまま使う。
//
// 初期状態の決定は「保存済み下書き ＞ 静的config.json ＞ なし」の優先順位。
// 下書きの有無はSupabaseへの非同期問い合わせが必要なため、
// 判明するまでは読み込み中の表示にし、AdminWorkspace（＝useWorkspaceEditor）は
// 最終的なinitialStateが決まってから初めてマウントする
// （読み込み中に一旦静的configで先にマウントしてしまうと、後から下書きに
// 差し替える際にUndo履歴が絡んで複雑になるため、最初から確定した状態で
// マウントする方針にしている）。
function CompanyEditor({ companyId, onPersistenceChange }) {
  const config = getConfig(companyId);

  const staticInitialState = useMemo(() => {
    if (!config) {
      return null;
    }
    return {
      company: config.company,
      policies: config.policies || [],
      expenseTypes: config.expenseTypes || [],
      flow: buildFlowFromConfig(config).flow,
    };
  }, [config]);

  const [resolved, setResolved] = useState({ status: "loading", initialState: null, initialUpdatedAt: null });

  useEffect(() => {
    let cancelled = false;
    setResolved({ status: "loading", initialState: null, initialUpdatedAt: null });

    async function load() {
      const { id: companyDbId, error: companyError } = await getCompanyDbId(companyId);
      if (cancelled) {
        return;
      }

      if (companyError || !companyDbId) {
        setResolved({ status: "done", initialState: staticInitialState, initialUpdatedAt: null });
        return;
      }

      const { row, error: draftError } = await fetchDraft(companyDbId);
      if (cancelled) {
        return;
      }

      const { initialState, initialUpdatedAt } = resolveInitialWorkspaceState({
        draftRow: draftError ? null : row,
        staticConfig: staticInitialState,
      });

      setResolved({ status: "done", initialState, initialUpdatedAt });
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [companyId, staticInitialState]);

  if (resolved.status === "loading") {
    return <p className="flowEmptyState">読み込み中…</p>;
  }

  if (!resolved.initialState) {
    return <p className="flowEmptyState">この会社の設定データが見つかりません。</p>;
  }

  return (
    <AdminWorkspace
      initialState={resolved.initialState}
      companyCode={companyId}
      initialUpdatedAt={resolved.initialUpdatedAt}
      onPersistenceChange={onPersistenceChange}
    />
  );
}

export default function AdminRoot() {
  const defaultCompanyId = availableCompanies[0]?.id || "sample-company";
  const [companyId, setCompanyId] = useState(defaultCompanyId);
  const [customSetup, setCustomSetup] = useState(null);

  // 現在表示中のAdminWorkspaceの「未保存の変更があるか」「今すぐ保存する関数」を
  // 参照だけしておくためのref。AdminWorkspace側のuseDraftSaveが変化するたびに
  // onPersistenceChange経由で更新される。stateではなくrefにしているのは、
  // ここが変化するたびにAdminRoot全体を再レンダーする必要はなく、会社切り替え等の
  // 操作が起きた「その瞬間」に最新値を読めれば十分なため。
  const persistenceRef = useRef({ isDirty: false, saveNow: null });
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [isNavigationSaving, setIsNavigationSaving] = useState(false);
  const [navigationSaveError, setNavigationSaveError] = useState(null);

  useEffect(() => {
    document.title = "Concur迷子防止Bot 管理画面";
  }, []);

  const handlePersistenceChange = useCallback((next) => {
    persistenceRef.current = next;
  }, []);

  // 未保存の変更がある状態で会社を切り替えよう（または新規作成を始めよう）と
  // した場合、実際の画面遷移(run)をすぐには行わず、確認ダイアログを挟む。
  const guardedNavigate = useCallback((run) => {
    if (persistenceRef.current.isDirty) {
      setNavigationSaveError(null);
      setPendingNavigation({ run });
    } else {
      run();
    }
  }, []);

  const handleCompanyChange = (event) => {
    const targetId = event.target.value;
    guardedNavigate(() => {
      setCompanyId(targetId);
      setCustomSetup(null);
    });
  };

  const handleStartNewCompany = () => {
    guardedNavigate(() => {
      setCustomSetup(null);
      setCompanyId(NEW_COMPANY_ID);
    });
  };

  const handleCancelNavigation = () => {
    setPendingNavigation(null);
    setNavigationSaveError(null);
  };

  const handleDiscardAndContinue = () => {
    const { run } = pendingNavigation;
    setPendingNavigation(null);
    setNavigationSaveError(null);
    run();
  };

  const handleSaveAndContinue = async () => {
    setIsNavigationSaving(true);
    const success = await persistenceRef.current.saveNow?.();
    setIsNavigationSaving(false);

    if (success) {
      const { run } = pendingNavigation;
      setPendingNavigation(null);
      setNavigationSaveError(null);
      run();
    } else {
      setNavigationSaveError("保存に失敗しました。もう一度お試しいただくか、保存せず移動を選んでください。");
    }
  };

  const handleSetupComplete = (bundle, options = {}) => {
    setCustomSetup({
      initialState: {
        company: bundle.company,
        policies: bundle.policies || [],
        expenseTypes: bundle.expenseTypes || [],
        flow: bundle.flow,
      },
      initialSection: options.initialSection,
      initialSettingsTab: options.initialSettingsTab,
    });
  };

  const isNewCompanyMode = companyId === NEW_COMPANY_ID;

  return (
    <main className="appShell adminShell">
      <header className="appHeader">
        <div>
          <p className="eyebrow">Concur迷子防止Bot</p>
          <h1>管理画面（検証中）</h1>
          <p>
            基本設定・ポリシー・経費タイプ・質問・選択肢・分岐・結果をここで編集できます。
          </p>
        </div>
        <div className="headerActions">
          <label className="companySelector">
            <span className="companySelectorLabel">会社</span>
            <span className="companySelectWrap">
              <select
                aria-label="会社を選択"
                value={isNewCompanyMode ? "" : companyId}
                onChange={handleCompanyChange}
              >
                {isNewCompanyMode && <option value="">（新規セットアップ中）</option>}
                {availableCompanies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.label}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <button type="button" className="resetButton" onClick={handleStartNewCompany}>
            ＋ 新しい会社を作成
          </button>
          <a className="resetButton" href="#">
            利用者画面へ戻る
          </a>
        </div>
      </header>

      {isNewCompanyMode ? (
        customSetup ? (
          <AdminWorkspace
            key="new-company-workspace"
            initialState={customSetup.initialState}
            initialSection={customSetup.initialSection}
            initialSettingsTab={customSetup.initialSettingsTab}
            companyCode={customSetup.initialState.company?.company_id}
            onPersistenceChange={handlePersistenceChange}
          />
        ) : (
          <InitialSetupScreen onSetupComplete={handleSetupComplete} />
        )
      ) : (
        <CompanyEditor key={companyId} companyId={companyId} onPersistenceChange={handlePersistenceChange} />
      )}

      {pendingNavigation && (
        <UnsavedChangesDialog
          isSaving={isNavigationSaving}
          errorMessage={navigationSaveError}
          onCancel={handleCancelNavigation}
          onDiscardAndContinue={handleDiscardAndContinue}
          onSaveAndContinue={handleSaveAndContinue}
        />
      )}
    </main>
  );
}
