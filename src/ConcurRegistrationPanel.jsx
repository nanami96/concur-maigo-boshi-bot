import { useEffect, useRef, useState } from "react";
import { buildConcurRegistrationData } from "./lib/concurRegistrationData";
import { resolveConcurRegistrationErrorMessage } from "./concurRegistrationErrorMessages";
import { scrollElementIntoViewNaturally } from "./lib/scrollIntoViewNaturally";
import { getConcurUserLinkStatus } from "./data/concurUserLinkRepository";
import {
  computeRegistrationSignature,
  runConcurRegistrationSubmit,
  shouldRenderConcurRegistrationCard,
} from "./concurRegistrationSubmission";

// Concur「Quick Expense」登録前に、登録予定の内容をユーザーへ確認表示し、
// 「Concurに登録」ボタンから既存のcreateQuickExpense()
// （src/data/concurApi.js）を呼び出すコンポーネント（Commit C相当）。
//
// 【Phase 13で追加・ConcurログインIDの毎回入力を不要にする】
// get_my_concur_link_status(text) RPC（src/data/concurUserLinkRepository.js）で
// 現在の会社（companyCode）に対する紐付け状態（hasLink）を取得し、既に
// 紐付け済みならログインID入力欄を表示しない（「Concur利用者：確認済み」
// とだけ表示する）。未紐付けの場合は入力欄を表示し、「Concurに登録」押下時に
// linkConcurUser()（Identity APIで実在確認したうえでuser_id×company_id単位で
// 保存する）を先に実行してからcreateQuickExpense()を呼ぶ
// （src/concurRegistrationSubmission.jsのensureConcurUserLinked()参照）。
//

