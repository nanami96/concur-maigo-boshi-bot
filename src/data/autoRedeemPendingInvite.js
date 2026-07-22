// AuthenticatedBotScreen.jsx（NoMembershipGate）の自動redeem処理の中核ロジックを、
// Reactから切り離してテストできるようにしたもの。
//
// 「今まさに実行中かどうか」の排他制御を、useRefの代わりにこのモジュール自身が
// 持つクロージャ変数（isRunning）で行う。createAutoRedeemPendingInvite()は
// 呼ぶたびに新しい「実行中フラグ」を持つ関数を1つ生成するファクトリで、
// 呼び出し側（AuthenticatedBotScreen.jsx）はコンポーネントの生存期間中ずっと
// 同じインスタンスを使い続ける（useRefでインスタンスそのものを保持する）。
// これにより、React StrictModeのeffect二重実行や偶発的な多重呼び出しがあっても、
// redeem_invite_code() RPCが実際に同時に2回飛ぶことは無い
// （2回目の呼び出しは即座に { attempted: false } を返して終わる）。
//
// 戻り値のoutcomeが "success" または "clear_and_manual" の場合のみ
// pending invite codeを破棄する（"retry"＝通信エラー等の場合は、次の再試行で
// 同じコードを使えるよう破棄しない）。この判定はresolveAutoRedeemOutcome
// （pendingInviteCode.js）に委譲しており、ここでは呼ぶだけ。
export function createAutoRedeemPendingInvite({
  readPendingInviteCode,
  redeemInviteCode,
  clearPendingInviteCode,
  resolveAutoRedeemOutcome,
}) {
  let isRunning = false;

  return async function attemptAutoRedeem() {
    const pendingCode = readPendingInviteCode();

    if (!pendingCode || isRunning) {
      return { attempted: false, outcome: null, error: null };
    }

    isRunning = true;
    const { error } = await redeemInviteCode(pendingCode);
    isRunning = false;

    const outcome = resolveAutoRedeemOutcome(error?.type);

    if (outcome === "success" || outcome === "clear_and_manual") {
      clearPendingInviteCode();
    }

    return { attempted: true, outcome, error };
  };
}
