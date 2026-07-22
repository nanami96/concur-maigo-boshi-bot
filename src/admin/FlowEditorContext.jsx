import { createContext, useContext } from "react";

// FlowOutlineEditor配下の再帰コンポーネント（質問カード・選択肢行・結果フォーム）へ、
// props をバケツリレーせずに editor 操作・設定チェック結果・確認モーダルを配る。
const FlowEditorContext = createContext(null);

export function FlowEditorProvider({ value, children }) {
  return (
    <FlowEditorContext.Provider value={value}>{children}</FlowEditorContext.Provider>
  );
}

export function useFlowEditorContext() {
  const context = useContext(FlowEditorContext);

  if (!context) {
    throw new Error("useFlowEditorContext は FlowEditorProvider の内側で使ってください。");
  }

  return context;
}
