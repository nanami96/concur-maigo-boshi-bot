import { describe, it, expect } from "vitest";
import {
  canPublishDraft,
  resolvePublishErrorMessage,
  shouldAbortPublishAfterSaveAttempt,
} from "../src/admin/publishState";

describe("canPublishDraft", () => {
  it("Errorが0件・保存先company_idが解決済みなら公開可能", () => {
    expect(canPublishDraft({ errorCount: 0, companyDbId: "uuid-1" })).toBe(true);
  });

  it("Errorが1件以上あれば公開不可", () => {
    expect(canPublishDraft({ errorCount: 1, companyDbId: "uuid-1" })).toBe(false);
  });

  it("保存先company_idが未解決（null）なら公開不可", () => {
    expect(canPublishDraft({ errorCount: 0, companyDbId: null })).toBe(false);
  });
});

describe("resolvePublishErrorMessage", () => {
  it("種別ごとに利用者向けメッセージを返す", () => {
    expect(resolvePublishErrorMessage("forbidden")).toMatch(/権限がありません/);
    expect(resolvePublishErrorMessage("no_draft")).toMatch(/下書きが見つかりません/);
    expect(resolvePublishErrorMessage("draft_save_failed")).toMatch(/編集内容は保持/);
    expect(resolvePublishErrorMessage("auth")).toMatch(/ログイン/);
    expect(resolvePublishErrorMessage("network")).toMatch(/通信エラー/);
  });

  it("未知の種別はunknownにフォールバックする", () => {
    expect(resolvePublishErrorMessage("something-else")).toBe(resolvePublishErrorMessage("unknown"));
  });

  it("エラーが無ければnull", () => {
    expect(resolvePublishErrorMessage(null)).toBeNull();
  });
});

describe("shouldAbortPublishAfterSaveAttempt", () => {
  // 自動保存を廃止したため、公開時にdirtyなら必ず明示保存してから公開する。
  // その保存が失敗した場合に「画面上の最新状態ではなく、Supabase上の古い
  // draft_configsを誤って公開してしまう」ことを防ぐための判定。
  it("dirtyな状態で保存に失敗した場合は中止する", () => {
    expect(shouldAbortPublishAfterSaveAttempt({ isDraftDirty: true, saveSucceeded: false })).toBe(
      true,
    );
  });

  it("dirtyな状態でも保存に成功していれば中止しない", () => {
    expect(shouldAbortPublishAfterSaveAttempt({ isDraftDirty: true, saveSucceeded: true })).toBe(
      false,
    );
  });

  it("そもそもdirtyでなければ（既に保存済み）中止判定は不要＝false", () => {
    expect(shouldAbortPublishAfterSaveAttempt({ isDraftDirty: false, saveSucceeded: false })).toBe(
      false,
    );
  });
});
