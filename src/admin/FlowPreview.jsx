import { useEffect, useMemo, useRef, useState } from "react";
import QuestionEngine from "../engine/QuestionEngine";
import { buildConfigFromFlow } from "../flow/buildConfigFromFlow";
import { computeAnswersToReachQuestion } from "../flow/computeAnswersToReachQuestion";

// 既存App.jsxのチャットUIと同じCSSクラス（styles.css）を再利用し、
// 見た目の一貫性を保ちながらApp.jsx自体は一切変更しない。
// 編集中の未保存flowをそのままプレビューできるようにするための、管理画面専用の簡易チャットUI。

function getReceiptStatus(receiptRequired) {
  if (receiptRequired === true) {
    return { className: "receiptStatusBadge required", label: "必要" };
  }
  if (receiptRequired === false) {
    return { className: "receiptStatusBadge optional", label: "不要" };
  }
  return { className: "receiptStatusBadge neutral", label: "未設定" };
}

function getPolicyName(policies, policyId) {
  return policies?.find((policy) => policy.policy_id === policyId)?.policy_name;
}

// 以下のアイコン群は本番のチャットUI（App.jsx）と全く同じマークアップ。
// App.jsx側はこれらをファイル内ローカル関数として定義しており外部から再利用できないため、
// 見た目を完全に一致させるためにここでも同じSVG/絵文字をそのまま複製している。
function TagIcon() {
  return (
    <span className="resultLabelIcon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M20.6 13.1 13.1 20.6a2.1 2.1 0 0 1-3 0L3.8 14.3A2.8 2.8 0 0 1 3 12.4V5.8A2.8 2.8 0 0 1 5.8 3h6.6a2.8 2.8 0 0 1 1.9.8l6.3 6.3a2.1 2.1 0 0 1 0 3Z" />
        <path d="M8 8h.01" />
      </svg>
    </span>
  );
}

function ReceiptIcon() {
  return (
    <span className="receiptIcon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M6 3h12v18l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2L6 21V3Z" />
        <path d="M9 8h6" />
        <path d="M9 12h6" />
        <path d="M9 16h4" />
      </svg>
    </span>
  );
}

function WarningIcon() {
  return (
    <span className="warningIcon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M12 3 22 21H2L12 3Z" />
        <path d="M12 9v5" />
        <path d="M12 17.5h.01" />
      </svg>
    </span>
  );
}

