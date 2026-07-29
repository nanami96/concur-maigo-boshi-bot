import { describe, it, expect, afterEach, vi } from "vitest";
import { copyInviteCodeToClipboard } from "../src/admin/InviteCodeBox.jsx";

// このプロジェクトのvitestはnode環境で動作し、DOM描画テスト基盤（React Testing
// Library等）も無いため、コンポーネント自体はレンダリングせず、コピー処理の
// 純粋なロジック（copyInviteCodeToClipboard）だけを検証する
// （src/ConcurRegistrationPanel.jsx等、既存の同種のテストと同じ方針）。
//
// Node 20+はグローバルのnavigatorをgetterのみで定義しており直接代入できないため、
// vi.stubGlobal()で差し替える（vi.unstubAllGlobals()で必ず元に戻す）。

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("copyInviteCodeToClipboard", () => {
  it("navigator.clipboard.writeTextが成功したらsuccess:trueを返す", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const result = await copyInviteCodeToClipboard("a4cfc453c25c");

    expect(result).toEqual({ success: true });
    expect(writeText).toHaveBeenCalledWith("a4cfc453c25c");
  });

  it("navigator.clipboard.writeTextが例外を投げたらsuccess:falseを返す（画面クラッシュしない）", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const result = await copyInviteCodeToClipboard("a4cfc453c25c");

    expect(result).toEqual({ success: false });
  });

  it("navigator.clipboard自体が無い環境でも例外にならずsuccess:falseを返す", async () => {
    vi.stubGlobal("navigator", {});

    const result = await copyInviteCodeToClipboard("a4cfc453c25c");

    expect(result).toEqual({ success: false });
  });

  it("navigator.clipboard.writeTextが関数でない場合も例外にならずsuccess:falseを返す", async () => {
    vi.stubGlobal("navigator", { clipboard: {} });

    const result = await copyInviteCodeToClipboard("a4cfc453c25c");

    expect(result).toEqual({ success: false });
  });
});
