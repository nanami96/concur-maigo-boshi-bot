import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const vbaPath = path.join(
  process.cwd(),
  "scripts",
  "vba",
  "ConcurBotOperations.bas",
);

describe("ConcurBotOperations VBA module", () => {
  const source = fs.readFileSync(vbaPath, "utf8");

  function decodeCodePoints(codePoints) {
    return codePoints
      .trim()
      .split(/\s+/)
      .map((codePoint) => String.fromCodePoint(Number.parseInt(codePoint, 16)))
      .join("");
  }

  it("provides the public macros used from Excel buttons", () => {
    expect(source).toContain("Public Sub RunAllProcesses()");
    expect(source).toContain("Public Sub OpenReport()");
    expect(source).toContain("Public Sub StartBot()");
  });

  it("derives the project root from the workbook parent folder", () => {
    expect(source).toContain("GetProjectRootFromWorkbookPath(ThisWorkbook.Path)");
    expect(source).toContain("fileSystem.GetParentFolderName(workbookFolder)");
  });

  it("runs only fixed project batch files with quoted paths", () => {
    expect(source).toContain('batchPath = projectRoot & "\\run-all.bat"');
    expect(source).toContain('batchPath = projectRoot & "\\start-bot.bat"');
    expect(source).toContain('"cmd.exe /c " & QuotePath(batchPath)');
    expect(source).toContain('QuotePath = """" & Replace(pathValue, """", """""") & """"');
  });

  it("shows errors when the expected batch files do not exist", () => {
    expect(source).toContain('If Dir(batchPath) = "" Then');
    expect(source).toContain("MessageRunAllMissing()");
    expect(source).toContain("MessageStartBotMissing()");
  });

  it("keeps the .bas source ASCII-only for VBE import compatibility", () => {
    expect([...source].every((character) => character.codePointAt(0) < 128)).toBe(
      true,
    );
    expect(source).toContain("ChrW(");
  });

  it("builds the intended Japanese messages from code points", () => {
    const titleCodePoints = source.match(/AppTitle = J\("([^"]+)"\)/)?.[1];
    const saveMessageCodePoints = source.match(
      /MessageSaveFirst = J\("([^"]+)"\)/,
    )?.[1];
    const runAllMessageCodePoints = source.match(
      /MessageRunAllMissing = J\("([^"]+)"\)/,
    )?.[1];

    expect(decodeCodePoints(titleCodePoints)).toBe("Concur迷子防止Bot");
    expect(decodeCodePoints(saveMessageCodePoints)).toBe(
      "先にExcelファイルを保存してください。",
    );
    expect(decodeCodePoints(runAllMessageCodePoints)).toBe(
      "run-all.bat が見つかりません。",
    );
  });
});
