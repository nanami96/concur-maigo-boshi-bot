// 質問ID(Q001形式)・選択肢ID(O001形式)を、既存IDと衝突しない次の番号で発番する。
// 管理画面が新規に質問・選択肢を作成するときだけ使う。既存データのIDはそのまま維持する。
export function generateNextId(existingIds, prefix, digits = 3) {
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;

  existingIds.forEach((id) => {
    const match = pattern.exec(id);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  });

  return `${prefix}${String(max + 1).padStart(digits, "0")}`;
}
