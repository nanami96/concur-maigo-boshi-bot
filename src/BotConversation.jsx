import { useEffect, useMemo, useState } from "react";
import QuestionEngine from "./engine/QuestionEngine";
import { renderTextWithLinks } from "./lib/linkifyText";

// 質問フローのチャットUI本体。「どの会社の設定を、どうやって取得したか」は
// 一切知らず、確定済みのconfig（config.json互換形式）とstatus（読み込み状態）を
// 受け取って表示するだけの、認証・会社解決から独立したプレゼンテーション層。
//
// ローカル開発・静的デモ用の会社セレクタ付きApp.jsxと、ログイン後に会社が
// 自動判定される認証済みBot画面（AuthenticatedBotScreen.jsx）の両方から、
// このコンポーネントをそのまま再利用する。headerActionsに渡すJSX
// （会社セレクタ・管理画面リンク等）だけが呼び出し側ごとに異なる。

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

function CandidateList({ candidates, policies, onSelect }) {
  return (
    <div className="candidateList">
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

export default function BotConversation({ config, status, headerActions, onSignOut }) {
  const engine = useMemo(() => (config ? new QuestionEngine(config) : null), [config]);
  const [currentQuestion, setCurrentQuestion] = useState(() => engine?.getFirstQuestion() ?? null);

  const [selectedAnswer, setSelectedAnswer] = useState("");
  const [result, setResult] = useState(null);
  const [messages, setMessages] = useState([]);
  const [history, setHistory] = useState([]);
  const resultNote =
    result?.rule?.warningMessage?.trim() || result?.expenseType?.note?.trim();
  const receiptStatus = getReceiptStatus(result?.expenseType?.receiptRequired);
  const policyName = getPolicyName(config?.policies, result?.expenseType?.policyId);

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

    setSelectedAnswer("");
    setResult(null);
    setMessages([]);
    setCurrentQuestion(firstQuestion);
    setHistory([]);
  }

  useEffect(() => {
    if (!engine) {
      return;
    }
    setCurrentQuestion(engine.getFirstQuestion());
    setSelectedAnswer("");
    setResult(null);
    setMessages([]);
    setHistory([]);
  }, [engine]);

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

        {result && result.candidates && (
          <ChatMessage>
            <CandidateList
              candidates={result.candidates}
              policies={config.policies}
              onSelect={(candidate) => setResult(candidate)}
            />
          </ChatMessage>
        )}

        {result && !result.candidates && (
          <ChatMessage>
            <div className="recommendationCard">
              <div className="resultHero">
                <p className="resultHeroLabel">
                  <TagIcon />
                  おすすめの経費タイプ
                </p>
                <div className="resultExpenseType">
                  <h2>{result.expenseType.name}</h2>
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

              <div className="resultAdviceBubble">
                <h3>
                  <span className="inputPointIcon" aria-hidden="true">
                    💡
                  </span>
                  入力のポイント
                </h3>
                <p>{renderTextWithLinks(result.rule.message)}</p>
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
                  <p>{renderTextWithLinks(resultNote)}</p>
                </div>
              )}
            </div>
          </ChatMessage>
        )}
      </section>
      )}
    </main>
  );
}
