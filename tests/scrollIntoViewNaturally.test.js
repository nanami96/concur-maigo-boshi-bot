import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { scrollElementIntoViewNaturally } from "../src/lib/scrollIntoViewNaturally.js";

// 自動スクロール対応範囲の拡張（ReceiptOcrPanel.jsx・ConcurRegistrationPanel.jsx
// 内のボタン操作でも下までスクロールされるようにする対応）で、BotConversation.jsx
// に埋め込まれていたscrollElementIntoViewNaturally()を共通モジュールへ切り出した。
// このテストは、切り出し後もprefers-reduced-motion・block指定の挙動が
// 変わっていないことを確認する（tests/authCallback.test.jsと同じ
// vi.stubGlobal("window", ...)方式）。
describe("scrollElementIntoViewNaturally", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubMatchMedia(prefersReducedMotion) {
    vi.stubGlobal("window", {
      matchMedia: (query) => ({
        matches: query === "(prefers-reduced-motion: reduce)" && prefersReducedMotion,
      }),
    });
  }

  it("targetが無い場合は何もしない", () => {
    stubMatchMedia(false);
    expect(() => scrollElementIntoViewNaturally(null, "end")).not.toThrow();
    expect(() => scrollElementIntoViewNaturally(undefined, "start")).not.toThrow();
  });

  it("通常時（reduced-motion指定なし）はsmoothスクロールで、指定したblockを渡す", () => {
    stubMatchMedia(false);
    const target = { scrollIntoView: vi.fn() };

    scrollElementIntoViewNaturally(target, "end");

    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "end" });
  });

  it("prefers-reduced-motionが有効な場合はautoスクロールになる", () => {
    stubMatchMedia(true);
    const target = { scrollIntoView: vi.fn() };

    scrollElementIntoViewNaturally(target, "start");

    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });
});

// このプロジェクトにはjsdom等のDOM描画環境が無く、ReceiptOcrPanel.jsx・
// ConcurRegistrationPanel.jsx内のボタン操作→phase変化→実際のスクロール発火を
// 描画テストで確認できない（tests/receiptFileHandling.test.jsと同じ制約）。
// そのため、各ファイルが共通ヘルパーを実際にimportし、phaseの変化を監視する
// useEffect内で呼び出していることをソースを読んで確認する、静的な回帰テストで
// 代替する。
describe("ReceiptOcrPanel.jsx・ConcurRegistrationPanel.jsxの自動スクロール配線（静的確認）", () => {
  function readSource(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
  }

  it("ReceiptOcrPanel.jsxが共通ヘルパーをimportし、phase監視のuseEffect内で呼び出している", () => {
    const source = readSource("../src/ReceiptOcrPanel.jsx");

    expect(source).toMatch(/import\s*\{\s*scrollElementIntoViewNaturally\s*\}\s*from\s*"\.\/lib\/scrollIntoViewNaturally"/);
    expect(source).toMatch(/scrollElementIntoViewNaturally\(panelRef\.current,\s*"end"\)/);
    expect(source).toMatch(/\},\s*\[phase\]\)/);
  });

  it("ReceiptOcrPanel.jsxのidle・通常表示どちらのルート要素にもpanelRefが渡されている", () => {
    const source = readSource("../src/ReceiptOcrPanel.jsx");
    const panelRefUsages = source.match(/ref=\{panelRef\}/g) || [];

    // idle phase専用のreturnと、それ以外のphase用のreturnの、2箇所のルート要素。
    expect(panelRefUsages.length).toBe(2);
  });

  it("ConcurRegistrationPanel.jsxが共通ヘルパーをimportし、phase監視のuseEffect内で呼び出している", () => {
    const source = readSource("../src/ConcurRegistrationPanel.jsx");

    expect(source).toMatch(/import\s*\{\s*scrollElementIntoViewNaturally\s*\}\s*from\s*"\.\/lib\/scrollIntoViewNaturally"/);
    expect(source).toMatch(/scrollElementIntoViewNaturally\(panelRef\.current,\s*"end"\)/);
    expect(source).toMatch(/\},\s*\[phase\]\)/);
    expect(source).toMatch(/ref=\{panelRef\}/);
  });

  it("ConcurRegistrationPanel.jsxは、registrationData変更によるidleへのリセット時はスクロールをスキップするガードを持つ（データ変更をボタン操作と混同しない）", () => {
    const source = readSource("../src/ConcurRegistrationPanel.jsx");

    expect(source).toMatch(/skipNextPhaseScrollRef\.current\s*=\s*true/);
  });

  it("BotConversation.jsxはscrollElementIntoViewNaturally()を自前で再定義せず、共通モジュールから読み込む", () => {
    const source = readSource("../src/BotConversation.jsx");

    expect(source).toMatch(/import\s*\{\s*scrollElementIntoViewNaturally\s*\}\s*from\s*"\.\/lib\/scrollIntoViewNaturally"/);
    expect(source).not.toMatch(/^function scrollElementIntoViewNaturally/m);
  });
});
