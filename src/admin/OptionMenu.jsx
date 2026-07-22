import { useEffect, useLayoutEffect, useRef, useState } from "react";

const VIEWPORT_MARGIN = 8;

// 選択肢の「編集・並び替え・削除」をまとめる「⋮」メニュー。
// 通常表示に大きなボタンを並べず、必要な人だけがメニューを開く形にする。
//
// メニューは position: fixed で、トリガーの実際の画面座標(getBoundingClientRect)から
// 位置を計算する。テーブルの最終行など、親要素のスクロール領域に関係なく
// 常に画面内に収まるようにするため（absoluteだと祖先のoverflowに影響されてしまう）。
export default function OptionMenu({ items }) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handleClickOutside(event) {
      if (
        rootRef.current &&
        !rootRef.current.contains(event.target) &&
        !listRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !listRef.current) {
      return;
    }

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const listRect = listRef.current.getBoundingClientRect();

    let top = triggerRect.top;
    if (top + listRect.height > window.innerHeight - VIEWPORT_MARGIN) {
      top = triggerRect.bottom - listRect.height;
    }
    top = Math.max(VIEWPORT_MARGIN, top);

    let right = window.innerWidth - triggerRect.left + 4;
    if (window.innerWidth - right < VIEWPORT_MARGIN) {
      right = VIEWPORT_MARGIN;
    }

    setStyle({ position: "fixed", top, right });
  }, [open]);

  return (
    <div className="optionMenu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="optionMenuTrigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="この選択肢のその他の操作"
        onClick={() => setOpen((value) => !value)}
      >
        ⋮
      </button>

      {open && (
        <ul
          ref={listRef}
          className="optionMenuList"
          role="menu"
          // 初回描画時（位置計算前）は画面外にオフスクリーン表示し、
          // useLayoutEffectで正しい位置が決まってから見せる（ちらつき防止）。
          style={style || { position: "fixed", top: -9999, right: -9999 }}
        >
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                className={item.danger ? "optionMenuItem danger" : "optionMenuItem"}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
