import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { parseInitialSetupExcel } from "../flow/parseInitialSetupExcel";
import ImportPreview from "./ImportPreview";

// 「初期設定Excel 正式仕様 v1」をアップロードし、解析・バリデーション・プレビューを行う。
// アップロード直後には何も確定しない。「この内容で初期設定を作成」を押すまでは
// パース結果はこのコンポーネント内のstateにとどまる。
export default function ExcelImportPanel({ onConfirm }) {
  const [status, setStatus] = useState("idle"); // idle | parsing | preview | file-error
  const [fileError, setFileError] = useState(null);
  const [parseResult, setParseResult] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const inputRef = useRef(null);

  async function handleFile(file) {
    if (!file) {
      return;
    }

    const isExcel = /\.(xlsx|xlsm)$/i.test(file.name);
    if (!isExcel) {
      setStatus("file-error");
      setFileError(".xlsx または .xlsm ファイルを選択してください。");
      return;
    }

    setStatus("parsing");
    setFileName(file.name);
    setFileError(null);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const result = parseInitialSetupExcel(workbook);
      setParseResult(result);
      setStatus("preview");
    } catch (error) {
      setStatus("file-error");
      setFileError(
        "Excelファイルを読み込めませんでした。ファイルが壊れていないか確認してください。",
      );
    }
  }

  function handleInputChange(event) {
    handleFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDraggingOver(false);
    handleFile(event.dataTransfer.files?.[0]);
  }

  function handleReselect() {
    setStatus("idle");
    setParseResult(null);
    setFileName(null);
    setFileError(null);
  }

  if (status === "preview" && parseResult) {
    return (
      <div>
        <p className="importFileName">選択したファイル: {fileName}</p>
        <ImportPreview
          parseResult={parseResult}
          onReselect={handleReselect}
          onConfirm={() =>
            onConfirm({
              company: parseResult.company,
              policies: parseResult.policies,
              expenseTypes: parseResult.expenseTypes,
              flow: parseResult.flow,
            })
          }
        />
      </div>
    );
  }

  return (
    <div className="excelImportPanel">
      <div
        className={isDraggingOver ? "importDropZone dragging" : "importDropZone"}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDraggingOver(true);
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={handleDrop}
      >
        <p>初期設定Excel（.xlsx / .xlsm）をドラッグ＆ドロップ</p>
        <p className="importDropZoneOr">または</p>
        <button type="button" className="flowGhostButton" onClick={() => inputRef.current?.click()}>
          ファイルを選択
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xlsm"
          onChange={handleInputChange}
          style={{ display: "none" }}
        />
      </div>

      {status === "parsing" && <p className="importStatusMessage">解析中です…</p>}

      {status === "file-error" && (
        <p className="importStatusMessage error">{fileError}</p>
      )}
    </div>
  );
}
