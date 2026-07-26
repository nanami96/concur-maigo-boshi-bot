import { useEffect, useLayoutEffect, useRef, useState } from "react";

const VIEWPORT_MARGIN = 8;

// ヘッダーの「⚙ 会社を管理」メニュー。
//
// 既存のOptionMenu.jsx（フローの選択肢行・ポリシーカード・経費タイプ行で使う
// 「⋮」専用メニュー）はトリガーが固定（アイコンのみ、ラベル無し）で、
// トリガーの左側にメニューを開く位置計算になっており、区切り線もサポート
// していない。今回はアイコン+ラベル+シェブロンのヘッダーボタンで、
// トリガーの「下」に開き、区切り線付きの2項目を表示する必要があるため、
// OptionMenu.jsxを流用・改修せず（3箇所の既存利用に影響を与えないため）、
// 同じ考え方（position: fixedでトリガーの実座標から位置計算、外側クリックで
// 閉じる）だけを踏襲した軽量な専用コンポーネントとして分離した。
//
// items: 配列。各要素は
//   "divider"                                                     … 区切り線
//   { label, icon?, onClick, disabled?, disabledTitle?, danger? } … メニュー項目
export default function CompanyManageMenu({ items }) {
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

    let right = window.innerWidth - triggerRect.right;
    if (right < VIEWPORT_MARGIN) {
      right = VIEWPORT_MARGIN;
    }

    setStyle({ position: "fixed", top: triggerRect.bottom + 6, right });
  }, [open]);

  return (
    <div className="companyManageMenu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="companyManageMenuTrigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">⚙</span> 会社を管理
        <span className="companyManageMenuChevron" aria-hidden="true" />
      </button>

      {open && (
        <ul
          ref={listRef}
          className="companyManageMenuList"
          role="menu"
          // 初回描画時（位置計算前）は画面外にオフスクリーン表示し、
          // useLayoutEffectで正しい位置が決まってから見せる（ちらつき防止）。
          style={style || { position: "fixed", top: -9999, right: -9999 }}
        >
          {items.map((item, index) =>
            item === "divider" ? (
              // eslint-disable-next-line react/no-array-index-key -- 区切り線はラベルを持たないため
              <li key={`divider-${index}`} className="companyManageMenuDivider" role="separator" />
            ) : (
              <li key={item.label} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className={item.danger ? "companyManageMenuItem danger" : "companyManageMenuItem"}
                  disabled={item.disabled}
                  title={item.disabled ? item.disabledTitle : undefined}
                  onClick={() => {
                    setOpen(false);
                    item.onClick();
                  }}
                >
                  {item.icon && <span aria-hidden="true">{item.icon} </span>}
                  {item.label}
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
