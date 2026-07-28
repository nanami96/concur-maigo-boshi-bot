# Concur迷子防止Bot

SAP Concur Expense の経費タイプ選択を支援するチャット形式のガイドアプリです。

質問に答えていくだけで、どの経費タイプを選べばよいか・入力のポイント・領収書の要否を案内します。

設定（質問・選択肢・判定ルール・経費タイプ・ポリシー）はExcelまたは管理画面（`#admin`）で作成でき、Supabaseを使う運用ではログイン・複数企業対応・下書き保存/公開までを管理画面から行えます。Supabaseを使わないローカル/デモ運用では、Excelから生成した`config.json`を直接読み込みます（下記「動作モード」参照）。

Concurコンサルタント向けに、設定レビュー・品質チェック・レポート出力機能も提供します。

Excel編集から画面確認・HTMLレポート出力までの手順は [操作マニュアル](docs/operation-guide.md) を、Supabaseのセットアップ手順は [Supabaseセットアップガイド](docs/supabase-setup.md) を参照してください。

---

# スクリーンショット

（後で追加予定）

---

# 動作モード

このアプリには、`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` の設定有無で切り替わる2つの動作モードがあります（`src/lib/supabaseClient.js`）。

## ローカル/デモモード（Supabase未設定）

- ログイン不要。会社セレクタで `rules/*/config.json`（Excelから生成した静的ファイル）を選んで試せます。
- 管理画面（`#admin`）も認証なしで開けます（「ローカル開発モードで動作しています」と表示されます）。
- 領収書OCR機能は利用できません（後述の通りログイン中ユーザー専用のため）。

## Supabase運用モード（Supabase設定済み）

- 利用者はメールアドレス＋パスワードでログインし、招待コードで自社に参加します。
- 会社ごとの設定は管理画面で編集し、「下書きを保存」→「公開する」を経てはじめて利用者側Botに反映されます。
- ログイン中の利用者は領収書OCR（Azure AI Document Intelligence）を利用できます。
- 詳細は後述の「Supabase運用（認証・管理画面）」を参照してください。

---

# 概要

Concur導入時に

- どの経費タイプを選べばよいか
- どの条件ならどの経費タイプになるか

をチャット形式で案内するアプリです。

設定はExcelまたは管理画面で管理します。Excelから読み込む場合は`generate-config.js`により`config.json`を生成し、管理画面で編集する場合はSupabase（`draft_configs`/`published_versions`）に保存・公開されます。

さらに、生成した設定をレビューするために

- ルール可視化
- 判定フロー可視化
- 設定チェック
- 設定差分比較
- HTMLレビュー資料出力

まで対応しています。

---

# 主な機能

## エンドユーザー向けBot機能

- チャット形式で経費タイプを案内（Question Engineによる判定、`src/engine/QuestionEngine.js`）
- 領収書の写真から日付・支払先・金額を読み取るOCR機能（Azure AI Document Intelligence、Supabase運用モードのログイン中ユーザーのみ）
- PWA対応（ホーム画面への追加・オフライン時のアプリシェル表示）

## Supabase運用（認証・管理画面）

- メールアドレス＋パスワードでのログイン・サインアップ、パスワード再設定
- 招待コードによる会社への参加（利用者は`user`ロール、管理者は`admin`ロールとして`company_members`に登録）
- サービス運営者向けの`platform_admin`ロール（全社横断で会社の作成・削除、招待コードの再発行が可能）
- 管理画面（`#admin`、PC専用）：会社の基本設定・ポリシー・経費タイプの編集、質問フローの編集・ツリー表示・プレビュー、設定チェック、Excelからの初期データ取り込み、下書き保存・公開、ユーザー管理（ロール変更・削除・招待コード再発行）
- 詳細は [Supabaseセットアップガイド](docs/supabase-setup.md) を参照

## SAP Concur API連携（設計・スタブ実装段階）

