import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { availableCompanies, getConfig } from "@configSource";
import { buildFlowFromConfig } from "../flow/buildFlowFromConfig";
import { normalizeFlow } from "../flow/normalizeFlow";
import { useWorkspaceEditor } from "./useWorkspaceEditor";
import { useDraftSave } from "./useDraftSave";
import { usePublish } from "./usePublish";
import { isSupabaseConfigured } from "../lib/supabaseClient";
import {
  getCompanyDbId,
  fetchDraft,
  fetchMyCompanies,
  resolveInitialWorkspaceState,
  mapDraftRowToWorkspaceState,
} from "../data/draftConfigRepository";
import { fetchIsPlatformAdmin, fetchPlatformCompanies } from "../data/membershipRepository";
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
import UserManagementPanel from "./UserManagementPanel";
import CreatePlatformCompanyScreen from "./CreatePlatformCompanyScreen";

const NEW_COMPANY_ID = "__new__";

const SECTIONS = [
  { id: "settings", label: "設定" },
  { id: "flow", label: "質問フロー" },
  { id: "users", label: "ユーザー管理" },
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
  companyDbId,
  isPlatformAdmin,
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

      {section === "users" && (
        <div className="adminTabPanel adminTabPanelStandalone">
          <UserManagementPanel
            companyDbId={isPlatformAdmin ? companyDbId : null}
            isPlatformAdmin={Boolean(isPlatformAdmin)}
          />
        </div>
      )}
    </>
  );
}

