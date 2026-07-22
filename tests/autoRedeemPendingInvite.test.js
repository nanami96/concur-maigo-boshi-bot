import { describe, it, expect, vi } from "vitest";
import { createAutoRedeemPendingInvite } from "../src/data/autoRedeemPendingInvite";

function makeDeps({ redeemResult, pendingCode = "abc123" } = {}) {
  const clearPendingInviteCode = vi.fn();
  const redeemInviteCode = vi.fn().mockResolvedValue(redeemResult ?? { error: null });
  const readPendingInviteCode = vi.fn().mockReturnValue(pendingCode);
  const resolveAutoRedeemOutcome = (errorType) => {
    if (!errorType) return "success";
    if (errorType === "already_member") return "success";
    if (errorType === "network") return "retry";
    return "clear_and_manual";
  };

  return {
    readPendingInviteCode,
    redeemInviteCode,
    clearPendingInviteCode,
    resolveAutoRedeemOutcome,
  };
}

describe("createAutoRedeemPendingInvite", () => {
  it("pendingコードが無ければredeemInviteCodeを呼ばない", async () => {
    const deps = makeDeps({ pendingCode: null });
    const attemptAutoRedeem = createAutoRedeemPendingInvite(deps);

    const result = await attemptAutoRedeem();

    expect(result).toEqual({ attempted: false, outcome: null, error: null });
    expect(deps.redeemInviteCode).not.toHaveBeenCalled();
  });

  it("成功時はredeemを呼び、pendingを破棄する", async () => {
    const deps = makeDeps({ redeemResult: { error: null } });
    const attemptAutoRedeem = createAutoRedeemPendingInvite(deps);

    const result = await attemptAutoRedeem();

    expect(deps.redeemInviteCode).toHaveBeenCalledWith("abc123");
    expect(result).toEqual({ attempted: true, outcome: "success", error: null });
    expect(deps.clearPendingInviteCode).toHaveBeenCalledTimes(1);
  });

  it("already_memberも成功と同様に扱い、pendingを破棄する（二重実行・既存所属との競合を吸収）", async () => {
    const deps = makeDeps({ redeemResult: { error: { type: "already_member" } } });
    const attemptAutoRedeem = createAutoRedeemPendingInvite(deps);

    const result = await attemptAutoRedeem();

    expect(result.outcome).toBe("success");
    expect(deps.clearPendingInviteCode).toHaveBeenCalledTimes(1);
  });

  it("通信エラー時はpendingを破棄しない（再試行可能な状態を保つ）", async () => {
    const deps = makeDeps({ redeemResult: { error: { type: "network" } } });
    const attemptAutoRedeem = createAutoRedeemPendingInvite(deps);

    const result = await attemptAutoRedeem();

    expect(result.outcome).toBe("retry");
    expect(deps.clearPendingInviteCode).not.toHaveBeenCalled();
  });

  it("無効な招待コード等の場合はpendingを破棄し、手動入力へフォールバックする", async () => {
    const deps = makeDeps({ redeemResult: { error: { type: "invalid_code" } } });
    const attemptAutoRedeem = createAutoRedeemPendingInvite(deps);

    const result = await attemptAutoRedeem();

    expect(result.outcome).toBe("clear_and_manual");
    expect(deps.clearPendingInviteCode).toHaveBeenCalledTimes(1);
  });

  it("同時に2回呼んでもredeemInviteCodeは1回しか実行されない（StrictMode等の二重実行対策）", async () => {
    const deps = makeDeps({ redeemResult: { error: null } });
    const attemptAutoRedeem = createAutoRedeemPendingInvite(deps);

    const [first, second] = await Promise.all([attemptAutoRedeem(), attemptAutoRedeem()]);

    expect(deps.redeemInviteCode).toHaveBeenCalledTimes(1);
    // 片方は実際に実行され、もう片方は「実行中だった」ため即座にattempted:falseで返る。
    const attemptedResults = [first, second].filter((r) => r.attempted);
    const skippedResults = [first, second].filter((r) => !r.attempted);
    expect(attemptedResults).toHaveLength(1);
    expect(skippedResults).toHaveLength(1);
  });

  it("1回目が完了した後であれば、2回目の呼び出しは改めてredeemを実行する（実行中フラグが正しく解放される）", async () => {
    const deps = makeDeps({ redeemResult: { error: null } });
    const attemptAutoRedeem = createAutoRedeemPendingInvite(deps);

    await attemptAutoRedeem();
    await attemptAutoRedeem();

    expect(deps.redeemInviteCode).toHaveBeenCalledTimes(2);
  });
});
