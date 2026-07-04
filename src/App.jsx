import { useMemo, useState } from 'react';
import rules from './expenseRules.json';

const firstQuestionOptions = [
  { id: 'train-bus', label: '🚆 電車・バスに乗った' },
  { id: 'taxi', label: '🚕 タクシーに乗った' },
  { id: 'shinkansen', label: '🚄 新幹線に乗った' },
  { id: 'airplane', label: '✈ 飛行機に乗った' },
  { id: 'hotel', label: '🏨 ホテルに泊まった' },
  { id: 'meal', label: '🍴 会食した' },
  { id: 'supplies', label: '📦 備品を購入した' },
  { id: 'unknown', label: '❓ 分からない' }
];

const travelPurposeOptions = [
  { id: 'daily', label: '近隣・日常的な業務移動' },
  { id: 'business-trip', label: '出張に伴う移動' },
  { id: 'commute', label: '通勤・定期区間に関する移動' },
  { id: 'unknown', label: '判断できない' }
];

const businessTripOptions = [
  { id: 'business-trip', label: 'はい、出張です' },
  { id: 'unknown', label: '判断できない' }
];

function needsFollowUp(claimType) {
  return claimType === 'train-bus' || claimType === 'shinkansen' || claimType === 'airplane';
}

function getFollowUpOptions(claimType) {
  if (claimType === 'train-bus') {
    return travelPurposeOptions;
  }

  return businessTripOptions;
}

function getFollowUpQuestion(claimType) {
  if (claimType === 'train-bus') {
    return 'どんな移動でしたか？';
  }

  return '出張に伴う移動ですか？';
}

function findRecommendation(claimType, travelPurpose) {
  if (!claimType) {
    return null;
  }

  if (needsFollowUp(claimType) && !travelPurpose) {
    return null;
  }

  return (
    rules.find((rule) => rule.claimType === claimType && rule.travelPurpose === travelPurpose) ??
    rules.find((rule) => rule.claimType === claimType && !rule.travelPurpose) ??
    rules.find((rule) => rule.claimType === 'unknown')
  );
}

function ChatMessage({ speaker = 'bot', children }) {
  return (
    <div className={`messageRow ${speaker}`}>
      <div className="avatar">{speaker === 'bot' ? 'B' : 'あなた'}</div>
      <div className="messageBubble">{children}</div>
    </div>
  );
}

function ChoiceButtons({ options, selected, onSelect }) {
  return (
    <div className="choiceGrid">
      {options.map((option) => (
        <button
          className={selected === option.id ? 'choiceButton selected' : 'choiceButton'}
          key={option.id}
          type="button"
          onClick={() => onSelect(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function RecommendationCard({ result }) {
  if (!result) {
    return null;
  }

  return (
    <div className="recommendationCard">
      <p className="cardLabel">おすすめの経費タイプ</p>
      <h2>{result.expenseType}</h2>

      <div className="resultItem">
        <h3>入力時のポイント</h3>
        <ul>
          {result.inputTips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      </div>

      <div className="resultItem">
        <h3>領収書要否</h3>
        <p>{result.receiptRequired}</p>
      </div>

      <div className="resultItem">
        <h3>コメント例</h3>
        <p className="commentExample">{result.commentExample}</p>
      </div>

      <div className="resultItem">
        <h3>注意点</h3>
        <ul>
          {result.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function App() {
  const [claimType, setClaimType] = useState('');
  const [travelPurpose, setTravelPurpose] = useState('');

  const selectedClaim = firstQuestionOptions.find((option) => option.id === claimType);
  const followUpOptions = getFollowUpOptions(claimType);
  const selectedPurpose = followUpOptions.find((option) => option.id === travelPurpose);
  const showFollowUp = claimType && needsFollowUp(claimType);
  const recommendation = useMemo(() => findRecommendation(claimType, travelPurpose), [claimType, travelPurpose]);

  function handleClaimTypeSelect(nextClaimType) {
    setClaimType(nextClaimType);
    setTravelPurpose('');
  }

  function resetAnswers() {
    setClaimType('');
    setTravelPurpose('');
  }

  return (
    <main className="appShell">
      <header className="appHeader">
        <div>
          <p className="eyebrow">SAP Concur 経費タイプ選択ナビ</p>
          <h1>Concur迷子防止Bot</h1>
          <p>質問に答えるだけで、申請に使う経費タイプと入力のコツを確認できます。</p>
        </div>
        <button className="resetButton" type="button" onClick={resetAnswers}>
          最初から
        </button>
      </header>

      <section className="chatPanel" aria-label="Concur迷子防止Botの質問">
        <ChatMessage>
          <h2>今日は何を申請しますか？</h2>
          <ChoiceButtons options={firstQuestionOptions} selected={claimType} onSelect={handleClaimTypeSelect} />
        </ChatMessage>

        {selectedClaim && (
          <ChatMessage speaker="user">
            <p>{selectedClaim.label}</p>
          </ChatMessage>
        )}

        {showFollowUp && (
          <ChatMessage>
            <h2>{getFollowUpQuestion(claimType)}</h2>
            <ChoiceButtons options={followUpOptions} selected={travelPurpose} onSelect={setTravelPurpose} />
          </ChatMessage>
        )}

        {selectedPurpose && (
          <ChatMessage speaker="user">
            <p>{selectedPurpose.label}</p>
          </ChatMessage>
        )}

        {recommendation && (
          <ChatMessage>
            <RecommendationCard result={recommendation} />
          </ChatMessage>
        )}
      </section>
    </main>
  );
}
