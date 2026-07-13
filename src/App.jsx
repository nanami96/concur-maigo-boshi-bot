import { useEffect, useMemo, useState } from "react";
import {
  availableCompanies,
  getConfig,
  isPublicDemo,
} from "@configSource";
import QuestionEngine from "./engine/QuestionEngine";
import RuleOverview from "./RuleOverview";

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

function ChatMessage({ speaker = "bot", children }) {
  return (
    <div className={`messageRow ${speaker}`}>
      <div className="avatar">{speaker === "bot" ? "Bot" : "あなた"}</div>
      <div className="messageBubble">{children}</div>
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

export default function App() {
  const defaultCompanyId = availableCompanies[0]?.id || "sample-company";
  const [companyId, setCompanyId] = useState(defaultCompanyId);
  const config = getConfig(companyId) || getConfig(defaultCompanyId);
  const showRuleOverview = !isPublicDemo;

  const engine = useMemo(() => new QuestionEngine(config), [config]);
  const [currentQuestion, setCurrentQuestion] = useState(() =>
    engine.getFirstQuestion(),
  );

  const [selectedAnswer, setSelectedAnswer] = useState("");
  const [result, setResult] = useState(null);
  const [messages, setMessages] = useState([]);
  const [history, setHistory] = useState([]);
  const selectedOption = currentQuestion.options.find(
    (option) => option.value === selectedAnswer,
  );
  const resultNote =
    result?.rule?.warningMessage?.trim() || result?.expenseType?.note?.trim();
  const receiptStatus = getReceiptStatus(result?.expenseType?.receiptRequired);

  function handleSelect(answer) {
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
    const firstQuestion = engine.reset();

    setSelectedAnswer("");
    setResult(null);
    setMessages([]);
    setCurrentQuestion(firstQuestion);
    setHistory([]);
  }

  function handleCompanyChange(event) {
    const nextCompanyId = event.target.value;

    setCompanyId(nextCompanyId);
    setSelectedAnswer("");
    setResult(null);
    setMessages([]);
    setHistory([]);
  }
  useEffect(() => {
    setCurrentQuestion(engine.getFirstQuestion());
  }, [engine]);
  return (
    <main className="appShell">
      <header className="appHeader">
        <div>
          <p className="eyebrow">SAP Concur 経費タイプ選択ナビ</p>
          <h1>Concur迷子防止Bot</h1>
          <p>
            質問に答えるだけで、申請に使う経費タイプと入力のコツを確認できます。
          </p>
        </div>
        <div className="headerActions">
          {!isPublicDemo && (
            <label className="companySelector">
              <span className="companySelectorLabel">会社</span>
              <span className="companySelectWrap">
                <select
                  aria-label="会社を選択"
                  value={companyId}
                  onChange={handleCompanyChange}
                >
                  {availableCompanies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.label}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          )}
          <button
            className="resetButton"
            type="button"
            onClick={goBack}
            disabled={history.length === 0}
          >
            戻る
          </button>
          <button className="resetButton" type="button" onClick={resetAnswers}>
            最初から
          </button>
        </div>
      </header>

      <section className="chatPanel" aria-label="Concur迷子防止Botの質問">
        {messages.map((message, index) => (
          <ChatMessage key={index} speaker={message.speaker}>
            {message.type === "question" ? (
              <h2>{message.text}</h2>
            ) : (
              <p>{message.text}</p>
            )}
          </ChatMessage>
        ))}
        {!result && (
          <ChatMessage>
            <h2>{currentQuestion.text}</h2>
            <ChoiceButtons
              options={currentQuestion.options}
              selected={selectedAnswer}
              onSelect={handleSelect}
            />
          </ChatMessage>
        )}

        {result && (
          <ChatMessage>
            <div className="recommendationCard">
              <div className="resultHero">
                <p className="resultHeroLabel">
                  <span className="resultLabelIcon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false">
                      <path d="M20.6 13.1 13.1 20.6a2.1 2.1 0 0 1-3 0L3.8 14.3A2.8 2.8 0 0 1 3 12.4V5.8A2.8 2.8 0 0 1 5.8 3h6.6a2.8 2.8 0 0 1 1.9.8l6.3 6.3a2.1 2.1 0 0 1 0 3Z" />
                      <path d="M8 8h.01" />
                    </svg>
                  </span>
                  おすすめの経費タイプ
                </p>
                <div className="resultExpenseType">
                  <h2>{result.expenseType.name}</h2>
                </div>
              </div>

              <div className="resultAdviceBubble">
                <h3>
                  <span className="inputPointIcon" aria-hidden="true">
                    💡
                  </span>
                  入力のポイント
                </h3>
                <p>{result.rule.message}</p>
              </div>

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

              {resultNote && (
                <div className="resultWarningCard">
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
                  <p>{resultNote}</p>
                </div>
              )}
            </div>
          </ChatMessage>
        )}
      </section>

      {showRuleOverview && (
        <RuleOverview companyId={companyId} config={config} />
      )}
    </main>
  );
}
