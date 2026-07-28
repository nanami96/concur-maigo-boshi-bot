import { buildConcurRegistrationData } from "./lib/concurRegistrationData";

// Concur「Quick Expense」登録前に、登録予定の内容をユーザーへ確認表示する
// ためだけの表示専用コンポーネント（Commit B）。送信処理・API呼び出しは
// 一切持たない。「Concurに登録」ボタン・createQuickExpense()呼び出しは
// 将来のCommit Cで追加する想定で、今回はまだ実装しない。
//
// src/ReceiptOcrPanel.jsxと同じく、既存の質問フロー・経費タイプ判定
// （src/engine/QuestionEngine.js）とは意図的に一切importし合わない、
// 完全に疎結合なコンポーネントとして作る。経費タイプ名・ポリシー名は
// 自分で再解決せず、呼び出し側（BotConversation.jsx）が既に結果画面表示用に
// 計算済みの値（expenseTypeName・policyName）をそのまま受け取るだけにする
// （内部IDから名称を再変換する不要なmappingを増やさないため）。
//
// buildConcurRegistrationData()（src/lib/concurRegistrationData.js）の呼び出しは
// このコンポーネント自身の内部で行う（ReceiptOcrPanel.jsxがanalyzeReceiptImage()
// を自身の内部で呼ぶのと同じ構成）。company/result/receiptDataのいずれかが
// 不足している、またはConcur側マッピングがまだ見つからない場合（現時点では
// 本番マッピングデータ自体が存在しない。BotConversation.jsx参照）等の理由で
// 中間データの生成に失敗した場合は、エラーコードを画面へ出さず、単に何も
// 描画しない（null）。これにより、呼び出し側は分岐ロジックを持つ必要が無く、
// 既存の結果画面はそのまま変わらずに表示され続ける
// （要件：validation error時に画面をクラッシュさせない・既存画面へ留める）。
export default function ConcurRegistrationPanel({
  company,
  result,
  receiptData,
  mappings,
  expenseTypeName,
  policyName,
}) {
  const { result: registrationData, error } = buildConcurRegistrationData({
    company,
    result,
    receiptData,
    mappings,
  });

  if (error || !registrationData) {
    return null;
  }

  return (
    <div className="concurRegistrationSection">
      <div className="concurRegistrationCard">
        <h3 className="concurRegistrationHeading">Concurへの登録内容を確認</h3>
        <p className="concurRegistrationHint">
          この内容でConcurへ登録予定です。まだ登録は行われていません。内容に誤りがある場合は、上の内容を修正してください。
        </p>

        <dl className="concurRegistrationFieldGrid">
          <div className="concurRegistrationField">
            <dt className="concurRegistrationFieldLabel">経費タイプ</dt>
            <dd className="concurRegistrationFieldValue">
              {resolveExpenseTypeNameDisplay(expenseTypeName)}
            </dd>
          </div>

          {policyName && (
            <div className="concurRegistrationField">
              <dt className="concurRegistrationFieldLabel">ポリシー</dt>
              <dd className="concurRegistrationFieldValue">{policyName}</dd>
            </div>
          )}

          <div className="concurRegistrationField">
            <dt className="concurRegistrationFieldLabel">利用日</dt>
            <dd className="concurRegistrationFieldValue">
              {formatTransactionDate(registrationData.transactionDate)}
            </dd>
          </div>

          <div className="concurRegistrationField">
            <dt className="concurRegistrationFieldLabel">金額</dt>
            <dd className="concurRegistrationFieldValue">
              {formatAmount(registrationData.amount, registrationData.currencyCode)}
            </dd>
          </div>

          <div className="concurRegistrationField">
            <dt className="concurRegistrationFieldLabel">店舗名／支払先</dt>
            <dd className="concurRegistrationFieldValue">
              {resolveVendorNameDisplay(registrationData.vendorName)}
            </dd>
          </div>

          <div className="concurRegistrationField">
            <dt className="concurRegistrationFieldLabel">領収書</dt>
            <dd className="concurRegistrationFieldValue">
              {formatReceiptRequired(registrationData.receiptRequired)}
            </dd>
          </div>

          {registrationData.memo && (
            <div className="concurRegistrationField">
              <dt className="concurRegistrationFieldLabel">コメント</dt>
              <dd className="concurRegistrationFieldValue">{registrationData.memo}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}

// 以下の表示整形関数は、DOM描画を伴うコンポーネントテスト基盤
// （React Testing Library等）がこのプロジェクトに無いため
// （既存のtests/配下は全て純粋関数のユニットテストのみで構成されている、
// tests/ocrReceiptRepository.test.js等参照）、あえてexportしてvitestから
// 直接テストできるようにしている。新しいテスト基盤の追加は今回行わない。

// "YYYY-MM-DD" → "2026年7月29日"のような自然な日本語表示にする。
// buildConcurRegistrationData()が成功している時点でtransactionDateは
// 常にこの形式の文字列のはずだが（src/lib/concurExpenseData.jsの
// バリデーション参照）、想定外の値が来ても例外にせず、素の値を返す。
export function formatTransactionDate(transactionDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(transactionDate || "");
  if (!match) {
    return transactionDate || "未入力";
  }
  const [, year, month, day] = match;
  return `${year}年${Number(month)}月${Number(day)}日`;
}

// JPYの場合は「3,500円」のような表示にする。他通貨は桁区切り数値＋
// 通貨コードの表示に留める（Concur側の正式な通貨表示仕様は未確定のため、
// それ以上は作り込まない）。
export function formatAmount(amount, currencyCode) {
  if (typeof amount !== "number" || Number.isNaN(amount)) {
    return "未入力";
  }

  const formattedNumber = new Intl.NumberFormat("ja-JP").format(amount);

  if (currencyCode === "JPY") {
    return `${formattedNumber}円`;
  }

  return currencyCode ? `${formattedNumber} ${currencyCode}` : formattedNumber;
}

export function formatReceiptRequired(receiptRequired) {
  if (receiptRequired === true) {
    return "必要";
  }
  if (receiptRequired === false) {
    return "不要";
  }
  return "未設定";
}

export function resolveVendorNameDisplay(vendorName) {
  return vendorName || "未入力";
}

export function resolveExpenseTypeNameDisplay(expenseTypeName) {
  return expenseTypeName || "未設定";
}
