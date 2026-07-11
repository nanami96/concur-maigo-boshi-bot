import { useEffect, useMemo, useState } from "react";
import {
  availableCompanies,
  getConfig,
  isPublicDemo,
} from "@configSource";
import QuestionEngine from "./engine/QuestionEngine";
import RuleOverview from "./RuleOverview";

function ChatMessage({ speaker = "bot", children }) {
  return (
    <div className={`messageRow ${speaker}`}>
      <div className="avatar">{speaker === "bot" ? "B" : "あなた"}</div>
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
        {!isPublicDemo && (
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
              <p className="cardLabel">おすすめの経費タイプ</p>
              <h2>{result.expenseType.name}</h2>
              <p>{result.rule.message}</p>

              <div className="resultItem">
                <h3>領収書要否</h3>
                <p>{result.expenseType.receiptRequired ? "必要" : "不要"}</p>
              </div>

              <div className="resultItem">
                <h3>注意点</h3>
                <p>{result.expenseType.note}</p>
              </div>
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
