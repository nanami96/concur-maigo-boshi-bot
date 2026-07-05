# Excel → config.json マッピング設計

## 目的

Excelで管理している会社別ルールを、
Reactで読み込むための `config.json` に変換する際の対応関係を整理する。

## 基本方針

- Excelは人が編集しやすいようにシート分割する
- config.jsonはReactが読み込みやすいように1ファイルへ統合する
- Reactコードには業務ルールを書かない
- 会社ごとに rules/{companyId}/config.json を切り替えられるようにする

## 全体対応表

| Excelシート      | config.jsonのキー | 役割               |
| ---------------- | ----------------- | ------------------ |
| company_settings | company           | 会社基本情報       |
| policies         | policies          | ポリシー一覧       |
| expense_types    | expenseTypes      | 経費タイプ一覧     |
| questions        | questions         | Botで表示する質問  |
| rules            | rules             | 回答条件と判定結果 |

---

## company_settings → company

| Excel列      | config.json       | 説明             |
| ------------ | ----------------- | ---------------- |
| Company ID   | company.id        | 会社識別子       |
| Company Name | company.name      | 会社名           |
| Version      | company.version   | ルールバージョン |
| Updated At   | company.updatedAt | 最終更新日       |

---

## expense_types → expenseTypes

| Excel列           | config.json                    | 説明                   |
| ----------------- | ------------------------------ | ---------------------- |
| expense_type_id   | expenseTypes[].id              | 経費タイプ識別子       |
| policy_id         | expenseTypes[].policyId        | 紐づくポリシーID       |
| expense_type_name | expenseTypes[].name            | Concur上の経費タイプ名 |
| receipt_required  | expenseTypes[].receiptRequired | 領収書要否             |
| active            | expenseTypes[].active          | 使用有無               |
| display_order     | expenseTypes[].displayOrder    | 表示順                 |
| note              | expenseTypes[].note            | 補足・注意事項         |

---

## questions → questions

| Excel列          | config.json                          | 説明                                    |
| ---------------- | ------------------------------------ | --------------------------------------- |
| question_id      | questions[].id                       | 質問識別子                              |
| question_text    | questions[].text                     | Botに表示する質問文                     |
| question_type    | questions[].type                     | single-select / yes-no / free-text など |
| display_order    | questions[].displayOrder             | 表示順                                  |
| option_label     | questions[].options[].label          | 選択肢の表示名                          |
| option_value     | questions[].options[].value          | 選択肢の値                              |
| next_question_id | questions[].options[].nextQuestionId | 選択後に進む質問ID                      |

---

## rules → rules

| Excel列                | config.json                 | 説明                       |
| ---------------------- | --------------------------- | -------------------------- |
| rule_id                | rules[].id                  | ルールID                   |
| priority               | rules[].priority            | 判定優先順位               |
| policy_id              | rules[].policyId            | 対象ポリシー               |
| conditions             | rules[].conditions          | 判定条件                   |
| result_expense_type_id | rules[].resultExpenseTypeId | 判定結果となる経費タイプ   |
| message                | rules[].message             | ユーザーへの補足メッセージ |
| active                 | rules[].active              | 使用有無                   |

---

## policies → policies

| Excel列       | config.json             | 説明                 |
| ------------- | ----------------------- | -------------------- |
| policy_id     | policies[].id           | ポリシー識別子       |
| policy_name   | policies[].name         | Concur上のポリシー名 |
| description   | policies[].description  | ポリシー説明         |
| active        | policies[].active       | 使用有無             |
| display_order | policies[].displayOrder | 表示順               |
