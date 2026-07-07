# Concur迷子防止Bot

SAP Concur Expense の経費タイプ選択を支援するチャット形式のガイドアプリです。

Excelで設定を管理し、config.json を自動生成してReactアプリから利用します。

## スクリーンショット

（後で追加予定）

## 概要

Concur導入時に

- どの経費タイプを選べばよいか
- どの条件ならどの経費タイプになるか

をチャット形式で案内するアプリです。

設定はExcelで管理し、generate-config.js により config.json を生成します。

## 特徴

- Excelから設定を生成
- 複数企業対応
- 経費タイプ判定Bot
- ルール可視化
- 設定漏れチェック
- Excel入力規則自動生成
- GitHub Actions（CI）
- 自動テスト（Vitest）

- ## ディレクトリ構成

```text
.
├── excel/                 # Excelテンプレート
├── rules/                 # 生成された config.json
│   ├── sample-company/
│   └── company-a/
├── scripts/
│   ├── generate-config.js
│   └── generators/
├── src/
│   ├── engine/
│   └── App.jsx
└── README.md
```

## セットアップ

### 1. リポジトリを取得

```bash
git clone <repository-url>
cd concur-maigo-boshi-bot
```

### 2. パッケージをインストール

```bash
npm install
```

## config.json の生成

Excelを編集した後、以下のコマンドを実行します。

Excelの入力規則を更新する場合は、元の `excel/{companyId}.xlsx` は直接変更せず、更新後のファイルを `excel/output/{companyId}.xlsx` に生成します。

```bash
npm run update:excel sample-company
```

サンプル会社

```bash
npm run generate:config sample-company
```

会社A

```bash
npm run generate:config company-a
```

生成された config.json は以下に出力されます。

```text
rules/
├── sample-company/
│   └── config.json
└── company-a/
    └── config.json
```

## アプリの起動

```bash
npm run dev
```

ブラウザで表示されたURLを開くと、Concur迷子防止Botが起動します。

## Excel構成

設定はExcelで管理します。

| シート名            | 内容           |
| ------------------- | -------------- |
| 99_company_settings | 会社設定       |
| 99_policies         | ポリシー一覧   |
| 99_expense_types    | 経費タイプ一覧 |
| 03\_判定ルール      | 判定ルール     |

## Roadmap

- [x] Excel → config.json 自動生成
- [x] 質問自動生成
- [x] ルール自動生成
- [x] 複数企業対応
- [x] Excelバリデーション
- [ ] テストコード追加
- [ ] UI改善
- [ ] Excelテンプレート改善
