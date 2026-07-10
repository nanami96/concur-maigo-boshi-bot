# Concur迷子防止Bot

SAP Concur Expense の経費タイプ選択を支援するチャット形式のガイドアプリです。

Excelで設定を管理し、`config.json` を自動生成して React アプリから利用します。

また、Concurコンサルタント向けに設定レビュー・品質チェック・レポート出力機能も提供します。

Excel編集から画面確認・HTMLレポート出力までの手順は [操作マニュアル](docs/operation-guide.md) を参照してください。

---

# スクリーンショット

（後で追加予定）

---

# 概要

Concur導入時に

- どの経費タイプを選べばよいか
- どの条件ならどの経費タイプになるか

をチャット形式で案内するアプリです。

設定はExcelで管理し、`generate-config.js` により `config.json` を生成します。

さらに、生成した設定をレビューするために

- ルール可視化
- 判定フロー可視化
- 設定チェック
- 設定差分比較
- HTMLレビュー資料出力

まで対応しています。

---

# 主な機能

## 設定生成

- Excel → config.json 自動生成
- 複数企業対応
- メタ情報管理
- Excel入力規則自動生成

## ガイド機能

- チャット形式で経費タイプを案内
- Question Engine による判定

## レビュー機能

- ルール一覧表示
- 判定フロー可視化
- 設定検索
- 設定漏れチェック
- 設定差分比較
- 比較用 config.json 読込

## レポート機能

- HTMLレビュー資料出力
- 印刷対応
- PDF保存対応（ブラウザ）

## 品質管理

- GitHub Actions（CI）
- Vitest
- 設定バリデーション

---

# ディレクトリ構成

```text
.
├── excel/                     # Excelテンプレート
│   └── output/                # 入力規則更新後のExcel
│
├── reports/                   # HTMLレビュー資料
│
├── rules/
│   ├── sample-company/
│   │   └── config.json
│   └── company-a/
│       └── config.json
│
├── scripts/
│   ├── generate-config.js
│   ├── update-excel-template.js
│   ├── export-report.js
│   └── report-generator.js
│
├── src/
│   ├── engine/
│   ├── App.jsx
│   └── ...
│
├── tests/
│
└── README.md
```

---

# セットアップ

## 1. リポジトリ取得

```bash
git clone <repository-url>
cd concur-maigo-boshi-bot
```

## 2. パッケージインストール

```bash
npm install
```

---

# VS Codeを使わない運用方法

Windowsでは、プロジェクト直下のバッチファイルをダブルクリックして主要な操作を実行できます。

| ファイル | 実行内容 |
| --- | --- |
| `generate-config.bat` | `sample-company` の `config.json` を生成します |
| `update-excel.bat` | `sample-company` の入力規則付きExcelを `excel/output/` に出力します |
| `export-report.bat` | `sample-company` のHTMLレポートを `reports/` に出力します |
| `start-bot.bat` | React画面を起動します |
| `run-all.bat` | Excel更新、config生成、HTMLレポート出力、React画面起動を順番に実行します |

通常運用では、Excelを編集したあとに `run-all.bat` を実行すると、画面確認とレポート出力までまとめて進められます。

---

# Excelの「設定を反映する」ボタン

Windows版Excelでは、マクロ有効版の `.xlsm` を別ファイルとして作成し、Excel内のボタンから `run-all.bat` を起動できます。

- 元の `excel/sample-company.xlsx` は変更せず、`excel/sample-company.xlsm` を別名保存して利用します。
- VBAモジュールは `scripts/vba/ConcurBotOperations.bas` にあります。
- 会社PCでマクロが禁止されている場合は、プロジェクト直下の `run-all.bat` を利用してください。
- `run-all.bat` が見つからない場合は、`.xlsm` が `excel/` フォルダ内にあり、`run-all.bat` がプロジェクト直下にあるか確認してください。

マクロ有効版の作成、VBAインポート、ボタン配置、「コンテンツの有効化」の手順は [Excelに「設定を反映する」ボタンを追加する手順](docs/excel-macro-button.md) を参照してください。

---

# config.json の生成

Excelを編集後、以下を実行します。

## sample-company

```bash
npm run generate:config sample-company
```

## company-a

```bash
npm run generate:config company-a
```

生成先

```text
rules/
├── sample-company/
│   └── config.json
└── company-a/
    └── config.json
```

---

# Excel入力規則更新

元のExcelは変更せず、

更新後のファイルを

```text
excel/output/
```

へ生成します。

```bash
npm run update:excel sample-company
```

---

# アプリ起動

```bash
npm run dev
```

ブラウザに表示されたURLを開きます。

---

# HTMLレビュー資料出力

レビュー資料をHTML形式で出力できます。

## sample-company

```bash
npm run export:report sample-company
```

## company-a

```bash
npm run export:report company-a
```

生成先

```text
reports/
├── sample-company-review.html
└── company-a-review.html
```

出力内容

- 会社情報
- 質問一覧
- 判定ルール一覧
- 経費タイプ一覧
- 設定チェック
- 判定フロー概要
- 設定差分

---

# Excel構成

| シート              | 内容           |
| ------------------- | -------------- |
| 99_company_settings | 会社設定       |
| 99_policies         | ポリシー一覧   |
| 99_expense_types    | 経費タイプ一覧 |
| 03\_判定ルール      | 判定ルール     |

---

# テスト

すべて実行

```bash
npm test -- --run
```

GitHub Actionsでも自動実行されます。

---

# Roadmap

## 完了

- [x] Excel → config.json 自動生成
- [x] 質問生成
- [x] ルール生成
- [x] 複数企業対応
- [x] Excel入力規則自動生成
- [x] GitHub Actions
- [x] 自動テスト
- [x] ルール可視化
- [x] 判定フロー可視化
- [x] 設定チェック
- [x] 設定検索
- [x] 設定差分比較
- [x] 比較用config読込
- [x] HTMLレビュー資料出力
- [x] HTMLレポート改善

## 今後

- [ ] PDF出力
- [ ] Wordレポート出力
- [ ] Excelファイル同士の差分比較
- [ ] 判定フロー画像出力
- [ ] WalkMe連携
- [ ] SAP Concur API連携

---

# Release History

## v1.7.0

### AI Review Assistant

- AIレビューコメント生成機能を追加
- 良い点・改善候補を自動表示
- React画面へAIレビューコメントを追加
- HTMLレビュー資料へAIレビューコメントを追加
- reviewAdvisorCore にレビューコメント生成ロジックを共通化
- HTMLレポートの印刷・PDF保存レイアウトを改善

## v1.6.0

### Review Workflow Improvements

- HTMLレポートへ設定差分を追加
- React・HTMLで差分判定ロジックを共通化
- レビューコメント欄を追加
- レビュー担当・レビュー日・備考欄を追加
- レビュー結果チェック欄を追加
- 印刷・PDF保存向けレイアウト改善

## v1.5.0

### Review & Report Improvements

- 比較用config読込
- 設定差分比較
- 差分詳細表示
- HTMLレビュー資料出力
- HTMLレポートデザイン改善

## v1.4.0

### HTML Report

- HTMLレビュー資料出力

## v1.3.0

### Flow Visualization

- 判定フロー可視化
- 設定差分比較
- 設定検索

## v1.2.0

### Review Support

- ルール可視化
- 設定チェック

## v1.1.0

### Excel Improvements

- Excel入力規則自動生成
- GitHub Actions
- バリデーション強化

---

# License

MIT License