- 迷子防止Bot内部の経費データ→Concur向け共通データへの変換、経費タイプIDのマッピング設計（`src/lib/concurExpenseData.js`、`src/lib/concurExpenseTypeMapping.js`）
- Quick Expense作成用のSupabase Edge Function（`supabase/functions/create-concur-quick-expense/`）：認証・入力検証・エラー処理まで実装済み
- **現時点では実際のConcur APIへは接続していません**（固定のスタブ応答を返すのみ）。Concur側の認証情報も未登録です

## 設定生成（Excel）

- Excel → config.json 自動生成
- 複数企業対応
- メタ情報管理
- Excel入力規則自動生成

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
- Vitest（`tests/`配下に単体テストを多数配置）
- 設定バリデーション

---

# ディレクトリ構成

```text
.
├── docs/                       # セットアップ・運用マニュアル
│
├── excel/                      # Excelテンプレート
│   └── output/                 # 入力規則更新後のExcel
│
├── reports/                    # HTMLレビュー資料
│
├── rules/                      # Excelから生成したconfig.json（ローカル/デモモード用）
│   ├── sample-company/
│   │   └── config.json
│   └── company-a/
│       └── config.json
│
├── scripts/
│   ├── generate-config.js
│   ├── update-excel-template.js
│   ├── export-report.js
│   ├── report-generator.js
│   └── admin-set-user-password.js  # Supabase Authユーザーへパスワードを設定する管理用スクリプト
│
├── src/
│   ├── admin/                  # 管理画面（認証・質問フロー編集・ユーザー管理等）
│   ├── data/                   # Supabase/Edge Functionsとの通信（Repository層）
│   ├── engine/                 # Question Engine（判定ロジック）
│   ├── flow/                   # Excel解析・質問フロー変換・設定チェック
│   ├── lib/                    # Supabaseクライアント・Concur連携用の純粋関数等
│   ├── App.jsx                 # ローカル/デモモードのエンドユーザー画面
│   ├── AuthenticatedBotScreen.jsx  # Supabase運用モードのエンドユーザー画面
│   └── ...
│
├── supabase/
│   ├── schema.sql               # テーブル・RLS・RPC定義
│   └── functions/
│       ├── ocr-receipt/                  # 領収書OCR（Azure AI Document Intelligence）
│       └── create-concur-quick-expense/  # Concur Quick Expense作成（現状スタブ）
│
├── tests/                       # Vitestによる単体テスト
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

## 3. （任意）Supabaseを使う場合

Supabaseを使わず、ローカル/デモモードだけで試す場合はこの手順は不要です。

Supabase運用モード（ログイン・管理画面での保存・公開・OCR等）を使う場合は、`.env.example`を`.env.local`にコピーして`VITE_SUPABASE_URL`・`VITE_SUPABASE_ANON_KEY`を設定してください。手順の詳細は [Supabaseセットアップガイド](docs/supabase-setup.md) を参照してください。

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

# GitHub Pages公開版

ReactアプリはGitHub Pagesで公開できます（`.github/workflows/deploy-pages.yml`、`main`ブランチへのpushで自動デプロイ）。

公開URL:

```text
https://nanami96.github.io/concur-maigo-boshi-bot/
```

公開ビルドは`VITE_PUBLIC_DEMO=true`に加え、`VITE_SUPABASE_URL`・`VITE_SUPABASE_ANON_KEY`をGitHub Secretsから注入してビルドします（`.github/workflows/deploy-pages.yml`）。これらのSecretsが設定されていればSupabase運用モード（ログイン・招待コード等）として動作し、未設定であれば`sample-company`のみを含むローカル/デモモード相当として動作します（動作の切り替えは前述「動作モード」の通り、ビルド時の環境変数の有無で決まります）。

実顧客データ、`company-a`、Excelファイル、HTMLレポート、スクリプト、`.xlsm`、ローカルパス、Supabaseの`service_role`キーは公開対象に含めないでください（`service_role`キーはこのリポジトリのどこにも書かず、`.env.admin.local`からのみ読み込む設計です。詳細は [Supabaseセットアップガイド](docs/supabase-setup.md) 参照）。

GitHub Pagesを有効化する手順:

1. GitHubでリポジトリを開きます。
2. `Settings` → `Pages` を開きます。
3. `Build and deployment` の `Source` を `GitHub Actions` に変更します。
4. `main` ブランチへpushするか、`Deploy GitHub Pages` ワークフローを手動実行します。
5. デプロイ完了後、上記URLで画面が表示されることを確認します。

Privateリポジトリでは、GitHubのプランによってPagesを利用できない場合があります。

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

Supabase運用モードでは、ここで生成した`config.json`は管理画面の初期表示（下書きが未保存の場合のフォールバック）や、管理画面のExcelインポート機能の元データとして使われます。ログイン中の利用者に実際に表示される設定は、管理画面で「公開する」を実行した内容（Supabaseの`published_versions`）です。

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

ブラウザに表示されたURLを開きます。`.env.local`が無い（またはSupabaseの値が空の）場合はローカル/デモモードで起動します。

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

`sample-company` は新スキーマ（関係モデル）、`company-a` は旧スキーマを使用しており、`scripts/generate-config.js` はワークシートに `04_質問` が存在するかどうかで自動的に読み込み方式を切り替える。

## 新スキーマ（sample-company）

| シート     | 内容                                             |
| ---------- | ------------------------------------------------ |
| 01_基本設定 | 会社ID・会社名                                    |
| 02_ポリシー | ポリシーID・ポリシー名・使用有無                  |
| 03_経費タイプ | 経費タイプID・ポリシーID・経費タイプ名・領収書有無・使用有無 |
| 04_質問     | 質問ID（Q001形式）・質問文・質問形式・表示順      |
| 05_選択肢   | 選択肢ID（O001形式）・質問ID・ボタン表示文字・次に質問する質問ID |
| 06_判定ルール | ルールID（r001形式）・質問ID・選択肢ID・経費タイプID・案内メッセージ・注意事項 |

同一の質問ID・選択肢IDに対して複数の判定ルール行が存在する場合、React画面は結果を1件に絞らず「候補となる経費タイプ」として複数表示する。

このExcelは、新規会社の初期データ作成（管理画面の初回セットアップ画面からの取り込み）にも使われる。取り込んだ内容は管理画面上の下書きとなり、「公開する」を実行するまで利用者側Botには反映されない。

## 旧スキーマ（company-a）

| シート              | 内容           |
| ------------------- | -------------- |
| 99_company_settings | 会社設定       |
| 99_policies         | ポリシー一覧   |
| 99_expense_types    | 経費タイプ一覧 |
| 03\_判定ルール      | 判定ルール     |

---

# Supabase運用（認証・管理画面）

Supabase運用モードで有効になる機能の現状です。実装の詳細・セットアップ手順は [Supabaseセットアップガイド](docs/supabase-setup.md)、テーブル・RLS・RPCの定義は `supabase/schema.sql` を参照してください。

## 認証

- メールアドレス＋パスワードでのログイン・サインアップが基本の認証方法です。
- 管理画面（`#admin`）ではマジックリンクによるログインも利用できます。
- パスワード再設定（メール送信→再設定画面）に対応しています。
- OAuth（Google等）・SSOは実装していません。

