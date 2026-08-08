import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { fetchMyMembership } from "../data/membershipRepository";
import { readLastCompanyCode, saveLastCompanyCode, clearLastCompanyCode } from "../data/lastCompanyCodeStorage";
import { resolveCurrentCompany } from "../data/resolveCurrentCompany";

// 「現在選択中会社(currentCompany)」の状態管理（Commit 2）。
//
// ログイン確定後（AuthenticatedBotScreen.jsx配下）にだけ提供する。実際の
// 決定ロジック（0件/1件/2件以上・localStorage復元）はresolveCurrentCompany.js
// （純粋関数、Reactに依存しない）に集約し、ここではその結果をReact stateとして
// 保持し、localStorageへの保存・再読み込みの配線だけを行う。
//
// 【重要・今回のスコープ】ここで提供するのはstateだけであり、UIは一切追加しない
// （会社切替UI・ドロップダウン・「別会社に参加」導線はCommit 3以降）。
// status: "loading" | "ready" | "unpublished" | "no-membership" | "selection-required" | "error"
//   - "selection-required" … 2社以上に所属しており、かつlocalStorageに有効な
//     前回会社が無い状態。会社を選ばせるUIはまだ無いため、この状態を実際に
//     解消する導線はCommit 3以降で追加する（詳細はresolveCurrentCompany.js参照）。
const CompanyContext = createContext(null);

export function CompanyProvider({ children }) {
  const [state, setState] = useState({ status: "loading", currentCompany: null, membership: null });

  const load = useCallback(async () => {
    setState({ status: "loading", currentCompany: null, membership: null });

    const result = await resolveCurrentCompany({
      fetchMembership: fetchMyMembership,
      readLastCompanyCode,
      clearLastCompanyCode,
    });

    if (result.currentCompany) {
      saveLastCompanyCode(result.currentCompany.companyCode);
    }

    setState(result);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return <CompanyContext.Provider value={{ ...state, reload: load }}>{children}</CompanyContext.Provider>;
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
  reload: () => {},
};

export function useCompanyContext() {
  const context = useContext(CompanyContext);
  return context ?? DEFAULT_CONTEXT_VALUE;
}
