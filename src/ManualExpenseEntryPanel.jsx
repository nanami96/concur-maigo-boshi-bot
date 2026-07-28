import { useState } from "react";

const EMPTY_FORM_VALUES = { transactionDate: "", merchantName: "", totalAmount: "" };

// フォームの入力値を、src/ReceiptOcrPanel.jsxのonConfirmが渡すのと全く同じ
// 形（{ transactionDate, merchantName, totalAmount, currencyCode }）へ変換する。
// DOM描画テスト基盤がこのプロジェクトに無いため（src/ConcurRegistrationPanel.jsx
// と同じ方針）、この変換ロジックだけをexportして直接テストできるようにする。
export function buildManualExpenseReceiptData(formValues, currencyCode) {
  return {
    transactionDate: formValues.transactionDate || null,
    merchantName: formValues.merchantName.trim() || null,
    totalAmount: formValues.totalAmount === "" ? null : Number(formValues.totalAmount),
    currencyCode: currencyCode.trim() || null,
  };
}

// 領収書が不要な経費タイプ向けの、利用日・金額・通貨・店舗名の手入力UI。
// src/ReceiptOcrPanel.jsxの確認フォーム（review phase）と同じ入力項目・
// 同じCSSクラス（.receiptOcr*）をそのまま使い、見た目を揃える。両者は
// 同じ「領収書欄」の中で常に排他的に表示される（BotConversation.jsxの
// showReceiptOcr / showManualExpenseEntryはreceiptRequiredの値により
// 分岐し、同時にtrueになることは無い）ため、あえて別のデザインシステムを
// 用意する理由が無い。新しいCSSクラスの追加は行っていない。
//
// OCR（Azure AI Document Intelligence）・ReceiptOcrPanel.jsxとは意図的に
// 一切importし合わない、ただの手入力フォーム。確定した内容はonConfirmへ、
// ReceiptOcrPanel.jsxのonConfirmと全く同じ形
// （{ transactionDate, merchantName, totalAmount, currencyCode }）で渡すため、
// 呼び出し側（BotConversation.jsx）はOCR由来か手入力由来かを区別せず、
// 同じreceiptData stateへそのまま格納できる
// （src/lib/concurRegistrationData.jsのbuildConcurRegistrationData()から見ても
// 両者の違いを意識する必要が無い）。
//
// ReceiptOcrPanel.jsxと違い、撮影・解析のような重い操作を伴わないため、
// 「開始前のidle状態」は設けず、常に入力フォームを表示する
// （表示するかどうか自体はBotConversation.jsx側のshowManualExpenseEntryが
// 既に判定済みのため、ここでは入力の手間を増やさないことを優先する）。
export default function ManualExpenseEntryPanel({ onConfirm, defaultCurrencyCode = "JPY" }) {
  const [formValues, setFormValues] = useState(EMPTY_FORM_VALUES);
  const [currencyCode, setCurrencyCode] = useState(defaultCurrencyCode);
  const [confirmed, setConfirmed] = useState(false);

  function handleFieldChange(field, value) {
    setFormValues((current) => ({ ...current, [field]: value }));
  }

  function handleConfirm() {
    onConfirm?.(buildManualExpenseReceiptData(formValues, currencyCode));
    setConfirmed(true);
  }

  function handleEditConfirmed() {
    setConfirmed(false);
  }

  return (
    <div className="receiptOcrSection">
      <div className="receiptOcrCard">
        <h3 className="receiptOcrHeading">利用日・金額の入力</h3>
        <p className="receiptOcrHint">
          この経費タイプは領収書の添付が不要です。利用日・金額等を入力してください。
        </p>

        <div className="receiptOcrFieldGrid">
          <label className="receiptOcrField">
            <span className="receiptOcrFieldLabel">利用日</span>
            <input
              type="date"
              className="receiptOcrInput"
              value={formValues.transactionDate}
              disabled={confirmed}
              onChange={(event) => handleFieldChange("transactionDate", event.target.value)}
            />
          </label>

          <label className="receiptOcrField">
            <span className="receiptOcrFieldLabel">支払先</span>
            <input
              type="text"
              className="receiptOcrInput"
              value={formValues.merchantName}
              disabled={confirmed}
              placeholder="任意"
              onChange={(event) => handleFieldChange("merchantName", event.target.value)}
            />
          </label>

          <label className="receiptOcrField">
            <span className="receiptOcrFieldLabel">金額</span>
            <input
              type="number"
              inputMode="numeric"
              className="receiptOcrInput"
              value={formValues.totalAmount}
              disabled={confirmed}
              onChange={(event) => handleFieldChange("totalAmount", event.target.value)}
            />
          </label>

          <label className="receiptOcrField">
            <span className="receiptOcrFieldLabel">通貨</span>
            <input
              type="text"
              className="receiptOcrInput"
              value={currencyCode}
              disabled={confirmed}
              maxLength={3}
              onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())}
            />
          </label>
        </div>

        {!confirmed ? (
          <div className="receiptOcrActions">
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
      </div>
    </div>
  );
}
