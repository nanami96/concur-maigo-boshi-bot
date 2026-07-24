import maigoLogo from "../assets/maigo-bot-logo.png";

// 認証系画面（ログイン・アカウント作成・パスワード再設定・招待コード入力）専用の
// ブランドロゴ。確定済みのロゴ画像（src/assets/maigo-bot-logo.png）をそのまま
// 表示するだけで、切り抜き・色変更・背景の透過処理等は一切行わない。
//
// .authScreenはデザイン上常にライトテーマで統一されており（ダークモード対象外。
// styles.cssの.authScreen関連コメント参照）、ロゴ画像自体も白背景の平置き画像
// （透過無し）のため、ダークモードでの背景色不一致は発生しない。
//
// 一般ユーザーのBot画面ヘッダー（BotConversation.jsx）・管理画面ヘッダー
// （AdminRoot.jsx）には意図的に配置していない（会話領域を圧迫しないため、
// 既存のテキスト見出しのまま維持する方針。詳細は導入時のやりとり参照）。
export default function AuthLogo() {
  return <img src={maigoLogo} alt="迷子ボット" className="authLogo" />;
}
