import { buildRuleFlowTree } from "./ruleFlowBuilder";

function QuestionNode({ node }) {
  return (
    <div className="treeNode questionNode">
      <span>{node.id}</span>
      <strong>{node.text}</strong>
    </div>
  );
}

function ResultNode({ node }) {
  if (node.type === "missing-result") {
    return (
      <div className="treeNode missingNode">
        <span>結果なし</span>
        <strong>{node.text}</strong>
      </div>
    );
  }

  if (node.type === "loop") {
    return (
      <div className="treeNode missingNode">
        <span>Loop</span>
        <strong>{node.text}</strong>
      </div>
    );
  }

  return (
    <div className="treeNode resultNode">
      <span>{node.ruleId}</span>
      <strong>{node.expenseTypeName}</strong>
      <small>{node.expenseTypeId}</small>
    </div>
  );
}

function TreeBranch({ node }) {
  if (node.type === "question") {
    return (
      <div className="treeQuestion">
        <QuestionNode node={node} />
        {node.children.length > 0 ? (
          <ul className="treeOptions">
            {node.children.map((option) => (
              <li key={option.id}>
                <div className="treeOption">
                  <span>{option.label}</span>
                  <small>{option.value}</small>
                </div>
                <TreeBranch node={option.child} />
              </li>
            ))}
          </ul>
        ) : (
          <ResultNode
            node={{
              type: "missing-result",
              id: `${node.id}-no-options`,
              text: "選択肢が設定されていません。",
            }}
          />
        )}
      </div>
    );
  }

  return <ResultNode node={node} />;
}

export default function RuleFlowTree({ config }) {
  const tree = buildRuleFlowTree(config);

  return (
    <div className="flowTree">
      <div className="treeNode startNode">
        <span>開始</span>
        <strong>質問フロー</strong>
      </div>
      <TreeBranch node={tree.child} />
    </div>
  );
}
