import { useEffect, useMemo, useRef, useState } from "react";
import QuestionEngine from "./engine/QuestionEngine";
import { renderTextWithLinks } from "./lib/linkifyText";
import { shouldShowPolicySection } from "./lib/policyVisibility";
import { shouldShowReceiptOcr } from "./lib/receiptOcrVisibility";
import ReceiptOcrPanel from "./ReceiptOcrPanel";
import ManualExpenseEntryPanel from "./ManualExpenseEntryPanel";
import ConcurRegistrationPanel from "./ConcurRegistrationPanel";
import { resolveDefaultCurrencyCode } from "./lib/concurRegistrationConfig";
import recommendedMedalIcon from "./assets/recommended-medal.png";
import policyTagIcon from "./assets/policy-tag.png";

// 質問フローのチャットUI本体。「どの会社の設定を、どうやって取得したか」は
// 一切知らず、確定済みのconfig（config.json互換形式）とstatus（読み込み状態）を
// 受け取って表示するだけの、認証・会社解決から独立したプレゼンテーション層。
//
// ローカル開発・静的デモ用の会社セレクタ付きApp.jsxと、ログイン後に会社が
// 自動判定される認証済みBot画面（AuthenticatedBotScreen.jsx）の両方から、
// このコンポーネントをそのまま再利用する。headerActionsに渡すJSX
// （会社セレクタ・管理画面リンク等）だけが呼び出し側ごとに異なる。

// prefers-reduced-motionを尊重しつつ、対象要素が見える位置まで自然にスクロール
// する共通処理（会話の前進時・領収書確定時など、複数のuseEffectから使う）。
function scrollElementIntoViewNaturally(target, block) {
  if (!target) {
    return;
  }

  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  target.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block,
  });
}

function getReceiptStatus(receiptRequired) {
  if (receiptRequired === true) {
    return {
      className: "receiptStatusBadge required",
      label: "必要",
    };
  }

  if (receiptRequired === false) {
    return {
      className: "receiptStatusBadge optional",
      label: "不要",
    };
  }

  return {
    className: "receiptStatusBadge neutral",
    label: receiptRequired == null ? "未設定" : String(receiptRequired),
  };
}

function getPolicyName(policies, policyId) {
  return policies?.find((policy) => policy.policy_id === policyId)?.policy_name;
}

// 「おすすめの経費タイプ」の目印用アイコン（メダル＋星＋青いリボン、
// src/assets/recommended-medal.png、デザイン提供のPNG素材）。
// 「ポリシー」ラベル（TagIcon）とは意図的に別コンポーネント・別クラスに
// してあり、「おすすめ」表示だけを対象にした今回の差し替えがTagIconの
// 他の用途（ポリシーラベル・FlowPreview.jsx側の複製markup）へ波及しない
// ようにしている。素材は512px近い高解像度のまま読み込み、表示サイズだけ
// CSS（.euRecommendedMedalIcon）で28pxに縮小することでRetina環境でも
// ぼやけないようにする。
function RecommendedBadgeIcon() {
  return (
    <span className="resultLabelIcon euRecommendedMedalIcon" aria-hidden="true">
      <img src={recommendedMedalIcon} alt="" />
    </span>
  );
}

// 「ポリシー」の目印用アイコン（淡いブルーの輪郭＋点線のタグ、
// src/assets/policy-tag.png）。おすすめメダルと役割の違いが見た目でも
// 分かるよう、TagIcon（従来のSVGタグ）とは別コンポーネント・別クラスに
// してある。「ポリシー」ラベル以外（FlowPreview.jsx側の複製markup含む）
// には一切影響しない。
function PolicyTagIcon() {
  return (
    <span className="resultLabelIcon euPolicyIcon" aria-hidden="true">
      <img src={policyTagIcon} alt="" />
    </span>
  );
}

