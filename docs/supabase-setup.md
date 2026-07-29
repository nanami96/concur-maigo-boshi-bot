# Supabaseセットアップガイド（管理画面の永続化・認証 Phase 1）

このガイドは、Supabaseを触ったことが無い人向けに、Step 1から順番に進めれば
管理画面（`#admin`）にログインできるようになるところまでを説明します。

今回のPhase 1でできるようになること：

- `#admin` にアクセスするとログインが必要になる（メールでログインリンクを受け取る方式）
- 会社ごとに「誰が編集できるか」をデータベース側で管理する土台ができる

今回のPhase 1では **まだ実装していないもの**（後続Phase）：

- 下書きの自動保存・再読み込みでの復元
- 「公開する」ボタン・公開履歴
- 本番Bot側がSupabaseから設定を取得すること（本番Botは今まで通りconfig.jsonを読みます）

Supabaseを何も設定しなくても、今まで通り `npm run dev` でローカル管理画面を使い続けられます
（「ローカル開発モード」という表示が出ます）。急いでSupabaseを用意する必要はありません。

---

## Step 1. Supabaseアカウントを作成する

1. ブラウザで https://supabase.com を開きます。
2. 「Start your project」等のボタンからサインアップします（GitHubアカウントでのサインアップが簡単です）。

## Step 2. 新規Projectを作成する

1. Supabaseダッシュボードで「New Project」を選びます。
2. 組織（Organization）を選ぶ・作成します（個人利用なら自分の名前のもので構いません）。
3. Project名を入力します（例：`concur-maigo-boshi-bot`）。
4. データベースのパスワードを設定します（自動生成でよいですが、忘れないように控えてください）。
5. リージョンは日本から近い場所（例：`Northeast Asia (Tokyo)`）を選ぶと応答が速くなります。
6. 「Create new project」をクリックします。数分待つとProjectが使えるようになります。

## Step 3. Project URLを取得する

1. 左メニューの歯車アイコン「Project Settings」を開きます。
2. 「API」を選びます。
3. 「Project URL」という欄に表示されている `https://xxxxxxxx.supabase.co` の形式のURLをコピーします。
   → これが `VITE_SUPABASE_URL` になります。

## Step 4. anon / publishable keyを取得する

同じ「Project Settings」→「API」の画面に、鍵（キー）の一覧があります。

- **`anon` `public`**（または新しいSupabaseでは **`publishable`** と表示される場合があります）という名前の鍵をコピーします。
  → これが `VITE_SUPABASE_ANON_KEY` になります。
- **絶対に `service_role` という名前の鍵はコピーしないでください。** これは全ての保護（RLS）を無視できる強力な鍵で、
  アプリのコードや`.env.local`に書いてはいけません。今回のPhase 1では一切使いません。

## Step 5. SQL Editorで schema.sql を実行する

1. 左メニューの「SQL Editor」を開きます。
2. 「New query」をクリックします。
3. このリポジトリの [`supabase/schema.sql`](../supabase/schema.sql) の中身を全てコピーし、SQL Editorに貼り付けます。
4. 右下の「Run」（または `Ctrl+Enter`）で実行します。
5. エラーが出ずに完了すれば成功です。「Table Editor」を開くと、
   `companies` / `company_members` / `draft_configs` / `published_versions` の4つのテーブルが
   作成されていることを確認できます。

**既に以前のバージョンの`schema.sql`を実行済みの場合**：`authenticated`ロールへの
テーブル権限（GRANT）が追加されています。既存プロジェクトを壊さず追加できるので、
以下のSQLだけを追加でSQL Editorに貼り付けて実行してください（`schema.sql`全体を
再実行しても問題ありませんが、差分だけで十分です）。

```sql
grant select, update on companies to authenticated;
grant select on company_members to authenticated;
grant select, insert, update, delete on draft_configs to authenticated;
grant select, insert on published_versions to authenticated;
```

## Step 6. Auth設定を確認する

1. 左メニューの「Authentication」→「Providers」を開きます。
2. 「Email」プロバイダが有効になっていることを確認します（通常は最初から有効です）。
3. 「Authentication」→「Sign In / Providers」あるいは「Email」の詳細設定で、
   「Confirm email」等の設定は初期値のままで問題ありません。

このアプリはパスワードを使わず、メールに届く「ログインリンク（Magic Link）」だけでログインします。

## Step 7. Site URL / Redirect URLsを設定する

1. 「Authentication」→「URL Configuration」を開きます。
2. **Site URL** に、普段よくアクセスするURLを1つ設定します（開発中は `http://localhost:5173` で構いません）。
3. **Redirect URLs** に、ログインリンクをクリックした後に戻ってきてよいURLを **全て** 追加します。
   最低限、次の2つを追加してください（後述のStep 8・9で説明する通りです）。

   ```text
   http://localhost:5173/*
   https://nanami96.github.io/concur-maigo-boshi-bot/*
   ```

   末尾の `*` はワイルドカードです（Supabaseの管理画面でワイルドカードが使えない場合は、
   `http://localhost:5173/` と `https://nanami96.github.io/concur-maigo-boshi-bot/` を
   そのまま登録してください）。

## Step 8. ローカル開発（localhost）用のRedirect URLについて

このアプリは `npm run dev` で起動すると、通常 `http://localhost:5173/` で開きます
（ポート番号は空いているポートによって変わることがあります。実際に表示されたURLを確認してください）。

管理画面はハッシュ付きの `http://localhost:5173/#admin` でアクセスします。ログインリンクは
「今アクセスしているURL（`#admin`を除いた部分）」に戻ってくるように、アプリ側であらかじめ
組み立てています（コード変更不要）。`#admin`を含めていないのは、Supabaseがログイン完了後に
URLへ認証情報（`?code=...`）を埋め込んで戻ってくるため、あらかじめ`#admin`を含めておくと
衝突する可能性があるためです。実際の画面遷移としては、メールのリンクをクリックすると
一旦ハッシュ無しのURLに戻り、アプリ側でログインセッションを確立した直後に自動的に
`#admin` へ切り替わるため、利用者からは違和感なく管理画面が開いて見えます。
ポート番号が変わった場合は、Step 7のRedirect URLsにそのポート番号のURLも追加してください。

## Step 9. GitHub Pages公開URL用のRedirect URLについて

このプロジェクトのGitHub Pages公開URLは次の通りです（`vite.config.js` の `base` 設定と
`README.md` に記載の公開URLから確認済みです）。

```text
https://nanami96.github.io/concur-maigo-boshi-bot/
```

管理画面は `https://nanami96.github.io/concur-maigo-boshi-bot/#admin` でアクセスします。
Step 7で追加した通り、このURLをRedirect URLsに含めてください。

**注意**：GitHub Actionsのシークレットに`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`を
登録するまでは、GitHub Pagesビルドは今まで通り「ローカル開発モード相当」（Supabase未接続、
静的configのみ）でビルドされます。登録方法はStep 14を参照してください。

## Step 10. .env.localを作る

プロジェクトのルートフォルダで、[`.env.example`](../.env.example) をコピーして
`.env.local` を作成します。

```bash
cp .env.example .env.local
```

`.env.local` をエディタで開き、Step 3・Step 4で取得した値を入力します。

```text
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=（anon / publishable key）
```

`.env.local` は `.gitignore` に登録済みのため、Gitには一切コミットされません。

## Step 11. 最初のユーザーを作成してログインする

1. `.env.local` を保存した状態で `npm run dev` を実行し、表示されたURLの末尾に `#admin` を付けて開きます。
2. 「管理画面ログイン」画面が表示されます。自分のメールアドレスを入力し、「ログインリンクを送信」を押します。
3. 入力したメールアドレス宛にSupabaseからメールが届きます。メール内のリンクをクリックしてください。
4. リンクをクリックすると、ブラウザが `#admin` に戻ってきて、ログイン済みの状態になります。

