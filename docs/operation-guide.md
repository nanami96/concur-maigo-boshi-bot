# Excel変更から画面反映までの操作マニュアル

このドキュメントは、担当者がExcelを編集してから、React画面、設定チェック、HTMLレポートへ反映するまでの基本手順をまとめたものです。

## 1. 全体の流れ

```text
Excel編集
↓
config.json生成
↓
React画面確認
↓
設定チェック確認
↓
HTMLレポート出力
```

基本的には、Excelを編集したあとに `config.json` を生成し、React画面とHTMLレポートで反映結果を確認します。

## 2. 担当者が編集するExcelシート

| シート | 編集するタイミング |
| --- | --- |
| `03_判定ルール` | 申請内容や条件に応じて、どの経費タイプへ案内するかを追加・変更するとき |
| `99_expense_types` | Concurで利用する経費タイプを追加・変更するとき |
| `99_policies` | ポリシーを追加・変更するとき |
| `99_company_settings` | 会社ID、会社名、標準ポリシーなど会社単位の基本設定を変更するとき |

Excelは、原則として次の構造を崩さないでください。

```text
1行目: ヘッダー
2行目: メタ情報、入力説明
3行目以降: データ
```

一部のシートでは2行目からデータを扱う場合があります。既存のシート構造に合わせて、途中に行を挿入せず、既存データの末尾へ追加してください。

## 3. 経費タイプを追加する手順

1. `99_expense_types` の既存データ末尾に、新しい経費タイプを追加します。
2. `expense_type_id`、`policy_id`、`expense_type_name`、`receipt_required`、`active` など必要な列を入力します。
3. `03_判定ルール` で、追加した経費タイプを判定結果として利用します。
4. 次のコマンドで `config.json` を生成します。

```bash
npm run generate:config sample-company
```

5. React画面で会社を選択し、チャットUI、ルール確認、判定フロー、設定チェックに反映されていることを確認します。
6. HTMLレポートを出力し、経費タイプ一覧、判定ルール一覧、設定チェック結果に反映されていることを確認します。

```bash
npm run export:report sample-company
```

## 4. 判定ルールを追加する手順

1. `03_判定ルール` の既存データ末尾に、新しい判定ルールを追加します。
2. 条件列に、質問の回答条件を入力します。
3. `経費タイプ` 列には、`99_expense_types` の `expense_type_name` に存在する名称を入力します。
4. 案内メッセージ、注意事項が必要な場合は入力します。
5. 次のコマンドで `config.json` を生成します。

```bash
npm run generate:config sample-company
```

6. React画面の「設定チェック」でErrorやWarningが出ていないか確認します。
7. 判定フローで、開始から結果まで自然につながっているか確認します。
8. 必要に応じてHTMLレポートを出力し、レビュー資料として確認します。

## 5. コマンド一覧

| コマンド | 用途 |
| --- | --- |
| `npm run generate:config sample-company` | `sample-company` のExcelから `rules/sample-company/config.json` を生成する |
| `npm run generate:config company-a` | `company-a` のExcelから `rules/company-a/config.json` を生成する |
| `npm run update:excel sample-company` | `sample-company` のExcel入力規則を生成し、`excel/output/sample-company.xlsx` へ出力する |
| `npm run export:report sample-company` | `reports/sample-company-review.html` を生成する |
| `npm test -- --run` | テストを一括実行する |
| `npm run dev` | React画面を起動してブラウザで確認する |

## 6. 確認ポイント

Excelを変更したあとは、次の観点で確認してください。

| 確認箇所 | 見るポイント |
| --- | --- |
| チャットUI | 回答に応じて期待する経費タイプへ案内されるか |
| ルール確認 | 質問、選択肢、判定ルール、経費タイプが想定どおり表示されるか |
| 判定フロー | 開始から質問、選択肢、結果までの流れが追えるか |
| 設定チェック | Error、Warning、Infoの内容を確認し、問題が残っていないか |
| 設定差分 | 比較用configを読み込んだ場合、追加・削除・変更が想定どおりか |
| AIレビューコメント | 良い点、改善候補、重要度がレビュー観点として妥当か |
| HTMLレポート | 会社情報、設定内容、設定チェック、判定フロー、レビューコメント欄が出力されているか |

## 7. よくある注意点

- `99_expense_types` に存在しない経費タイプを `03_判定ルール` で使うと、設定チェックでErrorになります。
- 経費タイプだけを追加し、どの判定ルールからも使わない場合はWarningになります。
- 開始質問から到達できない質問がある場合はWarningになります。
- Excelは、1行目ヘッダー、2行目メタ情報、3行目以降データの構造を崩さないでください。
- 既存データの途中に行を挿入せず、原則として末尾へ追加してください。
- `excel/output/` は入力規則を反映したExcelの生成先です。元のExcelとは別の生成物として扱います。
- `reports/` はHTMLレポートの生成先です。Excelやconfigを変更したあとは、必要に応じて再出力してください。
- Excelを変更しただけではReact画面やHTMLレポートには反映されません。必ず `npm run generate:config {companyId}` を実行してください。

