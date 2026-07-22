import { describe, it, expect } from "vitest";
import {
  shouldMarkDirtyOnEditorChange,
  computeStateAfterSaveResult,
  canAttemptSave,
  resolveSaveErrorMessage,
} from "../src/admin/draftSaveState";

describe("shouldMarkDirtyOnEditorChange", () => {
  it("マウント直後の1回目（下書き/静的configを読み込んだだけ）はdirtyにしない", () => {
    expect(shouldMarkDirtyOnEditorChange({ isFirstRun: true })).toBe(false);
  });

  it("2回目以降（実際の編集）はdirtyにする", () => {
    expect(shouldMarkDirtyOnEditorChange({ isFirstRun: false })).toBe(true);
  });
});

describe("computeStateAfterSaveResult", () => {
  it("保存成功時はdirty解除し、保存時刻を反映する", () => {
    const result = computeStateAfterSaveResult({ error: null, updatedAt: "2026-07-22T09:00:00Z" });
    expect(result).toEqual({
      isDirty: false,
      saveStatus: "idle",
      errorType: null,
      lastSavedAt: "2026-07-22T09:00:00Z",
    });
  });

  it("保存失敗時はdirtyを維持し、編集内容を失わない", () => {
    const result = computeStateAfterSaveResult({ error: { type: "network", message: "offline" } });
    expect(result.isDirty).toBe(true);
    expect(result.saveStatus).toBe("error");
    expect(result.errorType).toBe("network");
    expect(result.lastSavedAt).toBeUndefined();
  });
});

describe("canAttemptSave", () => {
  it("Supabase設定済み・保存先company_idが解決済みならtrue", () => {
    expect(canAttemptSave({ isSupabaseConfigured: true, companyDbId: "uuid-1" })).toBe(true);
  });

  it("Supabase未設定ならfalse", () => {
    expect(canAttemptSave({ isSupabaseConfigured: false, companyDbId: "uuid-1" })).toBe(false);
  });

  it("company_idが未解決（null）ならfalse", () => {
    expect(canAttemptSave({ isSupabaseConfigured: true, companyDbId: null })).toBe(false);
  });
});

describe("resolveSaveErrorMessage", () => {
  it("エラー種別ごとに利用者向けメッセージを返す", () => {
    expect(resolveSaveErrorMessage("auth")).toMatch(/ログイン/);
    expect(resolveSaveErrorMessage("network")).toMatch(/通信状態/);
    expect(resolveSaveErrorMessage("unknown")).toMatch(/保存に失敗/);
  });

  it("未知の種別はunknown向けメッセージにフォールバックする", () => {
    expect(resolveSaveErrorMessage("something-else")).toBe(resolveSaveErrorMessage("unknown"));
  });

  it("エラーが無ければnull", () => {
    expect(resolveSaveErrorMessage(null)).toBeNull();
  });
});
