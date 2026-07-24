import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { parseInitialSetupExcel } from "../flow/parseInitialSetupExcel";
import { detectCompanyIdMismatch } from "./excelImportForExistingCompany";
import ImportPreview from "./ImportPreview";

// 「初期設定Excel 正式仕様」をアップロードし、解析・バリデーション・プレビューを行う。
// アップロード直後には何も確定しない。確定ボタン（既定は「この内容で初期設定を作成」）を
// 押すまでは、パース結果はこのコンポーネント内のstateにとどまる。
//
// confirmLabel・noticeTextは新規会社の初期セットアップ（InitialSetupScreen.jsx）と
// 既存会社への取り込み（ExcelImportSection.jsx）で文言を差し替えるための任意
// プロパティ。currentCompanyIdを指定した場合のみ、Excel内の会社IDと比較して
// 不一致の注意文をImportPreviewに表示する（会社IDそのものを書き換える処理は
// このコンポーネントの責務ではなく、呼び出し側がonConfirmで受け取ったbundleを
// 使って行う。excelImportForExistingCompany.js参照）。
export default function ExcelImportPanel({
  onConfirm,
  confirmLabel,
  noticeText,
  currentCompanyId = null,
}) {
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
    const companyIdMismatch =
      currentCompanyId &&
      detectCompanyIdMismatch({
        parsedCompanyId: parseResult.company?.company_id,
        currentCompanyId,
      });

    return (
      <div>
        <p className="importFileName">選択したファイル: {fileName}</p>
        <ImportPreview
          parseResult={parseResult}
          onReselect={handleReselect}
          confirmLabel={confirmLabel}
          noticeText={noticeText}
          companyIdWarning={
            companyIdMismatch
              ? `Excel内の会社ID「${parseResult.company?.company_id}」は現在の会社（${currentCompanyId}）と異なりますが、会社IDは変更されません。この内容は現在の会社（${currentCompanyId}）の下書きへ取り込まれます。`
              : null
          }
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