これでSupabase側に「auth.users」ユーザーが1件作成されました。ただし、この時点では
まだどの会社にも紐付いていないため、次のStep 12が必要です。

## Step 12. companies / company_membersへ初期登録する

Supabaseダッシュボードの「Authentication」→「Users」で、Step 11で作成したユーザーの
**User UID**（uuid形式の文字列）をコピーします。

次に「SQL Editor」で、以下のSQLを実行します（`<user_id>` の部分をコピーしたUUIDに置き換えてください）。

```sql
-- 1. 会社を作成する（sample-companyの例）
insert into companies (company_code, company_name)
values ('sample-company', 'サンプル会社')
returning id;
```

実行結果に表示された `id`（会社のuuid）をコピーし、次のSQLの `<company_id>` に置き換えて実行します。

```sql
-- 2. さきほど作った会社に、自分自身を管理者として紐付ける
insert into company_members (company_id, user_id, role)
values ('<company_id>', '<user_id>', 'admin');
```

これで、Step 11でログインしたユーザーが `sample-company` の管理者として登録されました。

複数の会社を用意したい場合は、会社ごとに手順1〜2を繰り返してください。

## Step 13. ローカルでの動作確認

1. `npm run dev` を実行し、`#admin` を開きます。
2. 既にログイン済みであれば、そのまま管理画面（従来通りのAdminRoot）が表示されます。
   ログアウトされていた場合は、Step 11と同じ手順で再度ログインしてください。
3. 管理画面が表示されれば成功です。今回のPhase 1では「下書きの保存」機能はまだ無いため、
   編集内容は今まで通りブラウザを閉じると失われます。
4. 画面右上に「ログアウト」ボタンが表示されます。押すとログアウトされ、`#admin` は
   再びログイン画面に戻ります。

### うまくいかない場合の確認ポイント

- `.env.local` の2つの値に余分な空白・改行が入っていないか
- Redirect URLsに、実際にアクセスしているURL（ポート番号含む）が登録されているか
- ログインリンクのメールが届かない場合は、迷惑メールフォルダも確認する
- Supabaseの「Authentication」→「Users」に自分のメールアドレスのユーザーが作成されているか
- `company_members` に正しい `user_id` ・`company_id` の組み合わせが登録されているか

## Step 14. GitHub Pages本番でSupabaseの公開設定を動的取得できるようにする

ここまではローカル（`npm run dev`）だけの設定でした。この章では、GitHub Pagesで
公開している本番URL（`https://nanami96.github.io/concur-maigo-boshi-bot/`）の
利用者Bot画面でも、管理画面で「公開する」を押した最新設定を取得できるようにします。

**GitHubの操作に慣れていない方向けに、1手ずつ説明します。**

1. ブラウザでこのリポジトリのGitHubページを開きます
   （例：`https://github.com/<あなたのアカウント>/concur-maigo-boshi-bot`）。
2. 上部タブの「Settings」をクリックします
   （リポジトリの設定画面。自分のGitHubアカウント全体の設定ではありません）。
3. 左メニューの「Secrets and variables」→「Actions」をクリックします。
4. 「Secrets」タブが選ばれていることを確認し、右上の「New repository secret」ボタンを押します。
5. 以下の内容で1つ目のシークレットを作成します。
   - **Name**: `VITE_SUPABASE_URL`
   - **Secret**: Step 3で取得したSupabaseの Project URL（`https://xxxxxxxx.supabase.co`）
   - 「Add secret」を押して保存します。
6. 再度「New repository secret」を押し、2つ目のシークレットを作成します。
   - **Name**: `VITE_SUPABASE_ANON_KEY`
   - **Secret**: Step 4で取得した anon / publishable key
   - 「Add secret」を押して保存します。
7. **`service_role`という名前の鍵は、ここにもどこにも絶対に登録しないでください。**
   登録してよいのは、常に「anon」「publishable」と表示される鍵だけです。

これで設定は完了です。次に`main`ブランチへpushされたとき（または
「Actions」タブから`Deploy GitHub Pages`ワークフローを手動実行したとき）、
このシークレットを使ってビルドが行われ、GitHub Pages本番のBot画面がSupabaseの
公開済み設定を取得できるようになります。

**重要な注意（設計上の懸念、今回は対応していません）**：このシークレットを登録すると、
GitHub Pages本番URLの`#admin`（`https://nanami96.github.io/concur-maigo-boshi-bot/#admin`）も、
ローカルと同じ実際のSupabaseプロジェクトへ接続する、本物のログイン画面として機能するようになります。
RLSによりログインしていない人・所属していない会社のデータが見えることはありませんが、
検証中の管理画面ログイン欄がインターネット上の誰からでも開ける状態になる点は意識しておいてください。
本番運用として管理画面もGitHub Pages上で正式に使うかどうかは、別途ご判断ください。

### GitHub Pages本番での確認ポイント

- Supabase側の「Authentication」→「URL Configuration」→「Redirect URLs」に、
  Step 7で追加した`https://nanami96.github.io/concur-maigo-boshi-bot/*`が
  登録済みであること（`#admin`でログインする場合のみ関係します。利用者Bot画面の
  設定取得だけであれば、この設定は不要です）。
- Supabaseの匿名データ取得（`get_public_config`）はCORSの追加設定なしに
  どのオリジンからも呼び出せます（Supabase側のREST/RPC APIはデフォルトで
  全オリジン許可のため）。Redirect URLsの設定は認証のリダイレクト専用であり、
  データ取得のCORSとは別物です。

## Step 15. 複数社対応（Phase 6）: list_public_companiesを追加する

Phase 6で、本番Bot画面の会社セレクタと`?company=xxx`が、Reactコードの変更・
再デプロイ無しにSupabase側の会社一覧と連動するようになりました。これを使うには、
既存のSupabaseプロジェクトへ新しいRPC（`list_public_companies`）を1つ追加する
必要があります。

**この章の操作は1回だけ必要です。** 適用後は、会社を追加・公開する作業だけで
本番Botの会社セレクタに反映されるようになり、GitHubへのpush・GitHub Pagesの
再デプロイは不要になります（Step 18の完了報告も参照）。

### 15-1. 既存Supabaseプロジェクトへ追加実行するSQL

「SQL Editor」で「New query」を開き、以下をそのまま貼り付けて実行してください
（`schema.sql`全体を再実行しても問題ありませんが、この差分だけで十分です）。

```sql
create or replace function list_public_companies()
returns table (company_code text, company_name text)
language sql
security definer
set search_path = public
stable
as $$
  select c.company_code, c.company_name
  from companies c
  where c.current_published_version_id is not null
  order by c.company_code;
$$;

comment on function list_public_companies() is
  '匿名の利用者Bot向け、公開中の会社一覧の唯一の読み取り口。company_code・'
  'company_nameの2列だけを返す。current_published_version_idがnull（未公開）の'
  '会社は一覧に含まれない。companies/published_versionsの生テーブルへは'
  'anonからは一切アクセスできない。';

revoke all on function list_public_companies() from public;
grant execute on function list_public_companies() to anon, authenticated;
```

既存のテーブル・RLSポリシー・`get_public_config`・`publish_company_draft`等は
一切変更しません。データの削除・上書きも行いません。

適用前は、本番Botの会社セレクタはSupabase未接続時と同じ静的一覧（sample-companyのみ）
にフォールバックし続けます（Bot本体の質問フロー・回答自体は今まで通り正常に動作します。
この関数が存在しないことはBotの表示を壊しません）。

### 15-2. 新しい会社を追加する運用手順

Step 12と同じ要領で、SQL Editorから会社を登録・admin紐付けします。

```sql
-- 1. 新しい会社を作成する（company-aの例。company_codeは小文字英数字とハイフンのみ推奨）
insert into companies (company_code, company_name)
values ('company-a', 'A株式会社')
returning id;
```

