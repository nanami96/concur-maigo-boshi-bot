import { describe, it, expect } from "vitest";
import { isValidElement } from "react";
import { renderTextWithLinks } from "../src/lib/linkifyText";

describe("renderTextWithLinks", () => {
  it("空文字・null・undefinedはそのまま返す（クラッシュしない）", () => {
    expect(renderTextWithLinks("")).toBe("");
    expect(renderTextWithLinks(null)).toBeNull();
    expect(renderTextWithLinks(undefined)).toBeUndefined();
  });

  it("URLを含まない文章はそのままの配列（1要素）で返る", () => {
    const result = renderTextWithLinks("経費は当日中に精算してください。");
    expect(result).toEqual(["経費は当日中に精算してください。"]);
  });

  it("URLだけの文字列は単一の<a>要素になる", () => {
    const result = renderTextWithLinks("https://example.com/guide");
    expect(result).toHaveLength(1);
    expect(isValidElement(result[0])).toBe(true);
    expect(result[0].props.href).toBe("https://example.com/guide");
    expect(result[0].props.children).toBe("https://example.com/guide");
  });

  it("<a>要素はtarget=_blank・rel=noopener noreferrerを持つ（外部リンクを安全に新しいタブで開く）", () => {
    const [link] = renderTextWithLinks("https://example.com");
    expect(link.props.target).toBe("_blank");
    expect(link.props.rel).toBe("noopener noreferrer");
  });

  it("前後にテキストがあるURLは「前文・リンク・後文」の3要素に分割される", () => {
    const result = renderTextWithLinks("詳細はhttps://example.com/pageをご覧ください");
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("詳細は");
    expect(isValidElement(result[1])).toBe(true);
    expect(result[1].props.href).toBe("https://example.com/page");
    expect(result[2]).toBe("をご覧ください");
  });

  it("URL直後の句点「。」はリンクに含めず、後続テキストとして扱う", () => {
    const result = renderTextWithLinks("詳細はこちらです。https://example.com/page。");
    const link = result.find((node) => isValidElement(node));
    expect(link.props.href).toBe("https://example.com/page");
    expect(link.props.children).toBe("https://example.com/page");
    expect(result[result.length - 1]).toBe("。");
  });

  it("閉じ括弧がURL直後にある場合もリンクに含めない", () => {
    const result = renderTextWithLinks("（参考：https://example.com/page）");
    const link = result.find((node) => isValidElement(node));
    expect(link.props.href).toBe("https://example.com/page");
    expect(result[result.length - 1]).toBe("）");
  });

  it("1つの文章に複数のURLが含まれる場合、それぞれ個別にリンク化される", () => {
    const result = renderTextWithLinks("公式: https://a.example.com 補足: https://b.example.com/docs");
    const links = result.filter((node) => isValidElement(node));
    expect(links).toHaveLength(2);
    expect(links[0].props.href).toBe("https://a.example.com");
    expect(links[1].props.href).toBe("https://b.example.com/docs");
  });

  it("http（非https）のURLもリンク化する", () => {
    const [link] = renderTextWithLinks("http://example.com/legacy");
    expect(link.props.href).toBe("http://example.com/legacy");
  });

  it("httpから始まらない文字列（company.example.comのような裸ドメイン）はリンク化しない", () => {
    const result = renderTextWithLinks("詳細はexample.comを参照");
    expect(result).toEqual(["詳細はexample.comを参照"]);
  });

  it("改行を含む文章でもURL部分だけを正しくリンク化する", () => {
    const result = renderTextWithLinks("注意事項です。\nhttps://example.com/notice\nよろしくお願いします。");
    const link = result.find((node) => isValidElement(node));
    expect(link.props.href).toBe("https://example.com/notice");
  });
});