// initialState.flowに対して常にnormalizeFlowを通してから使う。
//
// buildFlowFromConfigは静的config.json→flow変換時にoption.idの欠損・重複をその場で
// 修復するが、これは新規変換時にしか効かない。draft_configs（Supabase）から読み込んだ
// flowはbuildFlowFromConfigを経由しないため、過去に（修正前のロジック等で）option.idが
// 欠損・重複したまま保存されてしまったflowは、変換ロジックを直しただけでは自動的に
// 直らない。そのため、静的config由来・draft由来を問わず、useWorkspaceEditorへ渡す
// 直前のこの1箇所で必ずnormalizeFlowを通し、発生源に関わらず安全な状態を保証する。
function normalizeInitialState(initialState) {
  if (!initialState) {
    return { initialState: null, flowIssues: [] };
  }

  const { flow, issues } = normalizeFlow(initialState.flow);

  if (issues.length > 0) {
    console.warn("この会社の質問フローに不整合が見つかったため、自動的に修復しました:", issues);
  }

  return { initialState: { ...initialState, flow }, flowIssues: issues };
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
//
// 「下書きも静的configも無い」場合（例：Supabaseへ会社を新規登録した直後で、
// まだ誰も設定を作っていない会社）は、従来は行き止まりの案内文だけを表示していたが、
// ＋新しい会社を作成のときと同じInitialSetupScreen（一から作成／Excelインポート）へ
// 安全に誘導する。ただしこちらは「既に登録済みの会社（companyId）」への初期設定なので、
// InitialSetupScreenが内部で生成するcompany_idは使わず、常に既存のcompanyIdへ
// 上書きしてから使う（保存先の会社コードは既に確定しているため）。
function CompanyEditor({ companyId, isPlatformAdmin, onPersistenceChange }) {
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

  const [resolved, setResolved] = useState({
    status: "loading",
    initialState: null,
    initialUpdatedAt: null,
    flowIssues: [],
    companyDbId: null,
  });
  const [manualSetup, setManualSetup] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setResolved({
      status: "loading",
      initialState: null,
      initialUpdatedAt: null,
      flowIssues: [],
      companyDbId: null,
    });
    setManualSetup(null);

    async function load() {
      const { id: companyDbId, error: companyError } = await getCompanyDbId(companyId);
      if (cancelled) {
        return;
      }

      if (companyError || !companyDbId) {
        setResolved({
          status: "done",
          ...normalizeInitialState(staticInitialState),
          initialUpdatedAt: null,
          companyDbId: null,
        });
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

      setResolved({
        status: "done",
        ...normalizeInitialState(initialState),
        initialUpdatedAt,
        companyDbId,
      });
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [companyId, staticInitialState]);

  if (resolved.status === "loading") {
    return <p className="flowEmptyState">読み込み中…</p>;
  }

  if (manualSetup) {
    return (
      <AdminWorkspace
        initialState={manualSetup.initialState}
        initialSection={manualSetup.initialSection}
        initialSettingsTab={manualSetup.initialSettingsTab}
        companyCode={companyId}
        companyDbId={resolved.companyDbId}
        isPlatformAdmin={isPlatformAdmin}
        onPersistenceChange={onPersistenceChange}
      />
    );
  }

  if (!resolved.initialState) {
    return (
      <InitialSetupScreen
        onSetupComplete={(bundle, options = {}) => {
          setManualSetup({
            initialState: {
              company: { ...bundle.company, company_id: companyId },
              policies: bundle.policies || [],
              expenseTypes: bundle.expenseTypes || [],
              flow: bundle.flow,
            },
            initialSection: options.initialSection,
            initialSettingsTab: options.initialSettingsTab,
          });
        }}
      />
    );
  }

  return (
    <>
      {resolved.flowIssues.length > 0 && (
        <p className="flowConfigWarningBanner" role="alert">
          ⚠ この会社の質問フローの一部データに不整合が見つかったため、自動的に修復しました。「質問フロー」タブで内容をご確認のうえ、必要な箇所を設定し直して保存してください。
        </p>
      )}
      <AdminWorkspace
        initialState={resolved.initialState}
        companyCode={companyId}
        companyDbId={resolved.companyDbId}
        isPlatformAdmin={isPlatformAdmin}
        initialUpdatedAt={resolved.initialUpdatedAt}
        onPersistenceChange={onPersistenceChange}
      />
    </>
  );
}

export default function AdminRoot() {
  // このユーザーがplatform_admin（サービス運営者、全社を横断管理できる）かどうか。
  // Supabase未設定（ローカル開発）時は常にfalse固定とし、ローカル開発の挙動
  // （静的configの一覧をそのまま使う、Phase 7以前と同じ体験）を一切変えない。
  // Supabase設定時はis_platform_admin() RPCの結果が届くまでnull（未確定）。
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(() =>
    isSupabaseConfigured ? null : false,
  );

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return;
    }

    let cancelled = false;

    fetchIsPlatformAdmin().then(({ isPlatformAdmin: value, error }) => {
      if (cancelled) {
        return;
      }
      if (error) {
        console.error("platform_admin判定の取得に失敗しました", error);
        setIsPlatformAdmin(false);
        return;
      }
      setIsPlatformAdmin(value);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // 管理画面の会社一覧は、以下の優先順位でソースを切り替える：
  //   ・Supabase未設定（ローカル開発） … 従来通りconfigSource側の静的一覧
  //   ・platform_admin                … list_platform_companies()（全社）
  //   ・通常admin                     … fetchMyCompanies()（自分が所属する1社のみ）
  // isPlatformAdminがまだ未確定（null）の間は、どちらのソースを使うべきか
  // 決まらないため、company一覧の取得自体を保留する（後述のuseEffectの
  // 依存配列にisPlatformAdminを含めている）。
  //
  // company一覧の取得は非同期なので、companyIdの初期値は「一覧が既に同期的に
  // 確定している場合（Supabase未設定時）だけ」その場で決め、それ以外
  // （Supabase設定時）はnull（未決定）から始めて、一覧が届いた最初の1回だけ
  // 自動選択する（後述のuseEffect）。
  const [myCompaniesState, setMyCompaniesState] = useState(() =>
    isSupabaseConfigured
      ? { status: "loading", companies: [] }
      : { status: "ready", companies: availableCompanies },
  );
  const [companyId, setCompanyId] = useState(() =>
    isSupabaseConfigured ? null : availableCompanies[0]?.id ?? null,
  );
  const [customSetup, setCustomSetup] = useState(null);
  const [showCreateCompanyScreen, setShowCreateCompanyScreen] = useState(false);

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

  useEffect(() => {
    if (!isSupabaseConfigured || isPlatformAdmin === null) {
      return;
    }

    let cancelled = false;
    const fetchCompanies = isPlatformAdmin ? fetchPlatformCompanies : fetchMyCompanies;

    fetchCompanies().then(({ companies, error }) => {
      if (cancelled) {
        return;
      }

      if (error) {
        console.error("会社一覧の取得に失敗しました", error);
        setMyCompaniesState({ status: "error", companies: [] });
        return;
      }

      setMyCompaniesState({ status: "ready", companies });
    });

    return () => {
      cancelled = true;
    };
  }, [isPlatformAdmin]);

  // 所属会社一覧が確定した最初の1回だけ、初期表示する会社を自動選択する
  // （companyIdがまだnull＝未決定の間だけ動く。以降にこの一覧が更新されても
  // 既にユーザーが選択・新規作成モードへ進んだ選択を勝手に上書きしない）。
  useEffect(() => {
    if (myCompaniesState.status !== "ready" || companyId !== null) {
      return;
    }

    if (myCompaniesState.companies.length > 0) {
      setCompanyId(myCompaniesState.companies[0].id);
    }
  }, [myCompaniesState, companyId]);

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

  // 「＋新しい会社を作成」の挙動はSupabase未設定（ローカル開発）かplatform_adminかで
  // 完全に分かれる：
  //   ・Supabase未設定（ローカル開発） … 従来通り、その場限りのローカルセットアップ
  //     （customSetup, NEW_COMPANY_ID）。DBには一切書き込まない。
  //   ・platform_admin                … CreatePlatformCompanyScreenを開き、
  //     create_platform_company() RPCで実際にDBへ会社を作成する。
  // 通常admin（isPlatformAdmin === false）はそもそもshowCreateNewCompanyがfalseで
  // このボタン自体が表示されないため、ここに到達しない。
  const handleStartNewCompany = () => {
    guardedNavigate(() => {
      if (isSupabaseConfigured && isPlatformAdmin) {
        setShowCreateCompanyScreen(true);
        return;
      }
      setCustomSetup(null);
      setCompanyId(NEW_COMPANY_ID);
    });
  };

  // platform_adminが新しい会社を作成し終えた直後：作成画面を閉じ、会社一覧を
  // 再取得したうえで、作成した会社を管理対象として選択する。新しい会社にはまだ
  // 下書きが無いため、CompanyEditorは自然にInitialSetupScreenを表示する
  // （既存のロジックをそのまま再利用。新規作成専用の特別処理はしない）。
  const handlePlatformCompanyCreated = (createdCompany) => {
    setShowCreateCompanyScreen(false);
    setCompanyId(createdCompany.companyCode);
    fetchPlatformCompanies().then(({ companies, error }) => {
      if (error) {
        console.error("会社一覧の再取得に失敗しました", error);
        return;
      }
      setMyCompaniesState({ status: "ready", companies });
    });
  };

  const handleCancelCreateCompany = () => {
    setShowCreateCompanyScreen(false);
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
  const isCompanyListLoading = myCompaniesState.status === "loading";
  const companyListFailed = myCompaniesState.status === "error";
  const myCompanies = myCompaniesState.companies;
  const hasNoCompanies = myCompaniesState.status === "ready" && myCompanies.length === 0;

  // Phase 7（1ユーザー1社をDBのunique制約で保証）以降、実際のSupabase運用では
  // 1人のadminが複数社へ所属することは無くなった。そのため、会社セレクタ・
  // 「＋新しい会社を作成」は実運用のadminにとって選ぶ余地・使いどころの無いUIになる
  // （fetchMyCompaniesは常に0〜1件しか返らない）。
  // ローカル開発（Supabase未設定）では、configSource.local.jsの静的一覧を使った
  // 複数会社の切り替え・新規セットアップの検証が引き続き必要なため、
  // isSupabaseConfiguredの時だけ非表示にする（ローカル開発の挙動は変更しない）。
  // platform_adminは会社数に関わらず常にセレクタ・新規作成ボタンの両方を表示する
  // （全社を横断管理する権限があるため）。通常adminは従来通り、実運用では
  // 常に0〜1件しか返らないfetchMyCompaniesの結果に応じて自動的に隠れる。
  const showCompanySelector = !isSupabaseConfigured || isPlatformAdmin || myCompanies.length > 1;
  const showCreateNewCompany = !isSupabaseConfigured || isPlatformAdmin;

  return (
    <main className="appShell adminShell">
      <header className="appHeader">
        <div>
          <p className="eyebrow">Concur迷子防止Bot</p>
          <h1>管理画面</h1>
          <p>会社ごとの設定や質問フローを編集できます。</p>
        </div>
        <div className="headerActions">
          {showCompanySelector && (
            <label className="companySelector">
              <span className="companySelectorLabel">会社</span>
              <span className="companySelectWrap">
                <select
                  aria-label="会社を選択"
                  value={isNewCompanyMode || companyId === null ? "" : companyId}
                  onChange={handleCompanyChange}
                  disabled={isCompanyListLoading}
                >
                  {(isNewCompanyMode || companyId === null) && (
                    <option value="">
                      {isNewCompanyMode ? "（新規セットアップ中）" : isCompanyListLoading ? "読み込み中…" : "－"}
                    </option>
                  )}
                  {myCompanies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.label}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          )}
          {showCreateNewCompany && (
            <button type="button" className="resetButton" onClick={handleStartNewCompany}>
              ＋ 新しい会社を作成
            </button>
          )}
          <a className="resetButton" href="#">
            利用者画面へ戻る
          </a>
        </div>
      </header>

      {showCreateCompanyScreen ? (
        <CreatePlatformCompanyScreen
          onCreated={handlePlatformCompanyCreated}
          onCancel={handleCancelCreateCompany}
        />
      ) : isNewCompanyMode ? (
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
      ) : isCompanyListLoading ? (
        <p className="flowEmptyState">読み込み中…</p>
      ) : companyListFailed ? (
        <p className="flowEmptyState">
          所属会社一覧を取得できませんでした。しばらくしてから再度お試しください。
        </p>
      ) : hasNoCompanies ? (
        <p className="flowEmptyState">
          まだどの会社にも登録されていません。管理者にご確認ください。
        </p>
      ) : companyId === null ? (
        <p className="flowEmptyState">読み込み中…</p>
      ) : (
        <CompanyEditor
          key={companyId}
          companyId={companyId}
          isPlatformAdmin={isPlatformAdmin}
          onPersistenceChange={handlePersistenceChange}
        />
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