```sql
-- 2. その会社の管理者となるユーザーを紐付ける（<user_id>はStep 12と同様にauth.usersのUIDを使う）
insert into company_members (company_id, user_id, role)
values ('<company_id>', '<user_id>', 'admin');
```

その後、紐付けた管理者が`#admin`にログインし、基本設定・ポリシー・経費タイプ・質問フローを
入力して「保存」し、最後に「公開」を押すと、その時点で`current_published_version_id`が
セットされます。**これだけで**、本番Bot画面の会社セレクタに新しい会社が表示され、
`?company=company-a`でも直接開けるようになります。Reactコードの変更もGitHub Pagesの
再デプロイも不要です。

会社を追加してもまだ「公開」していない間は、`list_public_companies`の一覧にも
`get_public_config`にも一切現れません（匿名ユーザーからは会社の存在自体が分かりません）。

### 15-3. 動作確認

1. `list_public_companies`を追加した直後、本番Bot画面（またはローカルで
   `.env.local`にSupabaseを設定した状態）をF5で再読み込みします。
2. 公開済みの会社が2社以上あれば、ヘッダーに会社セレクタが表示されます
   （1社のみの場合、以前と同じくセレクタは表示されません）。
3. `?company=<公開済みの会社コード>`を付けてアクセスすると、その会社のBotが
   直接開きます。未公開・存在しないコードを指定した場合は
   「この会社の設定はまだ公開されていません。」と安全に表示されます。

---

## Step 16. エンドユーザー認証・1ユーザー1社・招待コード・権限管理（Phase 7）

Phase 7で、一般利用者もSupabase Auth（メール＋パスワード、self-service signUp）で
ログイン必須になりました。ログイン後は、ユーザー自身のuser_id（auth.uid()）だけから
所属会社を自動判定し、他社の会社名・設定・ユーザー一覧は一切見えません。

### 16-1. 全体の仕組み

- **1ユーザー1社**：`company_members.user_id`にUNIQUE制約を追加し、DBレベルで
  「1つのauth.users.idは必ず1社にしか所属できない」ことを保証しています。
- **role（user/admin）**：`company_members.role`は`'user'`（自社Bot利用のみ）と
  `'admin'`（管理画面・下書き保存・公開・ユーザー権限管理が可能）の2種類です。
  `check (role in ('user', 'admin'))`制約で保護されています。
- **会社への参加は招待コードのみ**：一般ユーザーが既存の会社を自由に選んで
  所属できてしまうと他社への不正所属につながるため、会社ごとに発行した
  招待コード（`companies.invite_code_hash`、SHA-256ハッシュで保存。平文は
  DBに残しません）を入力してもらう方式にしています。招待コードで参加した
  ユーザーは常に`role='user'`として登録され、adminにはなりません。

### 16-2. 一般ユーザーの利用フロー

新規ユーザーは「招待コード → アカウント作成 → メール確認 → 自動で会社へ参加 → Bot」
という一本の導線になっています（以前は「アカウント作成→メール確認」の後で
初めて招待コード入力画面が出る順番でしたが、確認メールのリンクをクリックした直後に
一瞬「管理者権限がありません」画面を経由してしまう不具合があったため、
導線ごと見直しました。詳細は16-10節参照）。

1. Bot画面（`?company=`等の付かないトップページ）を開く
2. 未ログインなら、まず「会社へ参加」画面（招待コード入力）が出る
   （「すでにアカウントをお持ちの方はログイン」から、既存ユーザー向けの
   ログイン画面へも切り替えられます）
3. 招待コードを入力し「次へ」を押すと、アカウント作成画面（メールアドレス・
   パスワード）が出る（この時点ではまだ未認証のため、招待コードはブラウザの
   localStorageに一時保持されるだけで、DBへは一切登録されません）
4. 「アカウントを作成」を押すと、Supabaseの設定に応じて次のいずれかになる
   - **メール確認が不要な設定**：その場でログイン済みになり、直後に手順1で
     入力した招待コードを使って自動的に会社へ参加し、そのままBotが表示される
   - **メール確認が必要な設定（デフォルト）**：「確認メールを送信しました」の
     案内が出る。メール内のリンクをクリックすると、ブラウザがトップページ
     （`#admin`ではありません）に戻り、ログインが完了した直後に自動的に
     手順1で入力した招待コードを使って会社へ参加し、Botが表示される
5. 以後は自社の公開済みBotがそのまま表示される（会社を選ぶ操作は一切無い）

**既存ユーザー（既にアカウント作成済み）の場合**は、従来通り「ログイン」から
メール＋パスワードでログインするだけです。ログイン後にまだどの会社にも
所属していなければ、招待コードを手動で入力する「会社への参加」画面が出ます
（この画面自体は新規ユーザー向けの画面と同じコンポーネントを再利用しています）。

### 16-3. 最初の管理者を作る運用手順

新しい会社を導入する際は、以下の順で運営者（Supabaseダッシュボードにアクセスできる人）
が対応します。

1. `companies`へ新しい会社を登録する（Step 12と同様の`insert into companies (...)`）
2. その会社専用の招待コードを発行する（下記16-4参照。平文コードは会社の
   担当者へ別途、安全な手段で伝えてください。DBには残りません）
3. 会社の最初の管理者になる人に、まず16-2の手順で一般ユーザーとして
   signUp・招待コード参加をしてもらう
4. その人の`company_members`行を、SQL Editorから手動で`role='admin'`へ
   UPDATEする（**一般ユーザーが自己申告でadminになれる経路はどこにもありません**。
   最初のadminだけは必ずこの手動UPDATEを経由します）
5. 以後は、その管理者が「ユーザー管理」タブから自社の他のユーザーを
   admin/userへ昇格・降格できます

```sql
-- 4. 最初の管理者を手動で指定する（<会社のcompany_code>・<対象ユーザーのuser_id>を
--    実際の値に置き換えてください。user_idはAuthentication→Usersで確認できます）
update company_members
set role = 'admin'
where user_id = '<対象ユーザーのuser_id>'
  and company_id = (select id from companies where company_code = '<会社のcompany_code>');
```

### 16-4. 招待コードの発行

招待コードはSHA-256ハッシュで保存するため、平文は発行時にその場でしか
確認できません（DBには残りません）。以下をSQL Editorで実行し、表示された
コードを控えてから会社の担当者へ伝えてください。

```sql
do $$
declare
  v_code text := encode(extensions.gen_random_bytes(6), 'hex');
begin
  update companies
  set invite_code_hash = encode(extensions.digest(v_code, 'sha256'), 'hex')
  where company_code = '<会社のcompany_code>';
  raise notice '招待コード: %', v_code;
end $$;
```

実行結果の「Messages」タブ（またはNOTICEの出力）に表示されたコードを
必ずその場で控えてください。再表示はできません（紛失した場合はこのSQLを
再実行すれば新しいコードに置き換わります。古いコードはその時点で無効になります）。

### 16-5. ユーザー管理

管理画面（`#admin`）の「ユーザー管理」タブから、自社に所属するユーザーの
メールアドレス・権限（一般ユーザー/管理者）・登録日を確認し、権限を
変更できます（admin限定。他社のユーザーは一切表示・操作できません）。

**最後の管理者保護**：会社の管理者が1人しかいない状態では、その人を
「一般ユーザーにする」ボタンが無効化されます。DB側（`update_company_member_role`
RPC）でも同じ制約を検証しているため、UIを迂回しても降格できません。

### 16-6. `#admin`のアクセス制御

`role='user'`のユーザーが`#admin`を開いても、「管理者権限がありません」と
表示されるだけで、管理画面本体（会社設定・下書き・公開・ユーザー管理）は
一切描画されません。これはUI側の表示制御に加えて、`companies`/`draft_configs`/
`published_versions`のRLS・`publish_company_draft`が全て`role='admin'`を
条件にしているため、DB側でも二重に保護されています。

### 16-7. get_my_public_config()とRLS

