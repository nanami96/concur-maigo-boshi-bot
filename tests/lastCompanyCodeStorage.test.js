import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  readLastCompanyCode,
  saveLastCompanyCode,
  clearLastCompanyCode,
} from "../src/data/lastCompanyCodeStorage";

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

describe("lastCompanyCodeStorage（前回利用した会社の記憶）", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("保存した会社コードをそのまま読み出せる", () => {
    saveLastCompanyCode("company-a");
    expect(readLastCompanyCode()).toBe("company-a");
  });

  it("何も保存していなければnullを返す", () => {
    expect(readLastCompanyCode()).toBeNull();
  });

  it("空文字は保存しない", () => {
    saveLastCompanyCode("");
    expect(readLastCompanyCode()).toBeNull();
  });

  it("非文字列は保存しない", () => {
    saveLastCompanyCode(123);
    expect(readLastCompanyCode()).toBeNull();
  });

  it("clearLastCompanyCodeで削除できる", () => {
    saveLastCompanyCode("company-a");
    clearLastCompanyCode();
    expect(readLastCompanyCode()).toBeNull();
  });

  it("localStorageへのアクセス自体が例外を投げる環境ではnullを返す（保持しない扱い）", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });

    expect(() => saveLastCompanyCode("company-a")).not.toThrow();
    expect(readLastCompanyCode()).toBeNull();
    expect(() => clearLastCompanyCode()).not.toThrow();
  });
});
