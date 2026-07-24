import { useEffect, useRef, useState } from "react";
import { analyzeReceiptImage } from "./data/ocrReceiptRepository";
import { resolveOcrErrorMessage } from "./receiptOcrErrorMessages";

// クライアント側の事前チェック用（Edge Function側の上限と揃えている。
// supabase/functions/ocr-receipt/index.tsのMAX_FILE_SIZE_BYTES参照）。
// ここでの上限超過チェックは、無駄なアップロード・Azure呼び出しを避けるための
// UX目的の早期フィードバックに過ぎず、最終的な制限はEdge Function側にある。
const MAX_CLIENT_FILE_SIZE_BYTES = 8 * 1024 * 1024;
const MAX_CLIENT_FILE_SIZE_MB = 8;

const EMPTY_FORM_VALUES = { transactionDate: "", merchantName: "", totalAmount: "" };

function ReceiptCameraIcon() {
  return (
    <span className="receiptOcrHeadingIcon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
        <circle cx="12" cy="13" r="3.2" />
      </svg>
    </span>
  );
}

function formatConfidence(confidence) {
  if (typeof confidence !== "number") {
    return null;
  }
  return `信頼度 ${(confidence * 100).toFixed(1)}%`;
}

// 領収書OCR（Azure AI Document Intelligence）の入口〜確認UI。
//
// 既存の質問フロー・経費タイプ判定（QuestionEngine.js）とは意図的に一切
// importし合わない完全に疎結合なコンポーネント。ここで読み取った内容は
// 「この内容で進む」を押した時点でonConfirmへ渡すだけで、経費タイプの
// 判定ロジックへは接続しない（PoCの今回は呼び出し元がstateへ保持するのみ）。
//
// このコンポーネントは、ログイン済みユーザーのみが到達できる画面
// （BotConversation.jsxのenableReceiptOcr=trueの文脈、実質AuthenticatedBotScreen
// 経由のみ）でのみ描画される前提。Supabase未設定のローカル開発・公開デモ
// （App.jsx経由、ログイン無し）では呼び出し側がそもそもこのコンポーネントを
// レンダリングしない（BotConversation.jsx参照）。ただし、それはUI上の導線を
// 隠しているだけであり、実際の認証・権限チェックはEdge Function側
// （supabase/functions/ocr-receipt/index.ts）が最終防御として行う。
export default function ReceiptOcrPanel({ onConfirm }) {
  const [phase, setPhase] = useState("idle");
  // idle | picking | preview | analyzing | review | confirmed | error
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [ocrResult, setOcrResult] = useState(null);
  const [formValues, setFormValues] = useState(EMPTY_FORM_VALUES);
  const [errorMessage, setErrorMessage] = useState(null);

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  // Object URLはメモリリークを避けるため、fileが変わる・アンマウントされる
  // タイミングで必ずrevokeする。
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  function resetInputs() {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (cameraInputRef.current) {
      cameraInputRef.current.value = "";
    }
  }

  function handleStart() {
    setErrorMessage(null);
    setPhase("picking");
  }

  function handleCancelPicking() {
    setPhase(file ? "preview" : "idle");
  }

  function handleFileChosen(event) {
    const selected = event.target.files?.[0];
    resetInputs();

    if (!selected) {
      return;
    }

    if (!selected.type || !selected.type.startsWith("image/")) {
      setErrorMessage("対応していないファイル形式です。画像ファイル（JPEG/PNG等）を選択してください。");
      setPhase("error");
      return;
    }

    if (selected.size > MAX_CLIENT_FILE_SIZE_BYTES) {
      setErrorMessage(`ファイルサイズが大きすぎます（上限${MAX_CLIENT_FILE_SIZE_MB}MB）。`);
      setPhase("error");
      return;
    }

    setFile(selected);
    setErrorMessage(null);
    setPhase("preview");
  }

  function handleReselect() {
    setFile(null);
    setOcrResult(null);
    setFormValues(EMPTY_FORM_VALUES);
    setErrorMessage(null);
    setPhase("picking");
  }

  async function handleAnalyze() {
    if (!file || phase === "analyzing") {
      // 二重送信防止：解析中は再度呼ばれても無視する。
      return;
    }

    setPhase("analyzing");
    setErrorMessage(null);

    const { result, error } = await analyzeReceiptImage(file);

    if (error) {
      setErrorMessage(resolveOcrErrorMessage(error));
      setPhase("error");
      return;
    }

    setOcrResult(result);
    setFormValues({
      transactionDate: result.transactionDate || "",
      merchantName: result.merchantName || "",
      totalAmount: result.totalAmount != null ? String(result.totalAmount) : "",
    });
    setPhase("review");
  }

  function handleRetryAfterError() {
    setErrorMessage(null);
    setPhase(file ? "preview" : "picking");
  }

  function handleFieldChange(field, value) {
    setFormValues((current) => ({ ...current, [field]: value }));
  }

  function handleConfirm() {
    const confirmed = {
      transactionDate: formValues.transactionDate || null,
      merchantName: formValues.merchantName.trim() || null,
      totalAmount: formValues.totalAmount === "" ? null : Number(formValues.totalAmount),
      currencyCode: ocrResult?.currencyCode ?? null,
    };
    onConfirm?.(confirmed);
    setPhase("confirmed");
  }

  function handleEditConfirmed() {
    setPhase("review");
  }

  if (phase === "idle") {
    return (
      <div className="receiptOcrSection">
        <button type="button" className="receiptOcrPrimaryButton" onClick={handleStart}>
          <ReceiptCameraIcon />
          領収書を読み取る（β）
        </button>
      </div>
    );
  }

  return (
    <div className="receiptOcrSection">
      <div className="receiptOcrCard">
        <h3 className="receiptOcrHeading">
          <ReceiptCameraIcon />
          領収書の読み取り（β）
        </h3>

        {phase === "picking" && (
          <>
            <p className="receiptOcrHint">
              領収書の画像を選択してください。スマホではカメラでの撮影も選べます。
            </p>
            <div className="receiptOcrActions">
              <button
                type="button"
                className="receiptOcrPrimaryButton"
                onClick={() => fileInputRef.current?.click()}
              >
                ファイルを選択
              </button>
              <button
                type="button"
                className="receiptOcrSecondaryButton"
                onClick={() => cameraInputRef.current?.click()}
              >
                カメラで撮影
              </button>
              <button type="button" className="receiptOcrSecondaryButton" onClick={handleCancelPicking}>
                キャンセル
              </button>
            </div>
            {/* captureを付けた入力だけに統一すると、ブラウザによっては
                カメラアプリへ直行しライブラリからの選択肢が消えることがあるため、
                capture無し（多くの環境でカメラ・ライブラリ両方が選べる）と
                capture="environment"（背面カメラを優先的に開く）の2つの
                入力を用意し、ボタンとして分けて提示する。 */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChosen}
              style={{ display: "none" }}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChosen}
              style={{ display: "none" }}
            />
          </>
        )}

        {phase === "error" && (
          <>
            <p className="receiptOcrErrorText" role="alert">
              {errorMessage}
            </p>
            <div className="receiptOcrActions">
              {file && (
                <button type="button" className="receiptOcrPrimaryButton" onClick={handleRetryAfterError}>
                  もう一度試す
                </button>
              )}
              <button type="button" className="receiptOcrSecondaryButton" onClick={handleReselect}>
                別の画像を選び直す
              </button>
            </div>
          </>
        )}

        {(phase === "preview" || phase === "analyzing") && previewUrl && (
          <>
            <div className="receiptOcrPreview">
              <img src={previewUrl} alt="選択した領収書のプレビュー" className="receiptOcrPreviewImage" />
            </div>
            {phase === "analyzing" ? (
              <p className="receiptOcrStatusText">領収書を読み取っています…</p>
            ) : (
              <div className="receiptOcrActions">
                <button type="button" className="receiptOcrPrimaryButton" onClick={handleAnalyze}>
                  この画像を読み取る
                </button>
                <button type="button" className="receiptOcrSecondaryButton" onClick={handleReselect}>
                  別の画像を選び直す
                </button>
              </div>
            )}
          </>
        )}

        {(phase === "review" || phase === "confirmed") && (
          <>
            <p className="receiptOcrHint">
              内容を確認してください。読み取れなかった項目・誤りがある項目は修正できます。
            </p>

            {previewUrl && (
              <div className="receiptOcrPreview receiptOcrPreviewSmall">
                <img src={previewUrl} alt="選択した領収書のプレビュー" className="receiptOcrPreviewImage" />
              </div>
            )}

            <div className="receiptOcrFieldGrid">
              <label className="receiptOcrField">
                <span className="receiptOcrFieldLabel">利用日</span>
                <input
                  type="date"
                  className="receiptOcrInput"
                  value={formValues.transactionDate}
                  disabled={phase === "confirmed"}
                  onChange={(event) => handleFieldChange("transactionDate", event.target.value)}
                />
                {formatConfidence(ocrResult?.confidence?.transactionDate) && (
                  <span className="receiptOcrConfidence">
                    {formatConfidence(ocrResult.confidence.transactionDate)}
                  </span>
                )}
              </label>

              <label className="receiptOcrField">
                <span className="receiptOcrFieldLabel">支払先</span>
                <input
                  type="text"
                  className="receiptOcrInput"
                  value={formValues.merchantName}
                  disabled={phase === "confirmed"}
                  placeholder="未入力（読み取れませんでした）"
                  onChange={(event) => handleFieldChange("merchantName", event.target.value)}
                />
                {formatConfidence(ocrResult?.confidence?.merchantName) && (
                  <span className="receiptOcrConfidence">
                    {formatConfidence(ocrResult.confidence.merchantName)}
                  </span>
                )}
              </label>

              <label className="receiptOcrField">
                <span className="receiptOcrFieldLabel">金額</span>
                <span className="receiptOcrAmountRow">
                  <input
                    type="number"
                    inputMode="numeric"
                    className="receiptOcrInput"
                    value={formValues.totalAmount}
                    disabled={phase === "confirmed"}
                    placeholder="未入力（読み取れませんでした）"
                    onChange={(event) => handleFieldChange("totalAmount", event.target.value)}
                  />
                  <span className="receiptOcrCurrency">{ocrResult?.currencyCode || "円"}</span>
                </span>
                {formatConfidence(ocrResult?.confidence?.totalAmount) && (
                  <span className="receiptOcrConfidence">
                    {formatConfidence(ocrResult.confidence.totalAmount)}
                  </span>
                )}
              </label>
            </div>

            {phase === "review" ? (
              <div className="receiptOcrActions">
                <button type="button" className="receiptOcrSecondaryButton" onClick={handleReselect}>
                  読み直す
                </button>
                <button type="button" className="receiptOcrPrimaryButton" onClick={handleConfirm}>
                  この内容で進む
                </button>
              </div>
            ) : (
              <div className="receiptOcrActions">
                <p className="receiptOcrConfirmedNote">この内容を記録しました。</p>
                <button type="button" className="receiptOcrSecondaryButton" onClick={handleEditConfirmed}>
                  修正する
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