一般利用者Bot画面は`get_my_public_config()`という、引数を一切取らないRPC
だけを呼びます。`auth.uid()`から所属会社を自動解決するため、他社の
`company_code`を指定する経路がコード上存在しません。会社セレクタ・
`?company=`パラメータもこの画面には一切ありません。

### 16-8. pgcrypto（extensions.digest）に関する注意点

`redeem_invite_code()`はSHA-256ハッシュの計算に`pgcrypto`拡張の`digest()`を
使いますが、Supabaseプロジェクトでは`pgcrypto`は通常`extensions`スキーマへ
インストールされます。SECURITY DEFINER関数は`search_path`を`public`だけに
固定しているため（乗っ取り防止）、単に`digest(...)`と書くと解決できず
`42883`（function does not exist）エラーになります。`schema.sql`では
常に`extensions.digest(...)`と明示的にスキーマ修飾しています。今後
`pgcrypto`の別の関数（`gen_random_bytes`・`crypt`等）を新しく使う場合も、
同様に`extensions.`を付けてください。

### 16-9. 本番移行手順

1. `schema.sql`のPhase 7節を実Supabaseへ適用する（既存プロジェクトへは
   各完了報告に記載した差分SQLを使用）
2. 運営者として、最初の会社・最初の管理者を16-3の手順で用意する
3. コードをcommit・push・GitHub Pagesデプロイする
4. **デプロイ後、既存の匿名利用者は全員ログイン（signUp）必須になります。**
   事前の利用者向け告知を推奨します
5. 新しいログインフローが安定稼働することを確認した後、Step 15で追加した
   `list_public_companies`/`get_public_config`のanon EXECUTE権限を、
   以下のSQLで剥奪してください（今回はまだ実行しないでください）。

```sql
revoke execute on function get_public_config(text) from anon;
revoke execute on function list_public_companies() from anon;
```

### 16-10. 認証コールバックの振り分け（`#admin` と一般ユーザーの区別）について

このアプリは`#admin`という独自のハッシュルーティングを持っている一方、Supabase
Authは（Magic Linkログインでも、一般ユーザーのアカウント作成確認メールでも）
認証完了後にURLへ`?code=...`を付けて同じ形で戻ってきます。そのため、
「認証コールバックが来た」というだけでは、それが管理画面のMagic Linkログインなのか、
一般ユーザーの確認メールなのかを区別できません。

この区別のため、管理画面のMagic Linkログイン（`LoginScreen.jsx`）だけが、
戻り先URLに自前の`?authFlow=admin`マーカーを付けています
（`src/admin/authCallback.js`の`resolveRootTree`が、このマーカーの有無で
`#admin`ツリー（`AuthGate`+`AdminRoot`）と一般利用者ツリー（`AppAuthGate`）の
どちらを表示するかを決めます）。一般ユーザーのアカウント作成確認メール
（`SignUpScreen.jsx`）にはこのマーカーを付けないため、確認メールのリンクを
クリックした後は必ず一般利用者側（トップページ、`AuthenticatedBotScreen`）へ
戻り、招待コードによる自動会社参加処理へ進みます。

**Redirect URLsの追加設定は不要です**：Step 7で登録するRedirect URLsは
`http://localhost:5173/*`のようにワイルドカード（`*`）付きのため、
`?authFlow=admin&code=...`や`?code=...`のようなクエリ文字列が付いていても
そのまま許可されます。もしワイルドカードを使わず、クエリ文字列を含まない
完全一致のURLだけを登録している場合は、`?authFlow=admin`付き・無し両方の
バリエーションを許可リストに追加する必要があります。

---

## Step 17. パスワード再設定機能

一般ユーザー・admin・platform_adminの全員が、ログイン画面の
「パスワードを忘れた方」から自分でパスワードを再設定できます
（`src/admin/LoginScreen.jsx`の`forgot`モード）。company_members・role・
platform_adminsには一切触れないSupabase Auth標準機能だけで完結しており、
DBスキーマの変更は不要です。

### 17-1. 全体の仕組み

1. ログイン画面で「パスワードを忘れた方」→ メールアドレスを入力し
   「再設定メールを送信」を押す
2. `supabase.auth.resetPasswordForEmail(email, { redirectTo })`を呼ぶ
   （`redirectTo`には自前のマーカー`?authFlow=recovery`を付与する）
3. Supabaseから再設定メールが届く（存在しないメールアドレスの場合も、
   第三者にアカウントの有無を推測されないよう同じ成功レスポンスが返るのが
   Supabase Auth標準の仕様。アプリ側の表示も常に同一の成功メッセージにしている）
4. メール内リンクをクリックすると、`?authFlow=recovery&code=...`付きで
   アプリへ戻ってくる
5. `main.jsx`の`resolveRootTree`がこのマーカーを検知し、`AppAuthGate`・
   `AuthGate`のどちらとも別の専用ツリー`PasswordRecoveryGate`
   （`src/PasswordRecoveryGate.jsx`）を表示する
6. `PasswordRecoveryGate`が`exchangeCodeForSession`でセッションを確立し、
   新しいパスワードの入力画面（`src/admin/ResetPasswordScreen.jsx`）を表示する
7. `supabase.auth.updateUser({ password })`でパスワードを変更し、成功したら
   その場のセッションを`signOut()`してから、通常のログイン画面へ戻す
   （新しいパスワードで改めてログインしてもらう。中途半端な再設定用セッションを
   残さないため、変更完了後は必ずログアウトする設計にしている）

### 17-2. なぜ独自マーカー（`authFlow=recovery`）で判定しているか

このプロジェクトは`detectSessionInUrl: false`にしており、認証コールバックは
常に`exchangeAuthCallback()`が明示的に`exchangeCodeForSession`/`setSession`を
呼ぶ設計です（16-10節参照）。Supabase Authの`PASSWORD_RECOVERY`イベントは
`detectSessionInUrl`の自動URL検出パスでしか発火しないため、このプロジェクトの
構成では届きません。そのため、管理画面Magic Link（`authFlow=admin`）と
全く同じ仕組みで、パスワード再設定リンクにも`authFlow=recovery`という
自前のマーカーを付け、それだけで判定しています。

### 17-3. Redirect URLsの追加設定は不要です

16-10節と同じ理由（ワイルドカード付きのRedirect URLs）で、追加のDashboard設定は
不要です。ワイルドカードを使わず完全一致のURLだけを登録している場合のみ、
`?authFlow=recovery`付きのバリエーションも許可リストに追加してください。

### 17-4. pending invite（招待コード）との関係

`PasswordRecoveryGate`は`AuthenticatedBotScreen`・招待コードの自動redeem処理
（`NoMembershipGate`）を一切importしていません。パスワード再設定リンクの交換も
「ログイン済み」セッションを作りますが、この専用ツリーがAuthenticatedBotScreenを
経由しない設計になっているため、招待コード入力〜アカウント作成の途中で保存された
pending invite（`localStorage`）が誤って自動redeemされることはありません。

### 17-5. 実地確認手順

1. `#admin`または一般利用者画面のログイン画面で「パスワードを忘れた方」を開く
2. 実際に使っているアカウントのメールアドレスを入力し「再設定メールを送信」
3. 「パスワード再設定メールを送信しました」の案内が出ることを確認
4. 届いたメール内のリンクを**同じブラウザ**でクリックする
   （PKCEのcode_verifierがブラウザのlocalStorageに保存されているため、
   別ブラウザ・別端末で開くと交換に失敗します。詳細は下記17-6参照）
5. 「新しいパスワードを設定」画面が表示され、`#admin`や通常のBot画面・
   招待コード入力画面へ誤って遷移しないことを確認する
6. 新しいパスワードを入力し「パスワードを変更」を押す
7. 「パスワードを変更しました。」の案内後、ログイン画面へ戻ることを確認する
8. 新しいパスワードでログインできることを確認する
9. （admin/platform_adminの場合）ログイン後、`#admin`へ問題なくアクセスできる
   ことを確認する