export default function FlowPreview({ flow, baseData, startQuestionId, onClearStart }) {
  const config = useMemo(() => buildConfigFromFlow(flow, baseData), [flow, baseData]);
  const engine = useMemo(() => new QuestionEngine(config), [config]);

  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [messages, setMessages] = useState([]);
  const [result, setResult] = useState(null);
  // このプレビュー実行中に既に表示した質問IDの集合。設定データに循環（同じ質問へ
  // 戻ってしまう経路）があった場合に、質問が無限に繰り返されるのを防ぐための
  // 最後の砦。根本原因はbuildFlowFromConfig（合流点の複製）・checkFlow（循環の検出、
  // 公開ブロック）側で対処済みだが、Excel取り込み等の別経路や、まだ気づいていない
  // データ不整合があっても、少なくともプレビュー画面が無限に進み続けることだけは
  // 常に防ぐ。
  const [flowError, setFlowError] = useState(null);
  const visitedQuestionIdsRef = useRef(new Set());

  useEffect(() => {
    setFlowError(null);

    if (startQuestionId && config.questions.some((question) => question.id === startQuestionId)) {
      const ancestorPath = computeAnswersToReachQuestion(flow, startQuestionId);
      const targetQuestion = config.questions.find((question) => question.id === startQuestionId);

      engine.restoreSnapshot({
        currentQuestion: targetQuestion,
        answers: ancestorPath.map(({ questionId, answer }) => ({ questionId, answer })),
      });

      const breadcrumbMessages = ancestorPath.map(({ questionId, answer }) => {
        const question = config.questions.find((item) => item.id === questionId);
        const option = question?.options.find((item) => item.value === answer);
        return {
          speaker: "breadcrumb",
          questionText: question?.text,
          answerLabel: option?.label,
        };
      });

      visitedQuestionIdsRef.current = new Set(
        [...ancestorPath.map(({ questionId }) => questionId), targetQuestion.id].filter(Boolean),
      );
      setCurrentQuestion(targetQuestion);
      setMessages(breadcrumbMessages);
      setResult(null);
      return;
    }

    const firstQuestion = engine.getFirstQuestion();
    visitedQuestionIdsRef.current = new Set(firstQuestion ? [firstQuestion.id] : []);
    setCurrentQuestion(firstQuestion);
    setMessages([]);
    setResult(null);
    // config が変わるたびに（= flowの編集内容が変わるたびに）プレビューを最初からやり直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, flow, startQuestionId]);

  if (!currentQuestion) {
    return <p className="flowEmptyState">まだ質問が設定されていないため、プレビューできません。</p>;
  }

  function handleSelect(answer) {
    const selected = currentQuestion.options.find((option) => option.value === answer);
    const nextQuestion = engine.submitAnswer(answer);

    const newMessages = [
      ...messages,
      { speaker: "bot", text: currentQuestion.text },
      { speaker: "user", text: selected?.label },
    ];

    if (nextQuestion) {
      if (visitedQuestionIdsRef.current.has(nextQuestion.id)) {
        // 根本原因（合流点の複製漏れ等）はbuildFlowFromConfig/checkFlow側で
        // 対処済みのはずだが、万一すり抜けた場合でも無限に質問を繰り返さない
        // ための最終防御。データを捏造せず、はっきり停止して知らせる。
        setMessages(newMessages);
        setFlowError(
          "質問フローに循環が検出されました（同じ質問へ戻ってしまう経路があります）。設定チェックで内容をご確認ください。",
        );
        return;
      }

      visitedQuestionIdsRef.current.add(nextQuestion.id);
      setMessages(newMessages);
      setCurrentQuestion(nextQuestion);
      setResult(null);
      return;
    }

    const nextResult = engine.getResult();

    if (!nextResult) {
      // 次の質問も判定結果も無い＝この回答の組み合わせに一致するルールが無い
      // 行き止まり。以前はここで何もせず同じ質問を再表示し続けてしまっていた
      // （合流点を含むflowの変換不備で発生し得る症状）。捏造した結果を返す
      // ことはせず、行き止まりであることをはっきり表示する。
      setMessages(newMessages);
      setFlowError(
        "この回答の組み合わせに一致する結果が見つかりませんでした。設定チェックで内容をご確認ください。",
      );
      return;
    }

    setMessages(newMessages);
    setResult(nextResult);
  }

  function handleRestart() {
    if (onClearStart) {
      onClearStart();
    }
    const firstQuestion = engine.reset();
    visitedQuestionIdsRef.current = new Set(firstQuestion ? [firstQuestion.id] : []);
    setCurrentQuestion(firstQuestion);
    setMessages([]);
    setResult(null);
    setFlowError(null);
  }

  const resultNote =
    result && !result.candidates
      ? result.rule?.warningMessage?.trim() || result.expenseType?.note?.trim()
      : null;
  const receiptStatus = getReceiptStatus(result?.expenseType?.receiptRequired);
  const policyName = getPolicyName(baseData.policies, result?.expenseType?.policyId);

  return (
    <div className="flowPreviewPanel">
      <div className="flowPreviewHeader">
        <p>編集中の内容をそのまま試せます（保存はされません）。</p>
        <button type="button" className="resetButton" onClick={handleRestart}>
          最初から試す
        </button>
      </div>

      <section className="chatPanel" aria-label="質問フローのプレビュー">
        {messages.map((message, index) =>
          message.speaker === "breadcrumb" ? (
            // eslint-disable-next-line react/no-array-index-key
            <p className="flowPreviewBreadcrumb" key={index}>
              {message.questionText} → <strong>{message.answerLabel}</strong>
            </p>
          ) : (
            // eslint-disable-next-line react/no-array-index-key
            <div className={`messageRow ${message.speaker}`} key={index}>
              <div className="avatar">{message.speaker === "bot" ? "Bot" : "あなた"}</div>
              <div className="messageBubble">
                {message.speaker === "bot" ? <h2>{message.text}</h2> : <p>{message.text}</p>}
              </div>
            </div>
          ),
        )}

        {flowError && (
          <div className="messageRow bot">
            <div className="avatar">Bot</div>
            <div className="messageBubble">
              <p className="flowIssue error">⚠ {flowError}</p>
            </div>
          </div>
        )}

        {!result && !flowError && (
          <div className="messageRow bot">
            <div className="avatar">Bot</div>
            <div className="messageBubble">
              <h2>{currentQuestion.text}</h2>
              <div className="choiceGrid">
                {currentQuestion.options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="choiceButton"
                    onClick={() => handleSelect(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {result && result.candidates && (
          <div className="messageRow bot">
            <div className="avatar">Bot</div>
            <div className="messageBubble">
              <div className="candidateList">
                <h3 className="candidateListHeading">候補となる経費タイプ</h3>
                {result.candidates.map((candidate) => (
                  <div className="candidateCard" key={candidate.rule.id}>
                    <h4 className="candidateName">{candidate.expenseType?.name}</h4>
                    {candidate.rule.message && (
                      <p className="candidateMessage">{candidate.rule.message}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {result && !result.candidates && (
          <div className="messageRow bot">
            <div className="avatar">Bot</div>
            <div className="messageBubble">
              <div className="recommendationCard">
                <div className="resultHero">
                  <p className="resultHeroLabel">
                    <TagIcon />
                    おすすめの経費タイプ
                  </p>
                  <div className="resultExpenseType">
                    <h2>{result.expenseType?.name}</h2>
                  </div>
                  {policyName && (
                    <div className="resultPolicySection">
                      <p className="resultHeroLabel">
                        <TagIcon />
                        ポリシー
                      </p>
                      <div className="resultExpenseType">
                        <h2>{policyName}</h2>
                      </div>
                    </div>
                  )}
                </div>

                {result.rule?.message && (
                  <div className="resultAdviceBubble">
                    <h3>
                      <span className="inputPointIcon" aria-hidden="true">
                        💡
                      </span>
                      入力のポイント
                    </h3>
                    <p>{result.rule.message}</p>
                  </div>
                )}

                <div className="receiptSummary">
                  <ReceiptIcon />
                  <span className="receiptLabel">領収書</span>
                  <span className={receiptStatus.className}>{receiptStatus.label}</span>
                </div>

                {resultNote && (
                  <div className="resultWarningCard">
                    <h3>
                      <WarningIcon />
                      注意事項
                    </h3>
                    <p>{resultNote}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
