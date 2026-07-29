import { useState } from "react";
import ExcelImportPanel from "./ExcelImportPanel";
import { createEmptyFlow } from "../flow/flowMutations";
import { generateCompanyId } from "../flow/parseInitialSetupExcel";

// 会社データがまだ無い状態で表示する初回セットアップの入口。
// 「Excelから取り込む」「一から作成する」のどちらでも、最終的に同じ
// { company, policies, expenseTypes, flow } という形へ収束させ、以降の
// 設定（基本設定・ポリシー・経費タイプ）・質問フロー編集・プレビュー・設定チェックは
// 既存のUIをそのまま使う。
export default function InitialSetupScreen({ onSetupComplete }) {
  const [mode, setMode] = useState(null); // null | "import" | "scratch"
  const [companyName, setCompanyName] = useState("");

  function handleStartFromScratch() {
    const trimmedName = companyName.trim();
    onSetupComplete(
      {
        company: { company_id: generateCompanyId(trimmedName), company_name: trimmedName },
        policies: [],
        expenseTypes: [],
        flow: createEmptyFlow(),
      },
      { initialSection: "settings", initialSettingsTab: "policies" },
    );
  }

  if (mode === "import") {
    return (
      <div className="initialSetupScreen">
        <button type="button" className="flowGhostButton" onClick={() => setMode(null)}>
          ← 選択し直す
        </button>
        <ExcelImportPanel onConfirm={onSetupComplete} />
      </div>
    );
  }

  if (mode === "scratch") {
    return (
      <div className="initialSetupScreen">
        <button type="button" className="flowGhostButton" onClick={() => setMode(null)}>
          ← 選択し直す
        </button>
        <h2>一から設定を作成する</h2>
        <p>まず会社名を入力してください。この後、ポリシー・経費タイプ・質問の順に設定していきます。</p>

        <label className="flowFieldLabel settingsCompanyNameField">
          会社名
          <input
            type="text"
            className="settingsTextInput"
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            placeholder="例：サンプル会社"
          />
        </label>

        <button
          type="button"
          className="importConfirmButton"
          disabled={!companyName.trim()}
          onClick={handleStartFromScratch}
        >
          作成して次へ
        </button>
      </div>
    );
  }

  return (
    <div className="initialSetupScreen">
      <h2>初期セットアップ</h2>
      <p>この会社の設定はまだありません。どちらの方法で始めますか？</p>

      <div className="initialSetupChoices">
        <button type="button" className="initialSetupChoiceCard" onClick={() => setMode("import")}>
          <h3>Excelから初期設定を取り込む</h3>
          <p>
            経費タイプ・質問フロー等をまとめて作成済みのExcel（初期設定Excel
            正式仕様）がある場合はこちら。
          </p>
        </button>

        <button type="button" className="initialSetupChoiceCard" onClick={() => setMode("scratch")}>
          <h3>一から設定を作成する</h3>
          <p>Excelを使わず、管理画面だけで会社名・ポリシー・経費タイプ・質問から組み立てます。</p>
        </button>
      </div>
    </div>
  );
}
