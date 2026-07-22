import EditableText from "./EditableText";
import { useFlowEditorContext } from "./FlowEditorContext";

function CandidateForm({ optionId, candidate, index, canRemove }) {
  const { editor, expenseTypes } = useFlowEditorContext();

  return (
    <div className="resultCandidateForm">
      <label className="resultFieldLabel">
        おすすめ経費タイプ
        <select
          value={candidate.expenseTypeId || ""}
          onChange={(event) =>
            editor.updateResultCandidate(optionId, index, {
              expenseTypeId: event.target.value,
            })
          }
        >
          <option value="">（未選択）</option>
          {expenseTypes.map((expenseType) => (
            <option key={expenseType.id} value={expenseType.id}>
              {expenseType.name}
            </option>
          ))}
        </select>
      </label>

      <label className="resultFieldLabel">
        案内メッセージ
        <EditableText
          className="resultFieldInput"
          value={candidate.message}
          placeholder="この経費タイプを選んだ人への案内文"
          ariaLabel="案内メッセージ"
          multiline
          onCommit={(text) => editor.updateResultCandidate(optionId, index, { message: text })}
        />
      </label>

      <label className="resultFieldLabel">
        注意事項
        <EditableText
          className="resultFieldInput"
          value={candidate.warningMessage}
          placeholder="必要であれば入力してください（任意）"
          ariaLabel="注意事項"
          multiline
          onCommit={(text) =>
            editor.updateResultCandidate(optionId, index, { warningMessage: text })
          }
        />
      </label>

      {canRemove && (
        <button
          type="button"
          className="resultCandidateRemoveButton"
          onClick={() => editor.removeResultCandidate(optionId, index)}
        >
          この候補を削除
        </button>
      )}
    </div>
  );
}

export default function ResultForm({ optionId, candidates }) {
  const { editor } = useFlowEditorContext();

  return (
    <div className="resultForm">
      {candidates.map((candidate, index) => (
        <CandidateForm
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          optionId={optionId}
          candidate={candidate}
          index={index}
          canRemove={candidates.length > 1}
        />
      ))}
      <button
        type="button"
        className="resultAddCandidateButton"
        onClick={() => editor.addResultCandidate(optionId)}
      >
        ＋ 別の経費タイプ候補も表示する（複数候補がある場合のみ）
      </button>
    </div>
  );
}
