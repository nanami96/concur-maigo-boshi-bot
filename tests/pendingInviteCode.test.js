import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  savePendingInviteCode,
  readPendingInviteCode,
  clearPendingInviteCode,
  resolveAutoRedeemOutcome,
} from "../src/data/pendingInviteCode";

function createMemoryLocalStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

describe("pendingInviteCode（招待コードの一時保持）", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("保存した招待コードをそのまま読み出せる（タブ・ウィンドウをまたいでも共有されるlocalStorageを使用）", () => {
    savePendingInviteCode("abc123");
    expect(readPendingInviteCode()).toBe("abc123");
  });

  it("何も保存していなければnullを返す", () => {
    expect(readPendingInviteCode()).toBeNull();
  });

  it("clearPendingInviteCode後はnullを返す（redeem成功後にpendingを破棄する経路）", () => {
    savePendingInviteCode("abc123");
    clearPendingInviteCode();
    expect(readPendingInviteCode()).toBeNull();
  });

  it("24時間より古い保存内容は自動的に無効化される（読み出し時に破棄される）", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00Z"));
    savePendingInviteCode("stale-code");

    vi.setSystemTime(new Date("2026-07-02T00:00:01Z"));
    expect(readPendingInviteCode()).toBeNull();
  });

  it("空文字は保存しない（コードが無いのと同じ扱い）", () => {
    savePendingInviteCode("");
    expect(readPendingInviteCode()).toBeNull();
  });

  it("localStorageが例外を投げる環境でもクラッシュせずnull/no-opになる", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("private mode");
      },
      setItem: () => {
        throw new Error("private mode");
      },
      removeItem: () => {
        throw new Error("private mode");
      },
    });

    expect(() => savePendingInviteCode("abc123")).not.toThrow();
    expect(readPendingInviteCode()).toBeNull();
    expect(() => clearPendingInviteCode()).not.toThrow();
  });
});

describe("resolveAutoRedeemOutcome", () => {
  it("エラーが無ければsuccess", () => {
    expect(resolveAutoRedeemOutcome(null)).toBe("success");
    expect(resolveAutoRedeemOutcome(undefined)).toBe("success");
  });

  it("already_memberはsuccess扱い（二重実行・既存所属との競合を安全側で吸収する）", () => {
    expect(resolveAutoRedeemOutcome("already_member")).toBe("success");
  });

  it("networkはretry（pendingを破棄せず再試行させる）", () => {
    expect(resolveAutoRedeemOutcome("network")).toBe("retry");
  });

  it("invalid_code等その他のエラーはclear_and_manual（再試行しても無駄なため手動入力へ）", () => {
    expect(resolveAutoRedeemOutcome("invalid_code")).toBe("clear_and_manual");
    expect(resolveAutoRedeemOutcome("unknown")).toBe("clear_and_manual");
  });
});
