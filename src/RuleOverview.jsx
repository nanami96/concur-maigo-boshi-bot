import { checkConfig } from "./configChecks";
import RuleFlowTree from "./RuleFlowTree";

function getExpenseTypeName(config, expenseTypeId) {
  return (
    config.expenseTypes.find((expenseType) => expenseType.id === expenseTypeId)
      ?.name || expenseTypeId
  );
}

function getQuestionLabel(config, questionId) {
  return (
    config.questions.find((question) => question.id === questionId)?.text ||
    questionId
  );
}

function getOptionLabel(config, questionId, value) {
  const question = config.questions.find((item) => item.id === questionId);
  const option = question?.options.find((item) => item.value === value);

  return option?.label || value;
}

function QuestionCard({ question }) {
  return (
    <article className="overviewCard">
      <div className="cardHeading">
        <span className="idBadge">{question.id}</span>
        <h3>{question.text}</h3>
      </div>

      {question.options.length > 0 ? (
        <ul className="optionList">
          {question.options.map((option) => (
            <li key={`${question.id}-${option.value}`}>
              <div>
                <strong>{option.label}</strong>
                <span>{option.value}</span>
              </div>
              <p>
                {option.nextQuestionId
                  ? `次の質問: ${option.nextQuestionId}`
                  : "結果へ進む"}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="emptyState">選択肢はまだ設定されていません。</p>
      )}
    </article>
  );
}

function RuleCard({ config, rule }) {
  const conditions = Object.entries(rule.conditions);

  return (
    <article className="overviewCard ruleCard">
      <div className="cardHeading">
        <span className="idBadge">{rule.id}</span>
        <h3>{getExpenseTypeName(config, rule.resultExpenseTypeId)}</h3>
      </div>

      <dl className="ruleDetails">
        <div>
          <dt>条件</dt>
          <dd>
            {conditions.length > 0 ? (
              <ul className="conditionList">
                {conditions.map(([questionId, value]) => (
                  <li key={`${rule.id}-${questionId}`}>
                    <span>{getQuestionLabel(config, questionId)}</span>
                    <strong>{getOptionLabel(config, questionId, value)}</strong>
                    <small>
                      {questionId}: {value}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              "条件なし"
            )}
          </dd>
        </div>
        <div>
          <dt>案内メッセージ</dt>
          <dd>{rule.message}</dd>
        </div>
      </dl>
    </article>
  );
}

function CheckIssueList({ title, items, level }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className={`checkGroup ${level}`}>
      <h3>{title}</h3>
      <ul className="checkList">
        {items.map((issue) => (
          <li key={issue.id}>
            <span>{issue.target}</span>
            <p>{issue.message}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConfigCheckSection({ result }) {
  const { errors, warnings, info } = result;
  const hasIssues = errors.length > 0 || warnings.length > 0;

  return (
    <details className="overviewSection" open>
      <summary>
        設定チェック
        <span>
          Error {errors.length} / Warning {warnings.length}
        </span>
      </summary>

      {!hasIssues && (
        <div className="checkStatus ok">
          <strong>設定チェックOK</strong>
          <p>{info[0]?.message}</p>
        </div>
      )}

      <div className="checkSummaryGrid">
        <div className="checkMetric error">
          <span>Error</span>
          <strong>{errors.length}</strong>
        </div>
        <div className="checkMetric warning">
          <span>Warning</span>
          <strong>{warnings.length}</strong>
        </div>
        <div className="checkMetric info">
          <span>Info</span>
          <strong>{info.length}</strong>
        </div>
      </div>

      <CheckIssueList title="Error" items={errors} level="error" />
      <CheckIssueList title="Warning" items={warnings} level="warning" />
    </details>
  );
}

export default function RuleOverview({ companyId, config }) {
  const sortedQuestions = [...config.questions].sort(
    (left, right) => left.displayOrder - right.displayOrder,
  );
  const sortedRules = [...config.rules].sort(
    (left, right) => left.priority - right.priority,
  );
  const configCheckResult = checkConfig(config);

  return (
    <section className="overviewPanel" aria-label="ルール確認">
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">設定確認</p>
          <h2>ルール確認</h2>
        </div>
        <p>
          {config.company.company_name}
          <span>{companyId}</span>
        </p>
      </div>

      <details className="overviewSection" open>
        <summary>
          質問フロー
          <span>{sortedQuestions.length}件</span>
        </summary>
        <div className="overviewGrid">
          {sortedQuestions.map((question) => (
            <QuestionCard key={question.id} question={question} />
          ))}
        </div>
      </details>

      <details className="overviewSection" open>
        <summary>
          判定フロー
          <span>ツリー</span>
        </summary>
        <RuleFlowTree config={config} />
      </details>

      <details className="overviewSection" open>
        <summary>
          判定ルール
          <span>{sortedRules.length}件</span>
        </summary>
        <div className="overviewGrid">
          {sortedRules.map((rule) => (
            <RuleCard key={rule.id} config={config} rule={rule} />
          ))}
        </div>
      </details>

      <ConfigCheckSection result={configCheckResult} />
    </section>
  );
}
