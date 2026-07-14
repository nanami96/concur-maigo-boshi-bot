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

---

## 新スキーマ（sample-company: 04_質問/05_選択肢/06_判定ルール）

旧スキーマ（company-a）が1シートに条件を横並びにした形式なのに対し、`sample-company` は質問・選択肢・判定ルールをそれぞれ独立したシートに分けた関係モデルを採用している。`scripts/generators/relationalSchema.js` が変換を担当する。

| Excelシート | Excel列 | config.json | 説明 |
| --- | --- | --- | --- |
| 01_基本設定 | 会社ID | company.company_id | 会社識別子 |
| 01_基本設定 | 会社名 | company.company_name | 会社名 |
| 02_ポリシー | ポリシーID | policies[].policy_id | ポリシー識別子 |
| 02_ポリシー | ポリシー名 | policies[].policy_name | ポリシー名 |
| 02_ポリシー | 使用有無 | policies[].enabled | 使用有無（"Y"/"N"） |
| 03_経費タイプ | 経費タイプID | expenseTypes[].id | 経費タイプ識別子 |
| 03_経費タイプ | ポリシーID | expenseTypes[].policyId | 紐づくポリシーID |
| 03_経費タイプ | 経費タイプ名 | expenseTypes[].name | Concur上の経費タイプ名 |
| 03_経費タイプ | 領収書有無 | expenseTypes[].receiptRequired | 領収書要否（真偽値） |
| 03_経費タイプ | 使用有無 | expenseTypes[].active | 使用有無（真偽値） |
| 04_質問 | 質問ID | questions[].id | 質問識別子（Q001形式、Excelの値のまま） |
| 04_質問 | 質問文 | questions[].text | Botに表示する質問文 |
| 04_質問 | 質問形式 | questions[].type | 質問形式 |
| 04_質問 | 質問の表示順 | questions[].displayOrder | 表示順（この順で最初の質問を決定） |
| 05_選択肢 | 選択肢ID | questions[].options[].id / .value | 選択肢識別子（O001形式、Excelの値のまま。value は id と同一） |
| 05_選択肢 | 質問ID | questions[].options[].questionId | 所属する質問ID |
| 05_選択肢 | ボタンに表示する文字 | questions[].options[].label | 選択肢の表示名 |
| 05_選択肢 | 次に質問する質問ID | questions[].options[].nextQuestionId | 空欄の場合は結果判定へ進む（undefined） |
| 06_判定ルール | ルールID | rules[].id | ルール識別子（r001形式） |
| 06_判定ルール | 判定対象の質問ID / 選択肢ID | rules[].conditions | `{ [質問ID]: 選択肢ID }` の単一条件 |
| 06_判定ルール | 表示する経費タイプID | rules[].resultExpenseTypeId | 判定結果となる経費タイプ |
| 06_判定ルール | ユーザーへ案内するメッセージ | rules[].message | ユーザーへの案内メッセージ |
| 06_判定ルール | 注意事項 | rules[].warningMessage | 注意事項 |

同一の質問ID・選択肢IDの組み合わせに複数のルール行がある場合（例: 複数の経費タイプが対応するケース）、`QuestionEngine.getResult()` は1件に絞らず `{ candidates: [...] }` を返し、React画面は「候補となる経費タイプ」として複数表示する。