## ロールと会社の関係

- 会社ごとの所属は`company_members`テーブルで管理し、`role`は`user`（自社Bot利用のみ）または`admin`（管理画面の編集・公開・ユーザー管理が可能）です。
- 1ユーザーは最大1社にのみ所属できます（`company_members.user_id`のユニーク制約）。
- `platform_admins`テーブルに登録された運営者は、`company_members`の所属とは独立に、全社を横断して会社の作成・削除、招待コードの再発行ができます（登録はSupabase側から手動で行う運用です）。

## 会社への参加（招待コード）

1. 運営者（platform_admin）が管理画面から会社を作成すると、招待コードが一度だけ表示されます。
2. 利用者はこのコードを入力してサインアップし、確認メールのリンクを開くと自動的に自社の`company_members`（`role: user`）へ登録されます。
3. 最初の管理者（`role: admin`）への昇格は、運営者が管理画面のユーザー管理から行います。

## 下書き保存・公開

- 管理画面での編集内容は`draft_configs`テーブルへの下書きとして保存されます（「下書きを保存」ボタン）。
- 「公開する」を実行すると、下書きの内容が`published_versions`テーブルへ追記され、利用者側Botはその内容を参照するようになります。
- 設定チェックでエラーが残っている場合は公開できません。

---

# 領収書OCR

