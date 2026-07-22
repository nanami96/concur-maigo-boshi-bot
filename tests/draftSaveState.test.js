import { describe, it, expect } from "vitest";
import {
  computeDirtyTransition,
  computeStateAfterSaveResult,
  canAttemptSave,
  resolveSaveErrorMessage,
} from "../src/admin/draftSaveState";

function makeEditorState(overrides = {}) {
  return {
    company: {},
    policies: [],
    expenseTypes: [],
    flow: {},
    ...overrides,
  };
}

describe("computeDirtyTransition", () => {
  it("editorStateがbaselineと参照として同一（何も変わっていない）ならdirty化しない", () => {
    const editorState = makeEditorState();
    const result = computeDirtyTransition({
      editorState,
      baseline: editorState,
      skipNextChange: false,
    });
    expect(result.changed).toBe(false);
    expect(result.shouldMarkDirty).toBe(false);
  });

  it("同じ依存関係でeffectが2回実行されても（React.StrictMode相当）、2回目もdirty化しない", () => {
    // 1回目：baselineと一致（初回ロード時と同じ状態）
    const editorState = makeEditorState();
    const first = computeDirtyTransition({
      editorState,
      baseline: editorState,
      skipNextChange: false,
    });
    // 2回目：StrictModeによる再実行を模して、1回目の結果（nextBaseline）を
    // baselineとして同じeditorStateで再度呼ぶ。これがマウント直後に
    // 誤ってdirty=trueになっていた不具合の再現ケース。
    const second = computeDirtyTransition({
      editorState,
      baseline: first.nextBaseline,
      skipNextChange: first.nextSkipNextChange,
    });
    expect(first.shouldMarkDirty).toBe(false);
    expect(second.changed).toBe(false);
    expect(second.shouldMarkDirty).toBe(false);
  });

  it("実際にflowの参照が変わった（編集された）場合はdirty化し、baselineを更新する", () => {
    const baseline = makeEditorState();
    const editorState = makeEditorState({ flow: { edited: true } });
    const result = computeDirtyTransition({ editorState, baseline, skipNextChange: false });
    expect(result.changed).toBe(true);
    expect(result.shouldMarkDirty).toBe(true);
    expect(result.nextBaseline.flow).toBe(editorState.flow);
  });

  it("skipNextChangeが立っている場合、変化を検知してもdirty化せずbaselineだけ更新する（保存前の状態に戻す直後）", () => {
    const baseline = makeEditorState();
    const editorState = makeEditorState({ flow: { reverted: true } });
    const result = computeDirtyTransition({ editorState, baseline, skipNextChange: true });
    expect(result.changed).toBe(true);
    expect(result.shouldMarkDirty).toBe(false);
    expect(result.nextBaseline.flow).toBe(editorState.flow);
    expect(result.nextSkipNextChange).toBe(false);
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
