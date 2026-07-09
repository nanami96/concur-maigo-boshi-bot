const { exportReport } = require("./report-generator");

const companyId = process.argv[2] || "sample-company";

try {
  const result = exportReport(companyId);
  console.log(`HTMLレポートを生成しました: ${result.outputPath}`);
} catch (error) {
  console.error("HTMLレポートの生成に失敗しました。");
  console.error(error.message);
  process.exit(1);
}