// 現時点ではsupabase/functions/create-concur-quick-expenseはConcurへの
// 実通信を一切行わないスタブ応答（{ quickExpenseId: "stub_quick_expense_id",
// status: "stubbed" }）しか返さない（createQuickExpenseStub.js参照）。この
// コンポーネントもOAuth・Concur API実通信・Secretsの追加は一切行わない
// （呼び出す先は既存のcreateQuickExpense()のみ）。
//
// スタブ応答であることを画面へ大きく表示しない理由：一般利用者向けの
// 業務画面に「スタブ」「未実装」等の開発者向けの生々しい文言を出すと、
// 利用者が実際の障害だと誤解しうるため。その代わり、コード（この
// コメント・下のhandleRegister内のDEVログ）を見れば分かるようにしている。
// 同じ理由で、成功時にquickExpenseId（現状の値は文字通り
// "stub_quick_expense_id"）自体は画面に表示しない。
//
// src/ReceiptOcrPanel.jsxと同じく、既存の質問フロー・経費タイプ判定
// （src/engine/QuestionEngine.js）とは意図的に一切importし合わない、
// 完全に疎結合なコンポーネントとして作る。経費タイプ名・ポリシー名は
// 自分で再解決せず、呼び出し側（BotConversation.jsx）が既に結果画面表示用に
// 計算済みの値（expenseTypeName・policyName）をそのまま受け取るだけにする
// （内部IDから名称を再変換する不要なmappingを増やさないため）。
//
// companyCodeについて（Commit 4で追加）：CompanyContext.jsx（currentCompany.
// companyCode）から、BotConversation.jsx経由でそのまま受け取る。
// buildConcurRegistrationData()側で、company.company_id（config埋め込みの
// 複製値）より優先してcompanyIdとして使われる（src/lib/concurRegistrationData.js
// 冒頭コメント参照）。これにより、複数社所属で会社を切り替えた直後でも、
// Quick Expenseへ送るcompanyIdが必ず「今まさに選択中の会社」と一致する
// （config自体は既にcurrentCompanyの会社のものに更新済みだが、company_id
// フィールドは万一config側の値が古い場合に備えた二重の安全策）。
//
// buildConcurRegistrationData()（src/lib/concurRegistrationData.js）の呼び出しは
// このコンポーネント自身の内部で行う（ReceiptOcrPanel.jsxがanalyzeReceiptImage()
// を自身の内部で呼ぶのと同じ構成）。経費タイプID＝Concur EXP_KEYという設計
// （正式リファクタリング）により、以前必要だった「Concur側マッピングがまだ
// 登録されていない」という失敗パターンは無くなった。company/result/receiptData
// のいずれかが不足している、または利用日・金額等のバリデーションに失敗した
// 場合は、エラーコードを画面へ出さず、単に何も描画しない（null）。これにより、
// 呼び出し側は分岐ロジックを持つ必要が無く、既存の結果画面はそのまま変わらず
// 表示され続ける（要件：validation error時に画面をクラッシュさせない・
// 既存画面へ留める）。
export default function ConcurRegistrationPanel({
  company,
  companyCode,
  result,
  receiptData,
  receiptFile,
  expenseTypeName,
  policyName,
}) {
  // ConcurログインID（このEdge Function内部でConcur Identity v4によりuserIDを
  // 解決するための入力値。userID自体はフロントから受け取らない・表示しない。
  // supabase/functions/create-concur-quick-expense/handleQuickExpenseRequest.js
  // 参照）。
  //
  // 【Phase 13で変更】以前は送信のたびに毎回入力する暫定的な項目だったが、
  // Identity APIで実在確認済みのConcurログインIDをuser_id×company_id単位で
  // 保存できるようになったため、既に紐付け済みの会社では入力欄自体を表示
  // しない（hasLink参照）。concurLoginId自体は「未紐付け・紐付け変更中」の
  // 場合にだけ意味を持つ入力値であり、保存はこのコンポーネントではなく
  // linkConcurUser()（Identity API確認後、service_role経由でDBへ保存）が行う。
  const [concurLoginId, setConcurLoginId] = useState("");

  // 【Phase 13で追加】ログイン中ユーザー自身の、この会社に対するConcurログイン
  // ID紐付け状態。null=未確認（読み込み中）、true=紐付け済み、false=未紐付け。
  // get_my_concur_link_status(text) RPCはhas_link（真偽値）しか返さない
  // （concurLoginId自体は返らない。src/data/concurUserLinkRepository.js参照）。
  const [hasLink, setHasLink] = useState(null);
  // 「Concurアカウントの紐付けを変更」導線で、紐付け済みでも改めて入力欄を
  // 表示するためのフラグ。
  const [relinking, setRelinking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHasLink(null);
    setRelinking(false);

    if (typeof companyCode !== "string" || companyCode.trim() === "") {
      return undefined;
    }

    getConcurUserLinkStatus(companyCode).then(({ result }) => {
      if (!cancelled) {
        setHasLink(Boolean(result?.hasLink));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [companyCode]);

  // hasLinkがまだ確認できていない間（null）は、安全側に倒して入力欄を表示する
  // （fail-open：紐付け済みなのに誤って再入力を求めるだけで、セキュリティ上の
  // 問題にはならない）。
  const showConcurLoginIdInput = hasLink !== true || relinking;

  const { result: registrationData, error } = buildConcurRegistrationData({
    company,
    companyCode,
    result,
    receiptData,
    receiptFile,
    concurLoginId,
  });

  // phase: idle | submitting | success | error
  const [phase, setPhase] = useState("idle");
  const [errorType, setErrorType] = useState(null);
  // 二重送信防止用の同期的なミュータブルフラグ。phase state（React管理・
  // 非同期に反映）ではなくこちらで判定する理由は
  // concurRegistrationSubmission.js冒頭コメント参照。
  const submittingRef = useRef(false);
  // このカード自身のルート要素。「Concurに登録」ボタン押下後に表示される
  // 「登録中…」「受け付けました」「エラー」の文言（下のaria-live領域）まで
  // 自動スクロールするためのスクロール先として使う。
  const panelRef = useRef(null);

  // 登録対象データ（registrationData）自体が変わった場合（例：OCR内容の
  // 修正・別の判定結果への遷移）は、以前の送信結果を引き継がず状態を
  // 初期化する。
  const registrationSignature = computeRegistrationSignature(registrationData);
  const previousSignatureRef = useRef(registrationSignature);
  // 下のphase監視スクロール用のガード。初回マウント時と、このデータ変更に
  // よるidleへのリセット時は、利用者のボタン操作ではないためスクロール
  // しない（trueにした次のphase変化を1回だけスキップする）。
  const skipNextPhaseScrollRef = useRef(true);

  useEffect(() => {
    if (previousSignatureRef.current !== registrationSignature) {
      previousSignatureRef.current = registrationSignature;
      skipNextPhaseScrollRef.current = true;
      setPhase("idle");
      setErrorType(null);
    }
  }, [registrationSignature]);

  // 「Concurに登録」ボタン押下によるphaseの変化（idle→submitting→success/
  // error）のたびに、新しく表示される案内文（下のaria-live領域）が見える
  // 位置まで自動スクロールする。データ変更によるidleへのリセット
  // （上のuseEffect）はskipNextPhaseScrollRefにより対象外にする。
  useEffect(() => {
    if (skipNextPhaseScrollRef.current) {
      skipNextPhaseScrollRef.current = false;
      return;
    }
    scrollElementIntoViewNaturally(panelRef.current, "end");
  }, [phase]);

  async function handleRegister() {
    await runConcurRegistrationSubmit({
      submittingRef,
      phase,
      registrationData,
      isDev: import.meta.env.DEV,
      needsLink: showConcurLoginIdInput,
      companyCode,
      concurLoginId,
      onLinked: () => {
        setHasLink(true);
        setRelinking(false);
      },
      onStubSuccess: (result) => {
        // 一般利用者へは表示しない、開発環境のコンソールログのみ
        // （ファイル冒頭コメント参照）。
        console.info("[ConcurRegistrationPanel] スタブ応答を受信しました（Concur実登録ではありません）", result);
      },
      onUnexpectedError: (caughtError) => {
        console.error("[ConcurRegistrationPanel] Concurへの登録リクエスト中に予期しないエラーが発生しました", caughtError);
      },
      onPhaseChange: setPhase,
      onErrorTypeChange: setErrorType,
    });
  }

  if (!shouldRenderConcurRegistrationCard({ error, registrationData })) {
    return null;
  }

  return (
    <div className="concurRegistrationSection" ref={panelRef}>
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

        {showConcurLoginIdInput ? (
          <div className="concurRegistrationConcurLoginIdField">
            <label className="concurRegistrationFieldLabel" htmlFor="concurRegistrationConcurLoginId">
              ConcurログインID
            </label>
            <input
              id="concurRegistrationConcurLoginId"
              type="text"
              value={concurLoginId}
              onChange={(event) => setConcurLoginId(event.target.value)}
              disabled={phase === "submitting" || phase === "success"}
              placeholder="例：taro.yamada@example.com"
            />
          </div>
        ) : (
          <div className="concurRegistrationConcurLoginIdStatus">
            <p className="concurRegistrationConcurLoginIdConfirmedText">Concur利用者：確認済み</p>
            <button
              type="button"
              className="concurRegistrationChangeLinkButton"
              onClick={() => setRelinking(true)}
              disabled={phase === "submitting"}
            >
              Concurアカウントの紐付けを変更
            </button>
          </div>
        )}

        <div className="concurRegistrationActions">
          <button
            type="button"
            className="concurRegistrationSubmitButton"
            onClick={handleRegister}
            disabled={
              phase === "submitting" ||
              phase === "success" ||
              (showConcurLoginIdInput && !isConcurLoginIdValid(concurLoginId))
            }
          >
            {phase === "submitting" ? "登録中…" : "Concurに登録"}
          </button>
        </div>

        <div aria-live="polite">
          {phase === "submitting" && (
            <p className="concurRegistrationStatusText">Concurへ登録リクエストを送信しています…</p>
          )}
          {phase === "success" && (
            <p className="concurRegistrationSuccessText">Concurへの登録リクエストを受け付けました。</p>
          )}
          {phase === "error" && (
            <p className="concurRegistrationErrorText" role="alert">
              {resolveConcurRegistrationErrorMessage({ type: errorType })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// 以下の表示整形関数は、DOM描画を伴うコンポーネントテスト基盤
// （React Testing Library等）がこのプロジェクトに無いため
// （既存のtests/配下は全て純粋関数のユニットテストのみで構成されている、
// tests/ocrReceiptRepository.test.js等参照）、あえてexportしてvitestから
// 直接テストできるようにしている。新しいテスト基盤の追加は今回行わない。

// concurLoginId入力欄の必須チェック（trim後に空でないこと）。禁止文字・
// 長さ上限等の詳細な検証はEdge Function側（validateQuickExpenseRequest.js）が
// 権威を持つため、ここではボタンの活性/非活性だけを判定する軽いチェックに
// 留める（フロント側にConcur側の禁止文字ルールを複製しない）。
export function isConcurLoginIdValid(concurLoginId) {
  return typeof concurLoginId === "string" && concurLoginId.trim() !== "";
}

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
