import { useEffect, useState } from "react";

// 1文字ごとに親のflow stateを書き換えると再レンダーが重くなるため、
// 入力中はローカルstateだけを更新し、blur時にまとめてeditorへ反映する。
export default function EditableText({
  value,
  onCommit,
  placeholder,
  ariaLabel,
  multiline = false,
  className,
}) {
  const [draft, setDraft] = useState(value || "");

  useEffect(() => {
    setDraft(value || "");
  }, [value]);

  const commit = () => {
    if (draft !== value) {
      onCommit(draft);
    }
  };

  if (multiline) {
    return (
      <textarea
        className={className}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        rows={2}
      />
    );
  }

  return (
    <input
      type="text"
      className={className}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
    />
  );
}