Supabase運用モードでログイン中の利用者は、経費申請前に領収書の写真から日付・支払先・金額を読み取れます。

- OCRエンジンは **Azure AI Document Intelligence**（prebuilt-receiptモデル）を使用しています（Google Cloud Vision等、他のOCRサービスは使用していません）。
- Azure側のAPIキーはSupabase Edge Function（`supabase/functions/ocr-receipt/`）専用のSecretとして保存され、フロントエンド（ブラウザ）には一切渡りません。
- OCRの結果は経費タイプの判定には使用しません（判定は質問フローの回答のみで行います）。
- ローカル/デモモード（Supabase未設定）では利用できません。

---

# SAP Concur API連携（現状）

**現時点で実際のConcur APIとの通信は一切行っていません。** 将来の連携に向けた設計・土台のみが実装済みです。

実装済み:

- 迷子防止Botの経費判定結果・OCR結果から、Concur送信前の共通経費データを組み立てる純粋関数（`src/lib/concurExpenseData.js`）と、その検証関数
- 迷子防止Bot内部の経費タイプIDをConcur側の識別子へ変換するマッピングの設計（`src/lib/concurExpenseTypeMapping.js`、マッピング表は引数で受け取る設計で、まだ実データは無し）
- Quick Expense作成用のSupabase Edge Function `create-concur-quick-expense`（`supabase/functions/create-concur-quick-expense/`）：Supabaseユーザー認証（JWT検証＋会社所属確認）、入力検証、共通エラー形式までを実装済み
- フロントエンド（`src/data/concurApi.js`）から上記Edge Functionを呼び出す`createQuickExpense()`

未実装（今後の対応が必要）:

- Concur APIへの実際のHTTPリクエスト・OAuth認証・アクセストークンの取得（`create-concur-quick-expense`は現在**固定のスタブ応答**を返すのみです）
- Concur側の認証情報（Client ID/Secret等）の登録（Supabase Secretsへの登録は未実施）
- 領収書画像のConcurへのアップロード連携
- 会社ごとにConcur連携を許可するかどうかの設定（テーブル・フラグとも未設計）

---

# テスト

すべて実行

```bash
npm test -- --run
```

`tests/`配下に、判定ロジック・Excel変換・Supabase認証まわり・Edge Functionの入力検証等の単体テストがあります。GitHub Actions（CI）でも自動実行されます。

---

# Roadmap

## 完了

- [x] Excel → config.json 自動生成
- [x] 質問生成
- [x] ルール生成
- [x] 複数企業対応（Excel）
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
- [x] Supabaseによるユーザー認証（メール+パスワード、招待コード、パスワード再設定）
- [x] 管理画面からの質問フロー編集・下書き保存・公開
- [x] 複数企業対応（Supabase、運営者による会社作成・削除を含む）
- [x] 管理画面からのユーザー管理（ロール変更・削除・招待コード再発行）
- [x] 領収書OCR（Azure AI Document Intelligence）
- [x] PWA対応

## 進行中

- [ ] SAP Concur API連携（共通データ生成・IDマッピング設計・Edge Function土台は完了、実際のConcur API通信は未実装）

## 今後

- [ ] PDF出力
- [ ] Wordレポート出力
- [ ] Excelファイル同士の差分比較
- [ ] 判定フロー画像出力
- [ ] WalkMe連携
- [ ] 会社ごとのConcur連携許可設定

---

# Release History

`v1.0.0`〜`v1.7.0`はExcel→config.json生成・レビュー機能を中心としたリリース履歴です。**v1.7.0以降、Supabaseによる認証・管理画面・領収書OCR・Concur API連携（設計/スタブ）が追加されていますが、この区間はバージョンタグを付けていないため、個別のリリースnoteはありません。** 現時点の実装内容は本README上部の各セクション（特に「Supabase運用」「領収書OCR」「SAP Concur API連携（現状）」）を正としてください。

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