### 17-6. 別ブラウザ・別端末でリンクを開いた場合

パスワード再設定リンクの交換も、既存の確認メール同様PKCEを使っているため、
リンクを送信したときと**同じブラウザ**で開く必要があります。別ブラウザ・
別端末で開いた場合は「パスワード再設定リンクの有効期限が切れているか、
無効です」というエラーになり、「ログイン画面へ戻る」から改めて
パスワード再設定をやり直すことになります（詰みにはなりません）。

### 17-7. 将来Custom SMTP / Resendへ切り替える場合

今回の実装は`supabase.auth.resetPasswordForEmail()`というSupabase Auth標準の
APIだけを使っており、メール送信経路（Supabase標準メール／Custom SMTP／Resend等）
には一切依存していません。将来Supabase DashboardのAuthentication設定で
Custom SMTP（Resend等）へ切り替えても、**アプリ側のコード変更は不要**です
（送信元・送信上限が変わるだけで、`resetPasswordForEmail`の呼び出し方・
`redirectTo`の仕組み・`PasswordRecoveryGate`の処理は一切変わりません）。

---

## Step 18. Concur OAuth（Access Token取得）用のSupabase Secrets

`supabase/functions/_shared/concur-oauth/`に、Concur側のOAuth2「Refresh
Token Grant」でAccess Tokenを更新するための共有モジュール（`refreshConcurAccessToken.js`
ほか）を用意しています。**このモジュールは既存の`create-concur-quick-expense`
（Quick Expense作成処理）とは未接続です。** 呼び出すのは後述の
`check-concur-oauth`（platform_admin専用の疎通確認Function）だけで、こちらも
通常は無効化されており、Concur APIへの実通信は行いません。以下は、将来実際に
デプロイする際に登録することになるSecret名の一覧です（実際の値はこのドキュメントは
もちろん、コード・`.env.example`・ログのいずれにも書きません）。

| Secret名 | 用途 | 必須/任意 |
|---|---|---|
| `CONCUR_CLIENT_ID` | Concur App Managementで発行されたClient ID | 必須 |
| `CONCUR_CLIENT_SECRET` | 同上のClient Secret | 必須 |
| `CONCUR_TOKEN_URL` | Concur側のtoken endpoint（例: `https://{リージョン}.api.concursolutions.com/oauth2/v0/token`。会社ごとに異なるため既定値へのフォールバックは行わず、未設定時は安全側で失敗させる設計。`https`以外のスキームも同様に拒否する） | 必須 |
| `CONCUR_SCOPE` | Refresh Token Grantに含めるscope | 任意 |
| `CONCUR_OAUTH_CHECK_ENABLED` | `check-concur-oauth`（次項）がtoken endpointへ実際に通信することを許可する安全ゲート。厳密に文字列`"true"`の場合だけ有効になる（未設定・`"false"`・大文字違い等は全て無効） | 任意（未設定＝無効が既定） |

**`CONCUR_REFRESH_TOKEN`はSupabase Secretsには置きません。** Refresh Tokenだけは
ローテーション（Concur側から新しい値が返るケース）が起こり得るため、Supabase
Vault（暗号化されたDB内シークレットストア）で保存・更新する設計とします。詳細は
次項「Step 19」を参照してください（**現時点では設計のみで、Vaultへの実登録・
migrationの本番適用は行っていません**）。

登録方法は他のSecret（`AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`等）と同様、Supabase
ダッシュボードの「Edge Functions」→「Secrets」、またはSupabase CLIの
`supabase secrets set`で行います（値は絶対にリポジトリへコミットしないこと）。

### `check-concur-oauth`（OAuth疎通確認用Edge Function）について

- **platform_admin専用**：`is_platform_admin()`（既存のSECURITY DEFINER関数）
  でサーバー側から確認する。一般利用者・会社のadmin（company_admin）は呼び出せない
- 既存のConcur登録処理（「Concurに登録」ボタン・`create-concur-quick-expense`）とは
  未接続
- 通常は`CONCUR_OAUTH_CHECK_ENABLED`が無効なため、呼び出してもtoken endpointへは
  一切通信せず、`{ connected: false, status: "disabled" }`を返すだけ
- 有効化した場合でも、レスポンスにトークン本体（access_token/refresh_token等）・
  Client Secret・token endpoint URL・geolocationの実URL・scopeの生値は一切含めない
  （`connected`・`hasGeolocation`・`expiresInPresent`・`refreshTokenRotated`という
  真偽値だけを返す）
- Concur側から新しいRefresh Token（ローテーション）が返された場合の安全な保存方式
  （Supabase Secretsの自動更新・DB保存等）がまだ実装されていないため、この状態が
  発生した場合は成功として扱わず、認証情報の更新が必要という固定エラーを返す。
  これが整備されるまで、`CONCUR_OAUTH_CHECK_ENABLED`は有効化しない運用を推奨する
このEdge FunctionはVite/GitHub Pagesの静的フロントから直接呼ばれるものではなく、
Concur側の認証情報はSupabase Secretsにのみ保存し、フロントエンド
（`VITE_`で始まる環境変数）には一切置きません。

## Step 19. Concur Refresh TokenのSupabase Vault移行案（未適用・設計のみ）

**このStepの内容は設計案です。本番DBへは一切適用していません。** Vault
extensionの有効化・実際のRefresh Token登録・migrationの実行は、レビュー後、
別セッションで改めて行ってください。

### なぜVaultへ移すか

Refresh Tokenは、Concur側の仕様上いつでも新しい値へローテーション（差し替え）
される可能性がある。Supabase Secrets（環境変数）は実行中のEdge Functionから
更新できないため、ローテーションが起きるたびに手動で`supabase secrets set`し
直す必要があり、更新を忘れると次回以降の疎通確認が失敗し続ける。Supabase
Vault（`vault.create_secret()`/`vault.update_secret()`で読み書きする、暗号化
された特別なテーブル）はSQL関数から値を更新できるため、Edge Function側で
「新しいRefresh Tokenが返ってきたら、その場でVaultへ書き戻す」という自動
ローテーションが実現できる。

### 参照した公式情報

