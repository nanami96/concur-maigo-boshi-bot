import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { fetchMyCompanies, fetchMyMembership } from "../data/membershipRepository";
import { readLastCompanyCode, saveLastCompanyCode, clearLastCompanyCode } from "../data/lastCompanyCodeStorage";
import { resolveCurrentCompany } from "../data/resolveCurrentCompany";

// 「現在選択中会社(currentCompany)」の状態管理（Commit 2で導入、Commit 3で
// companies一覧を追加）。
//
// ログイン確定後（AuthenticatedBotScreen.jsx配下）にだけ提供する。実際の
// 決定ロジック（list_my_companies()による所属会社一覧の取得・0件/1件/2件以上・
// localStorage復元・get_my_public_config()によるconfig取得）は
// resolveCurrentCompany.js（純粋関数、Reactに依存しない）に集約し、ここでは
// その結果をReact stateとして保持し、localStorageへの保存・再読み込みの配線
// だけを行う。
//
// 【重要・今回のスコープ】ここで提供するのはstateだけであり、UIは一切追加しない
// （会社切替UI・ドロップダウン・「別会社に参加」導線はCommit 4以降）。
// status: "loading" | "ready" | "unpublished" | "no-membership" | "selection-required" | "error"
//   - "selection-required" … 2社以上に所属しており、かつlocalStorageに有効な
//     前回会社が無い状態。会社を選ばせるUIはまだ無いため、この状態を実際に
//     解消する導線はCommit 4以降で追加する（詳細はresolveCurrentCompany.js参照）。
// companies: list_my_companies()が返した所属会社一覧（[{companyCode,
//   companyName, role}, ...]）。Commit 4の会社選択UIがそのまま使えるように、
//   決定ロジックの副産物として保持しておく（このためだけの再フェッチはしない）。
const CompanyContext = createContext(null);

export function CompanyProvider({ children }) {
  const [state, setState] = useState({ status: "loading", currentCompany: null, membership: null, companies: [] });

  const load = useCallback(async () => {
    setState({ status: "loading", currentCompany: null, membership: null, companies: [] });

    const result = await resolveCurrentCompany({
      fetchCompanies: fetchMyCompanies,
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
  companies: [],
  reload: () => {},
};

export function useCompanyContext() {
  const context = useContext(CompanyContext);
  return context ?? DEFAULT_CONTEXT_VALUE;
}