// bare=trueのときは、通常メッセージが使う薄いグレーの.messageBubble吹き出しを
// 挟まず、children（結果カード自体）を.messageRowの2列目へ直接配置する。
// 判定結果表示だけ「Botアイコン＋白い結果カード」の二重カードを解消するための
// 専用モードで、質問・履歴等の通常メッセージ（bare未指定）は従来どおり。
function ChatMessage({ speaker = "bot", className = "", containerRef, bare = false, children }) {
  return (
    <div
      ref={containerRef}
      className={["messageRow", speaker, bare ? "resultMessageRow" : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="avatar">{speaker === "bot" ? "Bot" : "あなた"}</div>
      {bare ? children : <div className="messageBubble">{children}</div>}
    </div>
  );
}

function ChoiceButtons({ options, selected, onSelect }) {
  return (
    <div className="choiceGrid">
      {options.map((option) => (
        <button
          className={
            selected === option.value ? "choiceButton selected" : "choiceButton"
          }
          key={option.value}
          type="button"
          onClick={() => onSelect(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function CandidateList({ candidates, policies, onSelect }) {
  return (
    <div className="candidateList euResultEnter">
      <h3 className="candidateListHeading">候補となる経費タイプ</h3>
      {candidates.map((candidate) => {
        const receiptStatus = getReceiptStatus(
          candidate.expenseType?.receiptRequired,
        );
        const note =
          candidate.rule?.warningMessage?.trim() ||
          candidate.expenseType?.note?.trim();
        const policyName = getPolicyName(policies, candidate.expenseType?.policyId);

        return (
          <div className="candidateCard" key={candidate.rule.id}>
            <h4 className="candidateName">{candidate.expenseType?.name}</h4>
            {policyName && (
              <div className="candidatePolicySection">
                <p className="candidatePolicyLabel">ポリシー</p>
                <h4 className="candidateName">{policyName}</h4>
              </div>
            )}
            <div className="candidateReceiptRow">
              <span className="candidateReceiptLabel">領収書</span>
              <span className={receiptStatus.className}>
                {receiptStatus.label}
              </span>
            </div>
            {candidate.rule.message && (
              <p className="candidateMessage">{renderTextWithLinks(candidate.rule.message)}</p>
            )}
            {note && <p className="candidateNote">{renderTextWithLinks(note)}</p>}
            <button
              className="candidateSelectButton"
              type="button"
              onClick={() => onSelect(candidate)}
            >
              この経費タイプにする
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default function BotConversation({
  config,
  status,
  headerActions,
  onSignOut,
  enableReceiptOcr = false,
  // 【複数社所属対応・Commit 4で追加】現在選択中会社(CompanyContext.jsxの
  // currentCompany.companyCode)。ConcurRegistrationPanel.jsxへそのまま渡すだけで、
  // このコンポーネント自身は「どの会社を使っているか」を一切解釈しない
  // （ファイル冒頭コメントの設計方針のとおり）。呼び出し側（App.jsx）が
  // 渡さない場合はundefinedのままで、ConcurRegistrationPanel側は既存どおり
  // config.company.company_idへフォールバックする（後方互換）。
  currentCompanyCode,
}) {
  const engine = useMemo(() => (config ? new QuestionEngine(config) : null), [config]);
  const [currentQuestion, setCurrentQuestion] = useState(() => engine?.getFirstQuestion() ?? null);

  const [selectedAnswer, setSelectedAnswer] = useState("");
  const [result, setResult] = useState(null);
  const [messages, setMessages] = useState([]);
  const [history, setHistory] = useState([]);
  // 領収書OCR（ReceiptOcrPanel.jsx）で確認済みの内容を保持するだけの箱。
  // 経費タイプ判定（QuestionEngine）へは一切渡さない・参照しない
  // （疎結合の維持。詳細はReceiptOcrPanel.jsx冒頭のコメント参照）。
  // 将来のConcur連携等で使う想定のPoC用stateで、今回は保持するだけで
  // それ以上の送信・表示の拡張は行わない。
  const [receiptData, setReceiptData] = useState(null);
  // 「次の質問」または「判定結果」の会話領域末尾をスクロール先として指すref。
  // どちらか一方しか同時に描画されないため（!result / result && ... の排他条件）、
  // 1つのrefを使い回してよい。document.querySelector等の広範なDOM検索は使わず、
  // Reactのrefで直接対象要素を指す。
  const questionAnchorRef = useRef(null);
  const resultAnchorRef = useRef(null);
  // 初回表示・会社切り替え直後・「最初から」やり直した直後は自動スクロールしない
  // ためのフラグ。回答による前進・戻る操作のときだけfalseのまま
  // （＝スクロールを実行する）にする。
  const skipNextScrollRef = useRef(true);
  const resultNote =
    result?.rule?.warningMessage?.trim() || result?.expenseType?.note?.trim();
  // 「入力のポイント」（result.rule.message）は、Excel経由の結果には
  // parseInitialSetupExcel.jsの必須チェックにより常に非空文字列が入るが、
  // 管理画面のFlowOutlineEditor/ResultForm.jsxからは同じチェックを経ずに
  // 空文字で保存できるため、実際には空になりうる。上のresultNoteと同じ
  // 「trimして空なら非表示」という既存パターンをそのまま踏襲する。
  const inputPointMessage = result?.rule?.message?.trim();
  const receiptStatus = getReceiptStatus(result?.expenseType?.receiptRequired);
  const policyName = getPolicyName(config?.policies, result?.expenseType?.policyId);
  // 結果自体にポリシー名が無い場合はそもそも表示しようがなく、また会社の
  // 有効ポリシーが1件以下の場合は選び分ける意味が無いため表示しない
  // （policyVisibility.js参照）。
  const showPolicySection = Boolean(policyName) && shouldShowPolicySection(config?.policies);
  // 領収書「不要」の経費タイプではOCR機能自体を出さない。判定は
  // receiptStatusと同じ値（expenseType.receiptRequired）をそのまま使う
  // （lib/receiptOcrVisibility.js参照。新しい要否判定は追加していない）。
  const showReceiptOcr = shouldShowReceiptOcr({
    enableReceiptOcr,
    receiptRequired: result?.expenseType?.receiptRequired,
  });
  // 領収書「不要」（receiptRequired === falseの場合だけ、null/undefined＝
  // 未設定は含めない）の経費タイプでは、OCRの代わりに利用日・金額等を
  // 手入力できるようにする。showReceiptOcrの否定ではなく、receiptRequiredの
  // 値を直接見て判定する（showReceiptOcrはenableReceiptOcr、つまり
  // ローカル/デモモードかどうかにも左右されるため、それをそのまま使うと
  // 「領収書必須なのにOCRが無効な環境だから手入力を出す」という、
  // 領収書必須の経費タイプで手入力を許してしまう意図しない抜け道になる）。
  // showReceiptOcrとは常に排他（片方がtrueならもう片方は必ずfalse）になる。
  const showManualExpenseEntry = result?.expenseType?.receiptRequired === false;
  // Concur登録前確認データの生成に必要な設定値。経費タイプID＝Concur EXP_KEY
  // という設計のため、現時点ではどの会社でも既定の"JPY"が返るだけで、
  // 既存の判定結果表示には一切影響しない（src/lib/concurRegistrationConfig.js参照）。
  const concurDefaultCurrencyCode = resolveDefaultCurrencyCode(config);

  function handleSelect(answer) {
    if (!engine || !currentQuestion) {
      return;
    }

    const selected = currentQuestion.options.find(
      (option) => option.value === answer,
    );

    const snapshot = {
      engine: engine.getSnapshot(),
      currentQuestion,
      selectedAnswer,
      result,
      messages,
    };

    const nextQuestion = engine.submitAnswer(answer);

    const newMessages = [
      ...messages,
      {
        speaker: "bot",
        type: "question",
        text: currentQuestion.text,
      },
      {
        speaker: "user",
        type: "answer",
        text: selected.label,
      },
    ];

    setHistory([...history, snapshot]);

    if (nextQuestion) {
      setMessages(newMessages);
      setCurrentQuestion(nextQuestion);
      setSelectedAnswer("");
      setResult(null);
      return;
    }

    const nextResult = engine.getResult();
    setMessages(newMessages);
    setResult(nextResult);
    setSelectedAnswer(answer);
  }

  function goBack() {
    if (!engine) {
      return;
    }

    const previous = history[history.length - 1];

    if (!previous) {
      return;
    }

    engine.restoreSnapshot(previous.engine);

    setCurrentQuestion(previous.currentQuestion);
    setSelectedAnswer(previous.selectedAnswer);
    setResult(previous.result);
    setMessages(previous.messages);
    setHistory(history.slice(0, -1));
  }

  function resetAnswers() {
    if (!engine) {
      return;
    }

    const firstQuestion = engine.reset();

    // 「最初から」は会話全体を畳んで先頭質問だけに戻す操作であり、
    // 会話の前進を追いかけるためのスクロールは不要（不要なスクロールを避ける）。
    skipNextScrollRef.current = true;
    setSelectedAnswer("");
    setResult(null);
    setMessages([]);
    setCurrentQuestion(firstQuestion);
    setHistory([]);
    setReceiptData(null);
  }

  useEffect(() => {
    if (!engine) {
      return;
    }
    // 会社切り替え・設定ロード直後の初期表示でもスクロールしない。
    skipNextScrollRef.current = true;
    setCurrentQuestion(engine.getFirstQuestion());
    setSelectedAnswer("");
    setResult(null);
    setMessages([]);
    setHistory([]);
    setReceiptData(null);
  }, [engine]);

  // 回答によって次の質問または判定結果が表示されたときだけ、その要素の先頭が
  // 見える位置まで自然にスクロールする。currentQuestion.id・resultの参照が
  // 変わるたびに1回だけ実行され、同じ回答処理の中で複数回発火することはない
  // （handleSelect等は1回の呼び出しでどちらか一方しか更新しないため）。
  useEffect(() => {
    if (skipNextScrollRef.current) {
      skipNextScrollRef.current = false;
      return;
    }

    scrollElementIntoViewNaturally(result ? resultAnchorRef.current : questionAnchorRef.current, "start");
  }, [currentQuestion?.id, result]);

  // 領収書OCRの確認（ReceiptOcrPanel.jsx）または手入力の確定
  // （ManualExpenseEntryPanel.jsx）によりreceiptDataが確定すると、結果カード内に
  // 「この内容を記録しました」の表示と、条件が揃えばConcur登録確認カード
  // （ConcurRegistrationPanel.jsx）が追加で表示され、カードの高さが伸びる。
  // ブラウザはこの高さの変化に追従して自動スクロールしないため、resultAnchorRef
  // （結果カード全体を指す、上の効果と共通のref）の末尾が見える位置まで
  // 自然にスクロールし、新しく表示された内容へ視線が自然に届くようにする。
  // receiptDataは会社切り替え・「最初から」でのみnullへ戻るため（BotConversation.jsx
  // 冒頭のuseEffect・resetAnswers参照）、truthyへ変わるタイミング＝利用者が
  // 実際に確認操作をした瞬間だけに限られ、skipNextScrollRef相当の初期表示ガードは
  // 不要（値がある時だけ発火するガードで十分）。
  useEffect(() => {
    if (!receiptData) {
      return;
    }

    scrollElementIntoViewNaturally(resultAnchorRef.current, "end");
  }, [receiptData]);

  return (
    <main className="appShell">
      <header className="appHeader">
        <div>
          {/* eyebrowRow・mobileSignOutButtonは、PC専用の.authSignedInBar（画面最上部の
              独立した全幅ログアウトバー、AppAuthGate.jsx参照）がスマホでは
              「ログアウトだけが上部に浮き、タイトルが下に押し下げられる」原因になって
              いたための対応。スマホ幅ではPC用の.authSignedInBarをCSS側で非表示にし
              （styles.cssの.authSignedInBar:has(+ .appShell .chatPanel)参照）、
              代わりにこのeyebrowRow内に同じ操作（onSignOut）のボタンを表示することで、
              サービス名と同じ行にログアウトが自然に収まるようにする。PC幅では
              mobileSignOutButtonをCSSで隠すため、従来通り.authSignedInBarだけが表示される。 */}
          <div className="eyebrowRow">
            <p className="eyebrow">SAP Concur 経費タイプ選択ナビ</p>
            {onSignOut && (
              <button
                type="button"
                className="authSignOutButton mobileSignOutButton"
                onClick={onSignOut}
              >
                ログアウト
              </button>
            )}
          </div>
          <h1>Concur迷子防止Bot</h1>
          <p>
            質問に答えるだけで、申請に使う経費タイプと入力のコツを確認できます。
          </p>
        </div>
        <div className="headerActions">
          {headerActions}
          <button
            className="resetButton"
            type="button"
            onClick={goBack}
            disabled={!currentQuestion || history.length === 0}
          >
            戻る
          </button>
          <button
            className="resetButton"
            type="button"
            onClick={resetAnswers}
            disabled={!currentQuestion}
          >
            最初から
          </button>
        </div>
      </header>

      {status === "loading" && (
        <section className="chatPanel botStatusPanel" aria-label="Concur迷子防止Botの質問">
          <p>設定を読み込んでいます…</p>
        </section>
      )}

      {status === "unavailable" && (
        <section className="chatPanel botStatusPanel" aria-label="Concur迷子防止Botの質問">
          <p>この会社の設定はまだ公開されていません。</p>
        </section>
      )}

      {status === "error" && (
        <section className="chatPanel botStatusPanel" aria-label="Concur迷子防止Botの質問">
          <p>現在、設定を読み込めません。しばらくしてから再度お試しください。</p>
        </section>
      )}

      {status === "ready" && currentQuestion && (
      <section className="chatPanel" aria-label="Concur迷子防止Botの質問">
        {messages.map((message, index) => (
          <ChatMessage key={index} speaker={message.speaker} className="euHistoryEnter">
            {message.type === "question" ? (
              <h2>{message.text}</h2>
            ) : (
              <p>{message.text}</p>
            )}
          </ChatMessage>
        ))}
        {!result && (
          <ChatMessage
            key={currentQuestion.id}
            className="euQuestionEnter"
            containerRef={questionAnchorRef}
          >
            <h2>{currentQuestion.text}</h2>
            <ChoiceButtons
              options={currentQuestion.options}
              selected={selectedAnswer}
              onSelect={handleSelect}
            />
          </ChatMessage>
        )}

        {result && result.candidates && (
          <ChatMessage containerRef={resultAnchorRef} bare>
            <CandidateList
              candidates={result.candidates}
              policies={config.policies}
              onSelect={(candidate) => setResult(candidate)}
            />
          </ChatMessage>
        )}

        {result && !result.candidates && (
          <ChatMessage containerRef={resultAnchorRef} bare>
            <div className="recommendationCard euResultEnter">
              <div className="resultHero">
                <p className="resultHeroLabel euResultHeroLabel">
                  <RecommendedBadgeIcon />
                  おすすめの経費タイプ
                </p>
                <div className="resultExpenseType">
                  <h2>{result.expenseType.name}</h2>
                </div>
                {showPolicySection && (
                  <div className="resultPolicySection">
                    <p className="resultHeroLabel euResultHeroLabel">
                      <PolicyTagIcon />
                      ポリシー
                    </p>
                    <div className="resultExpenseType">
                      <h2>{policyName}</h2>
                    </div>
                  </div>
                )}
              </div>

              {inputPointMessage && (
                <div className="resultAdviceBubble euResultAdviceBubble">
                  <h3>
                    <span className="inputPointIcon" aria-hidden="true">
                      💡
                    </span>
                    入力のポイント
                  </h3>
                  <p>{renderTextWithLinks(inputPointMessage)}</p>
                </div>
              )}

              {/* 領収書要否とOCRボタンを1つのまとまり（euReceiptSection）として
                  扱う。以前は.receiptSummary自身がborder-top/bottomを持ち、
                  OCRボタンはその外側に独立した行として続いていたため、
                  「領収書欄」と「OCR導線」が別セクションに見えていた。
                  ここでは.receiptSummary自体の共通スタイルは変更せず
                  （管理画面FlowPreview.jsxも同じクラスを使うため）、
                  end-user専用のラッパーでborder-bottomの位置だけ付け替える。 */}
              <div
                className={`euReceiptSection${
                  showReceiptOcr || showManualExpenseEntry ? " euReceiptSectionHasOcr" : ""
                }`}
              >
                <div className="receiptSummary">
                  <span className="receiptIcon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false">
                      <path d="M6 3h12v18l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2L6 21V3Z" />
                      <path d="M9 8h6" />
                      <path d="M9 12h6" />
                      <path d="M9 16h4" />
                    </svg>
                  </span>
                  <span className="receiptLabel">領収書</span>
                  <span className={receiptStatus.className}>
                    {receiptStatus.label}
                  </span>
                </div>

                {showReceiptOcr && (
                  <ReceiptOcrPanel
                    key={result.expenseType?.id ?? result.rule?.id}
                    onConfirm={setReceiptData}
                    // セッション切れ時、ReceiptOcrPanel独自の画面遷移は持たせず、
                    // 既存のログアウト導線（AppAuthGateのsignOut。ログアウトボタンや
                    // eyebrowRowのmobileSignOutButtonと同じ関数）をそのまま使う。
                    // signOut()後はonAuthStateChangeにより、AppAuthGateが自動的に
                    // ログイン画面へ切り替える（ここから直接遷移させる処理は書かない）。
                    onAuthExpired={onSignOut}
                  />
                )}

                {showManualExpenseEntry && (
                  <ManualExpenseEntryPanel
                    key={result.expenseType?.id ?? result.rule?.id}
                    onConfirm={setReceiptData}
                    defaultCurrencyCode={concurDefaultCurrencyCode}
                  />
                )}
              </div>

              {resultNote && (
                <div className="resultWarningCard euResultWarningCard">
                  <h3>
                    <span className="warningIcon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path d="M12 3 22 21H2L12 3Z" />
                        <path d="M12 9v5" />
                        <path d="M12 17.5h.01" />
                      </svg>
                    </span>
                    注意事項
                  </h3>
                  <p>{renderTextWithLinks(resultNote)}</p>
                </div>
              )}

              {/* 領収書要否に関わらず（領収書不要の経費タイプでもOCRを経由しない
                  分岐でも）到達できるよう、showReceiptOcr等の条件には依存させない。
                  必要なデータが揃っていない場合はConcurRegistrationPanel.jsx自身が
                  何も描画しない（null）ため、ここでは常にレンダリングを試みるだけで
                  よい。 */}
              <ConcurRegistrationPanel
                company={config?.company}
                companyCode={currentCompanyCode}
                result={result}
                receiptData={receiptData}
                expenseTypeName={result.expenseType?.name}
                policyName={showPolicySection ? policyName : null}
              />
            </div>
          </ChatMessage>
        )}
      </section>
      )}
    </main>
  );
}