- Vault拡張はSupabaseホスティング環境では既定で有効（[Vault | Supabase Docs](https://supabase.com/docs/guides/database/vault)、[supabase/vault README](https://github.com/supabase/vault/blob/main/README.md)）。セルフホスト等では`create extension supabase_vault cascade;`で有効化する
- `vault.create_secret(secret, name?, description?)`は新しいシークレットのUUIDを返す
- `vault.update_secret(id, secret?, name?, description?)`で既存シークレットの値を更新する
- 復号は`vault.decrypted_secrets`ビュー（`decrypted_secret`列）経由。暗号化キー自体はSQLから参照できない
- 公式ドキュメントの警告：「`vault.decrypted_secrets`ビューへのアクセスは、適切なSQL権限設定で常に保護すること。このビューへアクセスできる者は誰でも復号済みのシークレットにアクセスできる」

### 保存方式（A/B/C比較）

| 観点 | A: Edge FunctionがVaultへ直接アクセス | B: SECURITY DEFINER RPC経由（採用） | C: 独自暗号化テーブル |
|---|---|---|---|
| 最小権限 | `vault`スキーマをPostgRESTへ露出する必要があり、範囲が広がる | `public`の関数呼び出し（既存の`is_platform_admin()`等と同じ経路）だけで完結、スキーマ露出不要 | 暗号鍵という新たな機密情報を別途管理する必要がある |
| Token漏洩リスク | アプリ側コードが生のVault行（`nonce`・`key_id`等余分な列を含む）を扱うため誤ログの余地が広い | RPCの戻り値を「今回必要な最小限」に絞れる | 暗号鍵の実装・管理ミスがそのままリスクになる |
| SQL権限管理 | `vault.*`オブジェクトへの直接grant管理が必要 | 自作関数2つへのgrant管理のみ、範囲が明確 | 自作関数＋暗号鍵Secretの両方を管理 |
| Edge Functionの実装量 | 少ないが`db.schemas`設定変更が前提 | RPC呼び出し2回、実装は小さい | RPC呼び出し＋鍵管理コードが必要 |
| 複数会社対応 | 変わらない | メタデータテーブル側の設計で対応（下記） | 同左 |
| ローテーション更新の原子性 | 複数の独立した呼び出しに分割されがちで、途中失敗時の一貫性確保が難しい | 1回のRPC呼び出し＝1トランザクションで完結、自然にatomic | 同左（Bと同様に組めば同等） |
| 監査可能性 | Vaultへのアクセス経路がアプリコードに散らばり、DB側だけでは把握しづらい | 全アクセスが2つの関数に集約され、DB側のレビューだけで把握できる | 同左（ただし独自ロジックの分だけ監査対象が増える） |
| 将来の保守性 | 保存方式を変える際にEdge Function側の変更が必要 | 関数のシグネチャさえ保てば内部実装だけ差し替え可能 | 暗号方式自体を自前で保守し続ける必要がある |

**結論：Bを採用する。** `vault`スキーマをPostgREST経由で露出させる必要がなく
（`db.schemas`設定変更という、この機能以外にも影響しうる広い変更を避けられる）、
1回のRPC呼び出しが1トランザクションとして自然に完結するため原子性の面でも有利、
かつVault自体の暗号鍵管理をSupabase側に委ねられるためCのように独自の暗号方式を
保守する必要もない。

### DB構造案（メタデータテーブル。Token本体は保存しない）

**改訂：リースID（`lease_id`）を追加。** 旧案は`status`と
`lock_expires_at`だけでリースを管理しており、「古い処理のリースが期限切れに
なった後、別処理が新しいリースを取得し、その後に古い処理が遅れて
`complete_concur_oauth_refresh()`を実行すると、新しい処理の結果を上書きして
しまう」という問題があった。`lease_id`（リース取得のたびに新しく発行する
ランダムUUID）を導入し、`complete_concur_oauth_refresh()`が
「`connection_id`と`lease_id`が両方とも現在の値と一致する場合だけ」実行される
ようにすることで解消する。

```sql
-- 【未適用・案】以下はレビュー用の下書きです。本番へは適用していません。
-- vault.create_secret()による実際のRefresh Token登録は、この migration には
-- 含めません（migration適用後、別途手作業で行う想定）。

-- 1. Vault拡張の有効化確認
--    Supabaseホスティング環境では既定で有効。セルフホスト等で未有効の場合のみ:
-- create extension if not exists supabase_vault cascade;

-- 2. メタデータテーブル（Token本体・平文は一切持たない）
create table if not exists concur_oauth_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade,
  vault_secret_id uuid not null,
  status text not null default 'inactive'
    check (status in ('inactive', 'active', 'rotating', 'error')),
  lease_id uuid,
  lock_expires_at timestamptz,
  last_refreshed_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table concur_oauth_connections is
  'Concur OAuth接続ごとのメタデータ。Refresh Token本体は持たない。実体は'
  'vault.secretsにあり、vault_secret_idで参照する。';
comment on column concur_oauth_connections.company_id is
  '将来の複数会社対応用。現時点では単一の既定接続のためnullを許容する'
  '（下の部分unique indexで、company_idがnullの行は最大1件に制限）。'
  'companies.idと同じuuid型（supabase/schema.sqlのcompanies定義を確認済み）。';
comment on column concur_oauth_connections.vault_secret_id is
  'vault.secrets.idへの参照。Vaultは拡張が管理するスキーマのため外部キー'
  '制約は付けず、整合性はRPC側（get/complete関数）で保証する。呼び出し元'
  '（Edge Function）から直接渡させることはせず、常にこの列に保存された値'
  'だけを使う（RPC引数にvault_secret_idを含めない設計。誤った/偽装された'
  'secret IDでvault.update_secret()が呼ばれることを構造的に防ぐ）。';
comment on column concur_oauth_connections.status is
  'inactive=未接続、active=正常、rotating=ローテーション処理中の一時的な'
  'リース状態、error=直近の疎通確認が失敗。';
comment on column concur_oauth_connections.lease_id is
  'get_concur_refresh_token_for_edge()がリースを獲得するたびに新しく発行する'
  'ランダムUUID。complete_concur_oauth_refresh()は、この列の現在値と呼び'
  '出し元が提示したp_lease_idが完全一致する場合だけ処理を実行する。リースが'
  '期限切れ後に別の呼び出しへ引き継がれると、この列は新しいUUIDへ上書き'
  'されるため、古いlease_idを持ったままの遅延completeは自動的に「対象なし」'
  'として無害化される（新しい処理の結果を上書きしない）。';
comment on column concur_oauth_connections.lock_expires_at is
  'rotating状態のリース期限。Edge Function側の異常終了時にリースが永久に'
  '残らないよう、期限切れ後は他のリクエストが新しいlease_idでリースを'
  '奪えるようにする。';

-- 会社ごとに1件、かつ「既定接続」(company_id is null)も最大1件に制限する。
-- 通常のunique(company_id)制約だけでは、PostgreSQLはNULL同士を「異なる値」
-- として扱うため、company_id is null の行を何件登録しても制約違反になら
-- ない。そのため、company_id is not null の行専用と、company_id is null の
-- 行専用（定数式(true)へのunique index、という一般的なテクニック）の
-- 2本の部分unique indexへ分けて、それぞれ独立に「最大1件」を強制する。
create unique index if not exists concur_oauth_connections_company_id_key
  on concur_oauth_connections (company_id)
  where company_id is not null;
create unique index if not exists concur_oauth_connections_default_key
  on concur_oauth_connections ((true))
  where company_id is null;

alter table concur_oauth_connections enable row level security;
revoke all on concur_oauth_connections from anon, authenticated, public;
-- 意図的にRLSポリシーを1件も作らない：anon/authenticated（platform_admin
-- 本人の通常ログインセッションを含む）はこのテーブルへ一切アクセスできない。
-- アクセスは service_role 権限のEdge Functionが、下記のSECURITY DEFINER
-- RPC経由でのみ行う。

revoke all on vault.decrypted_secrets from anon, authenticated, public;
-- Vault拡張の既定権限がどうであっても、明示的に再確認する（公式ドキュメントの
-- 「decrypted_secretsビューへのアクセスは適切なSQL権限で常に保護すること」
-- という警告への対応）。vault.decrypted_secretsそのものをPostgREST等から
-- 直接公開することは行わない（db.schemasへvaultを追加しない）。

-- 3. RPC: 現在のRefresh Tokenを取得し、同時にローテーション用のリースを
--    新しいlease_idで獲得する（Edge Function専用。service_roleだけがEXECUTE
--    可能）。単一のUPDATE ... RETURNINGで「WHERE条件の確認」と「リースの
--    獲得」を1つの原子的な操作として行うため、2つの呼び出しが同時に実行
--    されても、Postgresの行ロックにより片方だけがこのUPDATEに成功し、
--    もう片方は0行を受け取る（Tokenを同時に2件が取得することはない）。
create or replace function get_concur_refresh_token_for_edge(
  p_company_id uuid default null
)
returns table (connection_id uuid, lease_id uuid, refresh_token text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_connection_id uuid;
  v_vault_secret_id uuid;
  v_lease_id uuid := gen_random_uuid();
begin
  update concur_oauth_connections c
    set status = 'rotating',
        lease_id = v_lease_id,
        lock_expires_at = now() + interval '30 seconds',
        updated_at = now()
    where (p_company_id is null and c.company_id is null or c.company_id = p_company_id)
      and (c.status <> 'rotating' or c.lock_expires_at < now())
    returning c.id, c.vault_secret_id into v_connection_id, v_vault_secret_id;

  if v_connection_id is null then
    -- 対象接続が存在しない、または他のリクエストがロック中（かつリース期限
    -- 切れでない）。理由は区別せず0行を返す（呼び出し元はconcur_oauth_locked
    -- 等、単一の安全なコードへまとめる）。期限切れ後の再取得では、WHERE句の
    -- 「lock_expires_at < now()」が真になるため通常どおりUPDATEが成功し、
    -- v_lease_id（今回新しく生成した値）へ差し替わる＝再取得のたびに
    -- lease_idが変わる。
    return;
  end if;

  return query
    select v_connection_id, v_lease_id, vs.decrypted_secret
    from vault.decrypted_secrets vs
    where vs.id = v_vault_secret_id;
end;
$$;

revoke all on function get_concur_refresh_token_for_edge(uuid) from public, anon, authenticated;
grant execute on function get_concur_refresh_token_for_edge(uuid) to service_role;

comment on function get_concur_refresh_token_for_edge(uuid) is
  'Edge Function専用（service_roleのみEXECUTE可）。指定した会社（またはNULLで'
  '既定接続）の現在のRefresh Tokenを復号して返すと同時に、新しいlease_idで'
  'ローテーション用のリース（status=rotating、30秒）を獲得する。ロック中・'
  '接続なしの場合は0行を返す。呼び出し元はconnection_id・lease_idを保持し、'
  '成功・失敗いずれの場合も必ずcomplete_concur_oauth_refresh()へその両方を'
  '渡してリースを解放すること。';

-- 4. RPC: ローテーション結果を確定し、リースを解放する。
--    p_connection_id・p_lease_idの両方が現在のリースと完全一致する場合だけ
--    実行する。古いlease_id・別connection_idのlease_id流用・既に解放済み
--    （二重実行）のいずれも「対象0件」として安全に失敗し、falseを返すだけで、
--    現在のToken・status・（他のリクエストが獲得した）新しいリースへは
--    一切触れない。
create or replace function complete_concur_oauth_refresh(
  p_connection_id uuid,
  p_lease_id uuid,
  p_success boolean,
  p_new_refresh_token text default null,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vault_secret_id uuid;
begin
  -- vault_secret_idは呼び出し元から受け取らず、常にこの行に保存されている
  -- 値だけを使う（呼び出し元が任意のvault_secret_idを指定してvault.update_
  -- secret()を呼べてしまう経路を作らないため）。
  select vault_secret_id into v_vault_secret_id
    from concur_oauth_connections
    where id = p_connection_id
      and lease_id = p_lease_id
      and status = 'rotating'
      and lock_expires_at is not null
    for update;

  if v_vault_secret_id is null then
    -- 古いlease_id・別connection_idへのlease_id流用・二重実行のいずれも
    -- ここで0行になる（現在のlease_idと一致しないため）。例外は投げず、
    -- falseを返すだけにする（呼び出し元のログにToken関連の値を含む例外
    -- メッセージが残らないようにするため）。
    return false;
  end if;

  if p_success then
    if p_new_refresh_token is not null then
      -- Vaultの更新と、直後のメタデータ更新は同じ関数呼び出し＝同じ
      -- トランザクション内で行われるため、途中で例外が発生すれば
      -- vault.update_secret()の効果も含めてロールバックされる（原子性）。
      perform vault.update_secret(v_vault_secret_id, p_new_refresh_token);
    end if;

    update concur_oauth_connections
      set status = 'active',
          lease_id = null,
          lock_expires_at = null,
          last_refreshed_at = now(),
          last_error_code = null,
          updated_at = now()
      where id = p_connection_id
        and lease_id = p_lease_id;
  else
    update concur_oauth_connections
      set status = 'error',
          lease_id = null,
          lock_expires_at = null,
          last_error_code = p_error_code,
          updated_at = now()
      where id = p_connection_id
        and lease_id = p_lease_id;
  end if;

  return true;
end;
$$;

revoke all on function complete_concur_oauth_refresh(uuid, uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function complete_concur_oauth_refresh(uuid, uuid, boolean, text, text) to service_role;

comment on function complete_concur_oauth_refresh(uuid, uuid, boolean, text, text) is
  'Edge Function専用（service_roleのみEXECUTE可）。get_concur_refresh_token_for_edge()'
  'が発行したlease_idと完全一致する場合だけ、リースを解放する。p_success='
  'trueかつp_new_refresh_tokenが指定されている場合のみvault.update_secret()'
  'で実際にRefresh Tokenを更新する（rotated:falseの場合はp_new_refresh_token'
  'をnullのまま呼び、リースの解放とlast_refreshed_at更新だけを行う）。'
  'p_success=falseの場合はToken値を一切受け取らず、last_error_codeだけを'
  '記録する。lease_id不一致（古いlease_id・他のconnection_idへの流用・'
  '二重実行）はfalseを返すだけで、例外・状態変更のいずれも起こさない。';
```

**注記（Vault関数自体が投げる例外について）**：`vault.update_secret()`が
Postgres/Vault拡張の内部事情（対象行が存在しない等）で例外を投げた場合、
その例外メッセージの内容は本設計の関数側では完全には制御できない
（Vault拡張自身が生成するメッセージのため）。そのため、Edge Function側は
この関数呼び出し全体を必ずtry/catchし、**捕捉した例外のメッセージをそのまま
ログ・レスポンスへ転記せず、固定の内部エラーコードへ変換すること**を設計
上の必須要件とする（既存の`refreshConcurAccessToken.js`・
`handleConcurOAuthCheckRequest.js`が例外メッセージを常に握りつぶしている
のと同じ方針）。

### rollback案

```sql
-- 【未適用・案】ロールバック用SQL
drop function if exists complete_concur_oauth_refresh(uuid, uuid, boolean, text, text);
drop function if exists get_concur_refresh_token_for_edge(uuid);
drop table if exists concur_oauth_connections;
-- vault.secrets内の実際のシークレット行は、この migration では削除しない
-- （ロールバックは「メタデータ層の後始末」に留め、実データの削除有無は
-- 別途手動判断とする）。
```

### 想定するローテーションの安全な流れ（実装は今回行っていない）

1. Edge Function（service_role専用クライアント。下記「クライアント分離」
   参照）が`get_concur_refresh_token_for_edge(company_id)`を呼び、現在の
   Refresh Tokenと、今回発行された`connection_id`・`lease_id`を取得する
2. 取得できなければ（0行）、安全な固定コード（例：`concur_oauth_locked`）を
   返して終了。token endpointへは通信しない
3. 取得できた場合のみ、token endpointへRefresh Token Grantを実行する
   （Access Token・新Refresh Tokenの有無はメモリ上でのみ扱う）
4. token endpoint呼び出しが失敗した場合：
   `complete_concur_oauth_refresh(connection_id, lease_id, success=false, error_code=...)`
   を呼んでリースを解放し、元のエラーコードを返す
5. 成功した場合：
   `complete_concur_oauth_refresh(connection_id, lease_id, success=true, new_refresh_token=...)`
   を呼ぶ（rotated:falseなら`new_refresh_token`はnullのまま呼び、リースの
   解放と`last_refreshed_at`更新だけを行う）
6. **DB更新（Vaultへの書き込み）が成功して初めて`connected:true`を返す。**
   DB更新自体が失敗した場合は、新しいRefresh Tokenの値をどこにも保存せずに
   破棄し、専用の安全なエラー（例：`concur_oauth_storage_failed`）を返す
7. `complete_concur_oauth_refresh()`が`false`を返した場合（lease_id不一致。
   通常は起こらないはずだが、想定外に遅延した呼び出し等）は、リースは
   既に他の処理によって解放・引き継ぎ済みのため、二重に状態を変更しようと
   せず、安全な内部エラー（例：`concur_oauth_lease_lost`）として扱う

### Edge Function側のクライアント分離（設計方針）

`check-concur-oauth`の実装時は、Supabaseクライアントを**用途ごとに2つ**明確に
分ける。

1. **呼び出し元JWTクライアント**：既存どおり、リクエストの`Authorization`
   ヘッダーをそのまま使う。用途は`auth.getUser()`・`is_platform_admin()`の
   確認だけに限定し、Vault関連の2 RPCは絶対にこのクライアントから呼ばない
   （呼んでもSQL権限的に失敗するが、コード構造上そもそも呼び出し経路を
   作らない）。
2. **サービス専用クライアント**：`SUPABASE_SERVICE_ROLE_KEY`（Edge Function
   へ自動注入済みの環境変数。新たなSecret登録は不要）で作成する、
   platform_admin確認が済んだ後にだけ使う専用クライアント。
   `get_concur_refresh_token_for_edge()`・`complete_concur_oauth_refresh()`
   の呼び出しはこのクライアントからだけ行う。

この分離により、「platform_adminの通常セッション（JWTクライアント）から
Vault関連RPCへ到達する経路」がコード上そもそも存在しなくなる（SQL側の
`revoke`と、コード構造の両方で二重に防いでいる）。

### 同時実行・障害時の考え方

- **二重ローテーション対策（今回の修正の中心）**：`lease_id`により、
  「古い処理が完了した時点で、そのリースがまだ現在有効かどうか」を
  `connection_id`・`lease_id`の完全一致で判定する。リースが期限切れ後に
  別処理へ引き継がれた時点で`lease_id`列は新しい値へ上書きされるため、
  古いlease_idを持ったままの遅延完了処理は自動的に「対象なし」となり、
  新しい処理の結果（新しいToken・新しいリース）を上書きすることはない
- **Edge Functionのクラッシュ等でリースが解放されないまま終わった場合**：
  `lock_expires_at`の期限切れ後は次のリクエストが新しいlease_idでリースを
  奪える（永久ロックを回避する自己修復）
- **token endpoint成功後・DB更新失敗（残存リスク）**：現Refresh Tokenの
  取得・外部token endpointへの通信・新Refresh Tokenの保存という3つの
  処理は、外部HTTP通信を挟むため単一のPostgresトランザクションには
  できない。lease_idは「同時に複数の処理が競合して互いの結果を上書きする」
  ことを防ぐものであり、「Concur側で新しいRefresh Tokenが発行済みなのに、
  Edge FunctionがVaultへ保存する前にクラッシュ・タイムアウトした」という
  外部通信と保存の間の障害までは解消しない。この場合、新しいRefresh Token
  はメモリ上にしか存在しないため、DB更新に到達できなければそのまま失われる。
  Concur側の実装次第では旧Refresh Tokenが既に失効している可能性があり、
  その場合は次回以降の疎通確認も自動復旧できず失敗し続け、Company Request
  Tokenからの手動再認証が必要になる可能性がある。**lease_idの導入は同時実行
  による上書きだけを防ぐものであり、この外部通信⇔DB保存間の障害リスクを
  完全に解消するものではないことを明記する**
- **再試行によるToken失効リスク**：DB更新失敗時に安易に同じ新Refresh Token
  で再試行することはできない（メモリ上の値は1回のリクエスト内でしか保持
  しない設計のため）。再試行は「もう一度Refresh Token Grant自体をやり直す」
  ことになり、Concur側が旧Refresh Tokenを既に失効させていた場合は失敗する

### 複数会社対応の方針

- `concur_oauth_connections.company_id`は`companies(id)`（`uuid`型、
  `supabase/schema.sql`の定義を確認済み）への外部キー。現時点では1件だけの
  検証用接続のため、`company_id is null`の行（＝既定接続）を1件だけ許容する
  部分unique indexにしている
- 会社ごとに異なるConcur環境を持つようになった場合は、`company_id`を指定した
  行を追加するだけで対応でき、`get_concur_refresh_token_for_edge(p_company_id)`
  のインターフェースは変更不要
- Vault側の`name`（人間可読な識別用ラベル）は会社ごとに変えてよいが、実際の
  参照は常に`vault_secret_id`（UUID）で行うため、命名規則に依存しない
- **Client ID/Secret/Token URLは今回のスコープ外**：現時点ではSupabase
  Secretsのまま単一の値とする。将来これらも会社ごとに変える必要が出た場合は、
  同じ「メタデータテーブル＋Vault」パターンを拡張する想定
- Refresh Tokenを`company_settings`や`config_snapshot`（既存のJSONB列）へ
  保存することは、今回もこの設計でも一切行わない

### テスト設計（追加分。今回はコード未実装のため設計のみ）

- 同時に2件のリクエストが`get_concur_refresh_token_for_edge()`を呼んだ場合、
  片方だけが行を取得し、もう片方は0行を受け取る
- リース期限内の再取得は0行（拒否）
- リース期限切れ後の再取得は成功する
- 期限切れ後の再取得で、返される`lease_id`が前回と異なる値になる
- 正しい`connection_id`・`lease_id`での`complete_concur_oauth_refresh()`は
  成功し、状態・Vaultが更新される
- 古い`lease_id`（既に上書き済み）での完了呼び出しは失敗（false・0件更新）
  し、現在の状態を一切変更しない
- 別の`connection_id`から取得した`lease_id`を、異なる`connection_id`へ
  誤って渡した場合も失敗する（`connection_id`と`lease_id`の組み合わせ一致を
  要求するため）
- 同一の`connection_id`・`lease_id`で`complete_concur_oauth_refresh()`を
  2回呼んだ場合、2回目は失敗する（1回目でリースが解放済みのため）
- `vault.update_secret()`が失敗した場合（例外）、成功として扱わない
  （メタデータの`status`が`active`へ更新されない）
- `p_new_refresh_token`が`null`（rotated:false）でも正常にリースが解放される
- `p_success=false`での完了呼び出しでもリースが解放され、`last_error_code`
  が記録される
- Refresh Token・新Refresh TokenのいずれもSQL例外メッセージ・ログ・
  レスポンスへ含まれない
- 一般ユーザー・platform_adminの通常セッション（JWTクライアント）から
  両RPCを直接呼び出せない（`revoke`により権限エラーになる）
- service_role専用クライアント経由でのみ成功する
- rollback用SQL（テーブル・関数の`drop`）が実行可能である

### schema.sqlへの反映案（未適用）

実際に適用する際は、`supabase/schema.sql`のPhase 8（platform_admins）の後に新しい
節（例：「Phase 9: Concur OAuth Vault連携」）として、上記のテーブル・index・RPC・
grant/revoke・commentをそのまま追記する案とする。この移行が完了し安定稼働した後、
`check-concur-oauth`側のコード（`handleConcurOAuthCheckRequest.js`等）を、
Refresh TokenをSecrets（`CONCUR_REFRESH_TOKEN`）ではなく上記2つのRPCから取得・
更新するように変更する（このコード変更は今回行っていない）。

## 生成AI（ChatGPT等）へ顧客情報を入力する場合の注意

このアプリは、Concurの経費タイプ一覧や経費規程等の顧客情報をChatGPT等の生成AIへ入力し、
初期設定Excelの作成を補助してもらう使い方を想定していますが、**これはアプリの技術的な機能とは
別に、組織としての判断が必要な事項です**。

顧客情報を生成AIへ入力する場合は、必ず以下を確認してください。

- 所属組織の情報セキュリティルール
- 顧客との契約上の秘密保持・データ取扱に関する条項
- 利用する生成AIサービスのデータ取扱条件（入力内容が学習に利用されないか等）

特定の生成AIサービスやプランであれば必ず安全である、という断定はできません。都度、
上記を確認した上で判断してください。

なお、本アプリは生成AIを使わなくても運用できるように設計されています。

- Excelから初期設定をインポートする
- 管理画面から一から設定を作成する

のどちらの方法でも、全ての設定を作成できます。本アプリのコード（Supabase連携部分を含む）は、
顧客資料をOpenAI API等の外部の生成AIサービスへ自動送信する処理を一切含んでいません。
