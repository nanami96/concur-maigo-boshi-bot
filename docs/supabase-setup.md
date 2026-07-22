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
