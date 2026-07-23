// 管理画面（#admin）はPCでの操作を前提としたUIのため、一定幅未満のviewportでは
// AdminRoot自体をマウントせず、専用の案内画面だけを表示する。
//
// この閾値はあくまでUI制御であり、セキュリティ境界ではない（AuthGateの認証・
// role/is_platform_admin()判定、RLS・RPC側の権限チェックとは完全に独立している。
// 実際のアクセス制御は既存のAuthGate以降の仕組みがそのまま担う）。
//
// 1024pxを採用した理由：
//   ・.adminShellの content 幅は最大900px（styles.css参照）で、質問フロー編集・
//     会社設定・ユーザー管理は横並びレイアウトを前提にしており、タブレット幅
//     （iPadの縦持ち=768px相当）では窮屈になる。
//   ・iPadの横持ち（1024px相当）や小型ノートPCは許容し、スマホ・タブレット縦持ちは
//     除外する、という一般的なdesktop/tabletの境目（Bootstrap lg・Tailwind lg等でも
//     広く使われる値）として1024pxを採用した。
export const ADMIN_MIN_VIEWPORT_WIDTH = 1024;

// window.matchMediaを直接テストするのは難しいため、判定ロジックだけを
// 純粋関数として切り出す。
export function resolveAdminViewportView({ viewportWidth, minWidth = ADMIN_MIN_VIEWPORT_WIDTH }) {
  return viewportWidth >= minWidth ? "allowed" : "blocked";
}
