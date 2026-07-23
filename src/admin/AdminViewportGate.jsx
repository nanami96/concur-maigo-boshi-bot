import { useEffect, useState } from "react";
import { ADMIN_MIN_VIEWPORT_WIDTH, resolveAdminViewportView } from "./adminViewportGate";

// #admin全体（AuthGate・AdminRoot）をこのコンポーネントで包み、一定幅未満の
// viewportではAdminRootは元よりAuthGate（ログイン画面）すら表示しない。
// 管理画面はPC操作前提のため、スマホで途中までログインさせてから
// 「PCでご利用ください」と案内するより、最初から案内した方が親切という判断。
//
// window.matchMediaのchangeイベントで幅の変化を監視するため、PCで#adminを
// 開いた状態からウィンドウを狭めた場合も、逆に狭い状態から広げた場合も、
// リロードなしで案内画面⇔管理画面が切り替わる。
export default function AdminViewportGate({ children }) {
  const [view, setView] = useState(() =>
    resolveAdminViewportView({ viewportWidth: window.innerWidth }),
  );

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${ADMIN_MIN_VIEWPORT_WIDTH}px)`);

    function handleChange() {
      setView(resolveAdminViewportView({ viewportWidth: window.innerWidth }));
    }

    handleChange();
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  if (view === "blocked") {
    return (
      <main className="appShell adminShell">
        <div className="authScreen">
          <h1>管理画面はPCでご利用ください</h1>
          <p>
            管理画面はPCでの操作を前提としています。
            <br />
            PCからアクセスしてください。
          </p>
          <a className="resetButton" href="#">
            利用者画面へ戻る
          </a>
        </div>
      </main>
    );
  }

  return children;
}
