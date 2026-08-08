import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { fetchMyCompanies, fetchMyMembership } from "../data/membershipRepository";
import { readLastCompanyCode, saveLastCompanyCode, clearLastCompanyCode } from "../data/lastCompanyCodeStorage";
import { resolveCurrentCompany, selectCompany as selectCompanyPure } from "../data/resolveCurrentCompany";

// 「現在選択中会社(currentCompany)」の状態管理（Commit 2で導入、Commit 3で
// companies一覧を追加、Commit 4で明示的な切替操作selectCompanyを追加）。
//
// ログイン確定後（AuthenticatedBotScreen.jsx配下）にだけ提供する。実際の
// 決定ロジック（list_my_companies()による所属会社一覧の取得・0件/1件/2件以上・
// localStorage復元・get_my_public_config()によるconfig取得・明示的な切替の
// 検証）はresolveCurrentCompany.js（純粋関数、Reactに依存しない）に集約し、
// ここではその結果をReact stateとして保持し、localStorageへの保存・
// 再読み込みの配線だけを行う。BotConversation.jsx・ConcurRegistrationPanel.jsx
// 等の呼び出し元は、Supabase RPCを直接呼ばず、必ずこのContext経由で操作する。
//
// status: "loading" | "ready" | "unpublished" | "no-membership" | "selection-required" | "error"
//   - "selection-required" … 2社以上に所属しており、かつlocalStorageに有効な
//     前回会社が無い状態。Commit 4でcompaniesを使った選択UIへ置き換える。
// companies: list_my_companies()が返した所属会社一覧（[{companyCode,
//   companyName, role}, ...]）。会社選択UIがそのまま使う。
// isSwitching: selectCompany()呼び出し中かどうか。切替中の二重操作を防ぐため
//   （UI側でselectを disabled にする等に使う）。
const CompanyContext = createContext(null);

const INITIAL_STATE = { status: "loading", currentCompany: null, membership: null, companies: [] };

export function CompanyProvider({ children }) {
  const [state, setState] = useState(INITIAL_STATE);
  const [isSwitching, setIsSwitching] = useState(false);
  // selectCompany()実行中に別のselectCompany()・reload()が呼ばれても、
  // 古い呼び出しの結果でstateを上書きしない（後勝ちのレースコンディション対策）。
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setState(INITIAL_STATE);

    const result = await resolveCurrentCompany({
      fetchCompanies: fetchMyCompanies,
      fetchMembership: fetchMyMembership,
      readLastCompanyCode,
      clearLastCompanyCode,
    });

    if (requestId !== requestIdRef.current) {
      return;
    }

    if (result.currentCompany) {
      saveLastCompanyCode(result.currentCompany.companyCode);
    }

    setState(result);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 利用者が明示的に会社を切り替える（Commit 4）。BotConversation.jsx側の
  // 会社セレクタからcompanyCode（companies[].companyCode、内部値）を渡す。
  //
  // atomicな切替：resolveCurrentCompany.js（selectCompany純粋関数）が
  // 「companiesに実在するか」「実際にconfigが取得できるか」を検証し終えた
  // 場合（status: ready/unpublished）だけstate（currentCompany/membership）を
  // 更新する。検証に失敗した場合（rejected/error）はstateを一切変更せず、
  // 直前の会社（例：A社）のまま維持する。lastCompanyCodeの保存も、切替成功が
  // 確認できてから行う（失敗した切替でlastCompanyCodeを書き換えない）。
  const selectCompany = useCallback(
    async (companyCode) => {
      const requestId = ++requestIdRef.current;
      setIsSwitching(true);

      const result = await selectCompanyPure({
        companyCode,
        companies: state.companies,
        fetchMembership: fetchMyMembership,
      });

      if (requestId !== requestIdRef.current) {
        return;
      }

      if (result.status !== "ready" && result.status !== "unpublished") {
        // rejected（companiesに存在しない・既に所属していない）・error
        // （通信エラー等）。既存のcurrentCompany/membership/companiesは
        // 一切変更しない（A社の状態を維持する）。
        console.error("会社の切り替えに失敗しました", result.status);
        setIsSwitching(false);
        return;
      }

      saveLastCompanyCode(result.currentCompany.companyCode);
      setState((prev) => ({
        status: result.status,
        currentCompany: result.currentCompany,
        membership: result.membership,
        companies: prev.companies,
      }));
      setIsSwitching(false);
    },
    [state.companies],
  );

  return (
    <CompanyContext.Provider value={{ ...state, isSwitching, reload: load, selectCompany }}>
      {children}
    </CompanyContext.Provider>
  );
}

// CompanyProviderの外（未ログイン画面・ローカル開発/デモ用のApp.jsx等）から
// 呼ばれた場合は例外を投げず、安全な既定値を返す。currentCompanyは今後
// 複数のツリーから参照される可能性があり、「必ずProvider配下で使う」ことを
// 前提にできる src/admin/FlowEditorContext.jsx の useFlowEditorContext() とは
// 事情が異なるため、ここでは意図的にthrowしない。
const DEFAULT_CONTEXT_VALUE = {
  status: "unavailable",
  currentCompany: null,
  membership: null,
  companies: [],
  isSwitching: false,
  reload: () => {},
  selectCompany: async () => {},
};

export function useCompanyContext() {
  const context = useContext(CompanyContext);
  return context ?? DEFAULT_CONTEXT_VALUE;
}
