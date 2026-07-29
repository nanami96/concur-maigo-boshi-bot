-- Concur迷子防止Bot 管理画面 永続化基盤 スキーマ（Phase 1〜Phase 6）
--
-- Supabaseダッシュボードの「SQL Editor」に、このファイルの内容をそのまま貼り付けて
-- 実行してください（手順の詳細は docs/supabase-setup.md を参照）。
--
-- 既にPhase 1時点のschema.sqlを実行済みのプロジェクトに対しては、このファイルを
-- 丸ごと再実行しても問題ありません（create table if not exists・drop policy if
-- exists等でべき等に書かれています）。ただしPhase 3・Phase 4・Phase 6で追加した
-- 部分だけを適用したい場合は、各Phaseの完了報告に記載した「既存Supabaseへ追加実行
-- するSQL」を使ってください。
--
-- 設計方針：
--   ・全テーブルでRLS（Row Level Security）を有効化する
--   ・「デフォルト拒否＋必要な操作だけ許可」を徹底する
--   ・anon（未ログインの匿名ユーザー）には、いかなるテーブルへのアクセスも許可しない。
--     本番Bot向けの公開読み取りは、companies/published_versionsの生テーブルへは
--     一切触れさせず、専用のRPCだけを入り口とする：
--       ・get_public_config（Phase 4節）: 指定した1社の公開中の設定内容を取得
--       ・list_public_companies（Phase 6節）: 公開中の会社の一覧（コードと名前のみ）を取得
--     いずれもcompanies/published_versionsの生テーブルへの直接アクセスは一切許可しない。
--   ・SECURITY DEFINER関数は、本当に必要な場合（anonに本来アクセス権の無い
--     テーブルから、ごく限定的な列だけを安全に見せる場合）にのみ、search_path
--     固定・返す列の限定・EXECUTE権限の限定を徹底した上で使う
--     （Phase 4のget_public_config、Phase 6のlist_public_companiesのみ。
--     それ以外の関数はSECURITY INVOKERのまま）

-- gen_random_uuid()・digest()（redeem_invite_code内）等を使うための拡張機能。
-- Supabaseプロジェクトでは通常extensionsスキーマへインストールされる（Supabase側の
-- 標準運用）ため、ここでも明示的にwith schema extensionsを指定し、新規プロジェクトに
-- schema.sqlをそのまま流した場合でも実運用のSupabaseと同じ場所（extensionsスキーマ）に
-- 入ることを保証する（既に有効な場合は何も起きない）。
-- 重要：SECURITY DEFINER関数はいずれもsearch_pathをpublicだけに固定しているため
-- （乗っ取り防止。本ファイルの設計方針参照）、pgcrypto関数を関数本体から呼ぶ場合は
-- extensions.digest(...)のようにスキーマを明示する必要がある
-- （publicだけのsearch_pathではextensionsスキーマ内の関数は解決されない）。
create extension if not exists pgcrypto with schema extensions;

-- ============================================================================
-- 1. テーブル定義
-- ============================================================================

-- 会社の identity と「今どの公開版を向いているか」だけを持つ軽量テーブル。
-- current_published_version_id は published_versions テーブルを参照するが、
-- published_versions.company_id が companies.id を参照するため、
-- 2つのテーブルは互いを参照し合う関係になる（循環参照）。
-- PostgreSQLは1つのCREATE TABLE文の中で存在しないテーブルへの外部キーを
-- 張れないため、companies を先に「外部キー制約なし」で作成し、
-- published_versions を作った後に ALTER TABLE で制約を追加する（本ファイル末尾）。
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  company_code text unique not null,
  company_name text not null,
  current_published_version_id uuid,
  created_at timestamptz not null default now()
);

comment on column companies.company_code is
  '既存アプリ内で使っている company_id スラッグ（例: sample-company）。安定キーとして扱う。';
comment on column companies.current_published_version_id is
  '現在本番Botに公開されている published_versions.id。まだ一度も公開していない会社はnull。';

-- 会社ごとの所属ユーザー。誰がどの会社に属し、管理者かどうかを表す唯一のテーブル。
-- Phase 7以降、一般利用者もここに（role='user'として）登録されるようになったため、
-- 「1つのauth.users.idは必ず1社にしか所属できない」という制約を追加している
-- （本ファイル末尾のPhase 7節、company_members_user_id_key参照）。
-- 1社に複数の管理者を置くこと自体は引き続き可能（company_idは複数行で重複してよい）。
create table if not exists company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'admin',
  created_at timestamptz not null default now(),
  unique (company_id, user_id),
  check (role in ('user', 'admin'))
);

comment on column company_members.role is
  'admin: 管理画面・下書き保存・公開・ユーザー権限管理が可能。user: 自社の公開Bot利用のみ。';

-- --- Phase 8: platform_admins（サービス運営者） ------------------------------
--
-- 「全会社を横断して管理できるサービス運営者」を、company_members.roleの
-- 3つ目の値として追加するのではなく、完全に別軸の専用テーブルとして管理する。
-- 理由：
--   ・company_members.user_idにはPhase 7でunique制約を付けており「1ユーザー1社」
--     を保証している。platform_adminがある会社のadminを兼務しつつ、全社を横断
--     管理できる状態を許容したいため、「会社への所属」と「運営者権限」を
--     同じテーブル・同じ行で表現すると矛盾する（1行は1社としか紐付けられない）。
--   ・company_members.roleに'platform_admin'を追加すると、company_idが
--     not null制約のため「どの会社の運営者か」という誤った意味を持ってしまう
--     （運営者は特定の1社に属する概念ではない）。
-- そのため、「auth.users.idそのものが運営者かどうか」だけを表す最小限の
-- テーブルにする。company_idを一切持たない。
create table if not exists platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table platform_admins is
  'サービス運営者（全会社を横断管理できる権限）。company_membersとは別軸で管理し、'
  '1ユーザー1社制約（company_members.user_id unique）とは独立している。'
  '運営者の登録・削除は運営者自身がSupabase SQL Editorから手動で行う運用とし、'
  'アプリからのINSERT/UPDATE/DELETEは一切許可しない（本ファイルのgrant文参照）。';

alter table platform_admins enable row level security;
revoke all on platform_admins from anon;

-- 自分自身がplatform_adminかどうかだけを確認できる（他人の行は見えない）。
-- INSERT/UPDATE/DELETEのポリシー・GRANTは意図的に作らない
-- （運営者の追加はSupabaseダッシュボード/SQL Editorからのみ行う。本ファイル末尾の
-- Phase 8節「最初のplatform_admin登録」参照）。
drop policy if exists platform_admins_select_own on platform_admins;
create policy platform_admins_select_own
  on platform_admins
  for select
  to authenticated
  using (user_id = auth.uid());

grant select on platform_admins to authenticated;

-- ログイン中ユーザーがplatform_adminかどうかを判定する、唯一の入り口。
-- 他のRLSポリシー・RPCから「is_platform_admin() or ...」の形で参照することで、
-- 「company_membersに所属しているか」とは独立に運営者権限を判定できるようにする。
--
-- SECURITY DEFINERではなくSECURITY INVOKER（デフォルト）にしている理由：
-- platform_admins_select_ownポリシーにより、呼び出し元は既に「自分自身の行」を
-- 見る権限を持っているため、SECURITY DEFINERで権限を昇格させる必要が無い
-- （本ファイルの設計方針：SECURITY DEFINERは本当に必要な場合のみ使う）。
create or replace function is_platform_admin()
returns boolean
language sql
security invoker
set search_path = public
stable
as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

comment on function is_platform_admin() is
  'ログイン中ユーザー(auth.uid())がplatform_adminかどうかを返す。他のRLS/RPCが'
  '権限判定に使う唯一の入り口。company_membersとは独立して判定する。';

revoke all on function is_platform_admin() from public;
grant execute on function is_platform_admin() to authenticated;

-- 会社ごとに1行だけ持つ「今の下書き」。保存のたびに丸ごと upsert する想定。
-- ※ このPhaseではアプリからの書き込み処理はまだ実装しない（テーブルのみ用意する）。
create table if not exists draft_configs (
  company_id uuid primary key references companies (id) on delete cascade,
  company_settings jsonb not null default '{}'::jsonb,
  policies jsonb not null default '[]'::jsonb,
  expense_types jsonb not null default '[]'::jsonb,
  flow jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

-- 「公開する」を押すたびに追記する（上書きしない＝そのまま変更履歴になる）。
-- ※ このPhaseでは公開処理そのものはまだ実装しない（テーブルのみ用意する）。
create table if not exists published_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  company_settings jsonb not null,
  policies jsonb not null,
  expense_types jsonb not null,
  flow jsonb not null,
  config_snapshot jsonb not null,
  published_at timestamptz not null default now(),
  published_by uuid references auth.users (id) on delete set null
);

comment on column published_versions.config_snapshot is
  '既存の buildConfigFromFlow() が生成する現行config.json互換の形（本番Botはこの列だけを読む想定）。';

-- companies → published_versions の循環参照を解消する外部キー制約。
-- 両方のテーブルが揃った後でのみ追加できる。
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'companies_current_published_version_id_fkey'
  ) then
    alter table companies
      add constraint companies_current_published_version_id_fkey
      foreign key (current_published_version_id)
      references published_versions (id)
      on delete set null;
  end if;
end $$;

-- ============================================================================
-- 2. インデックス（無くても動くが、将来の検索・履歴表示のために用意しておく）
-- ============================================================================

create index if not exists idx_company_members_user_id on company_members (user_id);
create index if not exists idx_company_members_company_id on company_members (company_id);
create index if not exists idx_published_versions_company_id_published_at
  on published_versions (company_id, published_at desc);

-- ============================================================================
-- 3. RLS（Row Level Security）
-- ============================================================================
--
-- 方針：「company_members に自分(auth.uid())と対象company_idの組み合わせが
-- 存在するか」を各ポリシーの条件にする。company_members 自体のポリシーも
-- 「自分の行だけ見える」なので、他テーブルのポリシーから company_members を
-- 参照しても、参照する側・される側の双方でauth.uid()が一致する行しか
-- 見えない＝正しく動作する。
--
-- そのため、いわゆる「RLSを回避して全件参照する」ためのSECURITY DEFINER関数は
-- 一切使用していない。SECURITY DEFINERは便利な反面、関数内のSQLがRLSを無視して
-- 実行されてしまう（書き方を誤ると全社のデータが見えてしまう）リスクがあるため、
-- 今回のような単純な所属チェックでは使わない方が安全と判断した。
--
-- また、anon（未ログインの匿名ロール）に対するポリシーは一切作らない。
-- 「とりあえずanonにSELECTを許可する」ような暫定措置は行わない。
-- 本番Botの公開読み取りは、後続Phaseで専用の公開ビュー/RPCとして別途設計する。

alter table companies enable row level security;
alter table company_members enable row level security;
alter table draft_configs enable row level security;
alter table published_versions enable row level security;

-- 念のため、anon ロールへのテーブル権限そのものを明示的に剥奪しておく
-- （RLSにより既に拒否されるはずだが、二重の防御線として設定する）。
revoke all on companies from anon;
revoke all on company_members from anon;
revoke all on draft_configs from anon;
revoke all on published_versions from anon;

-- authenticated ロールへの最小権限GRANT。
--
-- RLSポリシー（上記のenable row level security）は「どの行にアクセスしてよいか」
-- を制御するのに対し、このGRANTは「そもそもどのSQLコマンド（SELECT / INSERT /
-- UPDATE / DELETE）を試みることが許されるか」を制御する、別レイヤーの権限である。
-- PostgreSQLでは、テーブル権限（GRANT）のチェックがRLSポリシーの評価より先に
-- 行われるため、対応するGRANTが無いと「ポリシー上は許可されているはずの操作」
-- すら実行できず、42501 permission deniedになる。
-- 新規にSupabaseプロジェクトを作った場合、authenticatedロールに
-- これらのテーブルへのデフォルト権限が自動的には付与されないため、
-- 各テーブルのRLSポリシーで許可している操作の集合と過不足なく一致するように、
-- ここで明示的にGRANTする。
--
--   companies         : SELECT・UPDATEのみ（INSERT/DELETEポリシーが無いため付与しない）
--   company_members   : SELECTのみ（INSERT/UPDATE/DELETEポリシーを意図的に作っていない
--                        ＝ここでもGRANTしない。自分を任意の会社の管理者として
--                        追加できてしまうような自己昇格の経路を残さないため）
--   draft_configs     : SELECT・INSERT・UPDATE・DELETE（4つとも対応するポリシーがある）
--   published_versions: SELECT・INSERTのみ（追記専用の設計のため、UPDATE/DELETEは付与しない）
grant select, update on companies to authenticated;
grant select on company_members to authenticated;
grant select, insert, update, delete on draft_configs to authenticated;
grant select, insert on published_versions to authenticated;

-- --- company_members --------------------------------------------------------
-- 自分自身の所属行だけ見える。他の管理者が誰かは見えない（今回のスコープでは不要）。
-- INSERT/UPDATE/DELETEのポリシーは意図的に作らない
-- （初期管理者の登録はSupabaseダッシュボード/SQL Editorから行う。6章参照）。
drop policy if exists company_members_select_own on company_members;
create policy company_members_select_own
  on company_members
  for select
  to authenticated
  using (user_id = auth.uid());

-- --- companies ---------------------------------------------------------------
-- 所属会社のadmin、またはplatform_adminだけ閲覧・更新できる。
--
-- Phase 7以降の重要な変更：以前は「company_membersに所属していれば」
-- （＝role列の値を見ずに）閲覧・更新を許可していたが、これはcompany_membersが
-- 事実上「管理者のみ」しか登録されていなかった前提に依存していた。
-- Phase 7で一般利用者もcompany_membersへ登録されるようになったため、この前提が
-- 崩れる。一般利用者はcompanies行を直接読む必要が無く（get_my_public_config()経由で
-- 必要な情報だけを受け取る）、管理画面の会社設定編集・公開はadminだけの操作である
-- べきなので、ここは明示的に role = 'admin' を条件に加える。
--
-- Phase 8で追加：is_platform_admin()をORで加え、サービス運営者は所属していない
-- 会社も含めて全社を閲覧・更新できるようにする。is_platform_admin()は
-- platform_admins（auth.uid()自身の行のみ）を参照するだけの安全な判定関数で、
-- クライアントから権限値を渡させる経路は無い。
drop policy if exists companies_select_member on companies;
drop policy if exists companies_select_admin on companies;
create policy companies_select_admin
  on companies
  for select
  to authenticated
  using (
    is_platform_admin()
    or exists (
      select 1
      from company_members
      where company_members.company_id = companies.id
        and company_members.user_id = auth.uid()
        and company_members.role = 'admin'
    )
  );

drop policy if exists companies_update_member on companies;
drop policy if exists companies_update_admin on companies;
create policy companies_update_admin
  on companies
  for update
  to authenticated
  using (
    is_platform_admin()
    or exists (
      select 1
      from company_members
      where company_members.company_id = companies.id
        and company_members.user_id = auth.uid()
        and company_members.role = 'admin'
    )
  )
  with check (
    is_platform_admin()
    or exists (
      select 1
      from company_members
      where company_members.company_id = companies.id
        and company_members.user_id = auth.uid()
        and company_members.role = 'admin'
    )
  );

-- INSERT/DELETEの通常ポリシーは引き続き意図的に作らない。新規会社の作成は
-- Phase 8のcreate_platform_company() RPC（SECURITY DEFINER、platform_admin限定）
-- だけを経路とする（authenticatedへの直接INSERT権限は付与しないまま）。

-- --- draft_configs -------------------------------------------------------------
-- 所属会社のadmin、またはplatform_adminだけが下書きを読み書きできる
-- （一般利用者は不可。理由はcompanies節のコメントと同じ）。
-- 所属していない会社の下書きは、admin・platform_adminいずれでもない限り
-- 存在自体も含めて一切見えない。
drop policy if exists draft_configs_select_member on draft_configs;
drop policy if exists draft_configs_select_admin on draft_configs;
create policy draft_configs_select_admin
  on draft_configs
  for select
  to authenticated
  using (
    is_platform_admin()
    or exists (
      select 1
      from company_members
      where company_members.company_id = draft_configs.company_id
        and company_members.user_id = auth.uid()
        and company_members.role = 'admin'
    )
  );

drop policy if exists draft_configs_insert_member on draft_configs;
drop policy if exists draft_configs_insert_admin on draft_configs;
create policy draft_configs_insert_admin
  on draft_configs
  for insert
  to authenticated
  with check (
    is_platform_admin()
    or exists (
      select 1
      from company_members
      where company_members.company_id = draft_configs.company_id
        and company_members.user_id = auth.uid()
        and company_members.role = 'admin'
    )
  );

drop policy if exists draft_configs_update_member on draft_configs;
drop policy if exists draft_configs_update_admin on draft_configs;
create policy draft_configs_update_admin
  on draft_configs
  for update
  to authenticated
  using (
    is_platform_admin()
    or exists (
      select 1
      from company_members
      where company_members.company_id = draft_configs.company_id
        and company_members.user_id = auth.uid()
        and company_members.role = 'admin'
    )
  )
  with check (
    is_platform_admin()
    or exists (
      select 1
      from company_members
      where company_members.company_id = draft_configs.company_id
        and company_members.user_id = auth.uid()
        and company_members.role = 'admin'
    )
  );

drop policy if exists draft_configs_delete_member on draft_configs;
drop policy if exists draft_configs_delete_admin on draft_configs;
create policy draft_configs_delete_admin
  on draft_configs
  for delete
  to authenticated
  using (
    is_platform_admin()
    or exists (
      select 1
      from company_members
      where company_members.company_id = draft_configs.company_id
        and company_members.user_id = auth.uid()
        and company_members.role = 'admin'
    )
  );

-- --- published_versions --------------------------------------------------------
-- 所属会社のadmin、またはplatform_adminだけが公開履歴を閲覧・追記できる
-- （一般利用者は不可。理由はcompanies節のコメントと同じ）。一般利用者は
-- 公開設定の内容をget_my_public_config()経由（config_snapshotのみ）で受け取り、
-- published_versionsの生テーブル（flow・company_settings等の編集用内部構造を
-- 含む）へは一切アクセスできない。UPDATE/DELETEのポリシーは意図的に作らない
-- （公開履歴は追記専用のため）。
drop policy if exists published_versions_select_member on published_versions;
drop policy if exists published_versions_select_admin on published_versions;
create policy published_versions_select_admin
  on published_versions
  for select
  to authenticated
  using (
    is_platform_admin()
    or exists (
      select 1
      from company_members
      where company_members.company_id = published_versions.company_id
        and company_members.user_id = auth.uid()
        and company_members.role = 'admin'
    )
  );

drop policy if exists published_versions_insert_member on published_versions;
drop policy if exists published_versions_insert_admin on published_versions;
create policy published_versions_insert_admin
  on published_versions
  for insert
  to authenticated
  with check (
    is_platform_admin()
    or exists (
      select 1
      from company_members
      where company_members.company_id = published_versions.company_id
        and company_members.user_id = auth.uid()
        and company_members.role = 'admin'
    )
  );

-- ============================================================================
-- 4. Phase 3: 公開処理（下書き → published_versions への正式公開）
-- ============================================================================
--
-- 目的：
--   published_versionsへのINSERTと、companies.current_published_version_idの
--   UPDATEを、1つのトランザクションとして原子的に行う。
--   ブラウザ側でINSERT→UPDATEを別々に呼ぶと、途中でエラーが起きた場合に
--   「公開履歴だけ増えて現在バージョンは更新されない」といった不整合が
--   起こりうるため、1つのPostgres関数（RPC）にまとめる。
--
-- なぜSECURITY DEFINERを使わないか：
--   この関数が行うINSERT（published_versions）・UPDATE（companies）は、
--   どちらも既存のRLSポリシーにより「呼び出したauthenticatedユーザーが
--   その会社のcompany_membersであれば」既に許可されている操作である。
--   つまりSECURITY INVOKER（デフォルト）のままで、呼び出し元の権限の範囲内で
--   十分に実行できる。SECURITY DEFINERは「本来権限が無い操作を関数経由でのみ
--   許可する」ときに初めて必要になるものであり、今回は該当しないため使わない
--   （SECURITY DEFINERはsearch_path固定を怠ると危険という既知のリスクがあり、
--   必要性が無い限り避けるのが安全）。
--
-- 権限昇格を防ぐ設計：
--   ・関数内で明示的に「auth.uid()がp_company_idのcompany_membersにadminとして
--     含まれるか、またはplatform_adminか」を検証する（RLSも独立して同じ制約を
--     課すため二重防御になる）。
--   ・EXECUTE権限はauthenticatedのみに付与し、anonからは呼び出せない。
--   ・Phase 7以降：company_membersは一般利用者も登録されるため、単なる
--     「所属しているか」ではなく「role='admin'か」を明示的に確認する
--     （そうしないと一般利用者が自社の公開設定を書き換えられてしまう）。
--   ・Phase 8で追加：is_platform_admin()もORで許可する。この関数はSECURITY
--     INVOKERのままなので、実際のINSERT/UPDATEはRLS（companies_update_admin・
--     published_versions_insert_admin、いずれもis_platform_admin()を含む）で
--     最終的に許可判定される。ここでの事前チェックは、RLSに拒否される前に
--     分かりやすいエラーメッセージで早期に弾くためのものであり、両者は
--     常に同じ条件で揃えておく必要がある。

create or replace function publish_company_draft(p_company_id uuid, p_config_snapshot jsonb)
returns published_versions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_draft draft_configs%rowtype;
  v_new_version published_versions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if not (
    is_platform_admin()
    or exists (
      select 1
      from company_members
      where company_members.company_id = p_company_id
        and company_members.user_id = auth.uid()
        and company_members.role = 'admin'
    )
  ) then
    raise exception 'admin privileges required for this company' using errcode = '42501';
  end if;

  select * into v_draft from draft_configs where draft_configs.company_id = p_company_id;

  if not found then
    raise exception 'no draft found for this company' using errcode = 'P0002';
  end if;

  -- Phase 11で追加：concur_expense_type_mappings列もdraft_configsからそのまま
  -- コピーする（他の列と全く同じ「公開のたびに複製する」方式）。
  --
  -- 【将来の削除予定・現時点では未適用】経費タイプID＝Concur EXP_KEYという
  -- 設計への正式リファクタリングにより、アプリ側はもうこの列に意味のある値を
  -- 書き込まない（常に空配列のまま複製されるだけになる）。列自体・この
  -- INSERT文からの参照を削除する際は、schema.sqlの列定義コメント側に書いた
  -- 安全なdeploy順序（アプリ切替→未参照確認→列を一定期間残す→別migrationで
  -- 削除）に従い、このinto句・values句からconcur_expense_type_mappingsを
  -- 取り除いた版へ差し替える。今回はその変更を行っていない。
  insert into published_versions (
    company_id, company_settings, policies, expense_types, flow, concur_expense_type_mappings,
    config_snapshot, published_by
  )
  values (
    p_company_id, v_draft.company_settings, v_draft.policies, v_draft.expense_types, v_draft.flow,
    v_draft.concur_expense_type_mappings, p_config_snapshot, auth.uid()
  )
  returning * into v_new_version;

  update companies
  set current_published_version_id = v_new_version.id
  where id = p_company_id;

  return v_new_version;
end;
$$;

comment on function publish_company_draft(uuid, jsonb) is
  '下書き(draft_configs)をpublished_versionsへ追記し、companies.current_published_version_idを'
  '同じトランザクション内で原子的に更新する。config_snapshotはbuildConfigFromFlow()の出力を'
  'アプリ側で計算してから渡す（このSQL関数の中では計算しない）。';

revoke all on function publish_company_draft(uuid, jsonb) from public;
grant execute on function publish_company_draft(uuid, jsonb) to authenticated;

-- --- companies.current_published_version_id が「別会社のpublished_versions」を
--     指せてしまわないようにする、DBレベルでの保証 -------------------------------
--
-- 以前のレビューで、companies_update_memberポリシー（自社の行ならUPDATEできる）
-- が current_published_version_id の値自体まではチェックしていないため、
-- 悪意or誤操作のあるクライアントが自社のcompaniesレコードのcurrent_published_version_idに
-- 「他社のpublished_versions.id」を書き込めてしまう余地がある、という設計メモが残っていた。
--
-- 対処として、複合外部キー制約を使う。published_versions(id, company_id) に
-- 一意制約を追加し、companies(current_published_version_id, id) が
-- published_versions(id, company_id) を参照するようにする。
-- こうすると「current_published_version_id が指すpublished_versions行のcompany_idは、
-- 必ずcompanies.id自身と一致する」ことをPostgres自身が制約として保証する。
-- トリガーのような手続き的なコードではなく宣言的な制約のため、
-- 将来どんな経路（RPC・SQL Editor・別のアプリケーションコード等）で
-- companiesがUPDATEされても、抜け道なく機能する。
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'published_versions_id_company_id_key'
  ) then
    alter table published_versions
      add constraint published_versions_id_company_id_key unique (id, company_id);
  end if;
end $$;

alter table companies drop constraint if exists companies_current_published_version_id_fkey;

alter table companies
  add constraint companies_current_published_version_id_fkey
  foreign key (current_published_version_id, id)
  references published_versions (id, company_id)
  on delete set null (current_published_version_id);

-- ============================================================================
-- 5. Phase 4: 本番Bot向けの匿名公開読み取り専用の入り口
-- ============================================================================
--
-- 目的：
--   ログイン不要の利用者Bot画面が、company_codeを指定するだけで
--   「現在公開中の設定（config_snapshotとpublished_atのみ）」を取得できるように
--   する。ただし anon には companies / published_versions / draft_configs /
--   company_members のいずれの生テーブルへのSELECT権限も一切付与しない
--   （このファイル冒頭の revoke all on ... from anon はそのまま維持する）。
--
-- なぜここだけSECURITY DEFINERを使うか：
--   Phase 3のpublish_company_draftは「呼び出し元(authenticated)が既にRLSで
--   許可されている操作」を1トランザクションにまとめるだけだったため
--   SECURITY INVOKERで足りた。しかし今回はanonが呼び出し元であり、anonは
--   companies/published_versionsのどちらに対しても素のSELECT権限を一切
--   持たない（意図的にそうしている）。そのため、この関数だけは
--   「本来アクセスできないテーブルの、ごく狭い一部だけを、決められた形でのみ
--   見せる」ためにSECURITY DEFINERを使う。これはSECURITY DEFINERが
--   正当に必要になる典型例（狭い公開APIの実装）であり、以下の対策を徹底する：
--     ・search_pathを明示的にpublicへ固定する（search_path経由の乗っ取り防止）
--     ・select * を使わず、返す列を company_code / config_snapshot /
--       published_at の3つだけに限定する（company.id・published_versions.id・
--       published_by・draft_configs・company_members等は一切返さない）
--     ・書き込みは一切行わない（読み取り専用、stable）
--     ・EXECUTE権限はanon・authenticatedにのみ付与し、それ以外は剥奪する
--     ・パラメータはcompany_codeのみ。UUID・バージョン番号を指定した取得や
--       一覧取得はできない設計にする
--
-- 会社が存在しない場合と、存在するがまだ一度も公開していない場合は、
-- どちらも「該当行なし」という同じ結果になる（内部的に区別しない）。
-- companies.current_published_version_idがnullの会社は
-- published_versionsとのjoinが成立せず、自然に0行になるため、
-- 特別な分岐を書かなくてもこの仕様が満たされる。
create or replace function get_public_config(p_company_code text)
returns table (company_code text, config_snapshot jsonb, published_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select c.company_code, pv.config_snapshot, pv.published_at
  from companies c
  join published_versions pv on pv.id = c.current_published_version_id
  where c.company_code = p_company_code;
$$;

comment on function get_public_config(text) is
  '匿名の利用者Bot向け、公開設定の唯一の読み取り口。company_code・config_snapshot・'
  'published_atの3列だけを返す。companies/published_versionsの生テーブルへは'
  'anonからは一切アクセスできない（この関数を経由した場合のみ、この3列だけが見える）。';

revoke all on function get_public_config(text) from public;
grant execute on function get_public_config(text) to anon, authenticated;

-- ============================================================================
-- 6. Phase 6: 匿名向け「公開中の会社一覧」の入り口（複数社対応）
-- ============================================================================
--
-- 目的：
--   本番Bot画面の会社セレクタ・?company=xxxの初期表示判断のために、
--   「現在公開されている会社」の一覧（company_codeとcompany_nameのみ）を
--   匿名ユーザーが取得できるようにする。これにより、Supabase側で会社を
--   登録・公開するだけで、Reactコードの変更・再デプロイ無しに新しい会社が
--   本番Botで使えるようになる。
--
-- なぜここもSECURITY DEFINERを使うか：
--   get_public_configと全く同じ理由。anonはcompaniesへの素のSELECT権限を
--   持たない（意図的にそうしている）ため、「本来アクセスできないテーブルの、
--   ごく狭い一部だけを、決められた形でのみ見せる」ためにSECURITY DEFINERを使う。
--   以下の対策を徹底する：
--     ・search_pathを明示的にpublicへ固定する
--     ・select * を使わず、返す列を company_code / company_name の2つだけに限定する
--       （companies.id・current_published_version_id・created_at・
--       company_members・draft_configs・published_versions履歴等は一切返さない）
--     ・current_published_version_id is not null （＝公開済み）の会社のみを返す。
--       未公開の会社は一覧に一切現れない
--     ・書き込みは一切行わない（読み取り専用、stable）
--     ・EXECUTE権限はanon・authenticatedにのみ付与し、それ以外は剥奪する
--     ・パラメータを取らない（特定の会社を狙い撃ちで問い合わせる用途では
--       なく、あくまで「公開中の会社の一覧」を返すだけの関数にする。
--       個別の会社の設定内容はget_public_configを別途呼ぶ）
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

-- ============================================================================
-- 7. Phase 7: エンドユーザー認証・会社自動判定・権限管理
-- ============================================================================
--
-- 目的：
--   一般利用者もSupabase Auth（メール+パスワード、self-service signUp）で
--   ログイン必須にし、ログイン中のuser_id（auth.uid()）だけから所属会社を
--   自動判定して、その会社の公開設定だけを取得できるようにする。
--   会社セレクタ・?company=・他社一覧は一般利用者には一切見せない
--   （UIで隠すだけでなく、本節のRPC/RLSがその最終的な境界になる）。
--
-- 前提となる設計変更（重要）：
--   これまでcompany_membersは実質「管理者専用」のテーブルだった
--   （コメントに「現時点ではadminのみ運用」とあった）。Phase 7では一般利用者も
--   role='user'としてここに登録されるようになるため、company_membersに
--   「所属しているか」だけを条件にしていた既存のRLS/RPC（companies・
--   draft_configs・published_versions・publish_company_draft）を、本節より前の
--   箇所で「role='admin'か」を条件に含めるよう修正済みである
--   （この節を単独で追加SQLとして流す場合、必ず本節より前の
--   companies_select_admin等のCREATE POLICY文もあわせて実行すること。
--   docs/supabase-setup.mdの「既存Supabaseへ追加実行するSQL」参照）。

-- --- 7-1. 1ユーザー1社の保証（DBレベル） -------------------------------------
--
-- 重要：この制約を実際のSupabaseへ追加する前に、既存データに複数会社へ
-- 所属しているuser_idが無いか必ず確認すること
-- （docs/supabase-setup.md「Phase 7既存データ確認」節の確認SQLを参照）。
-- 重複がある状態でこのALTERを実行すると、Postgresが制約違反として
-- エラーを返すだけで、既存データが勝手に削除されることはない
-- （安全側に倒れる。ただしエラーの原因を解消するまで、以後この節のALTERは
-- 適用されない状態が続く）。
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'company_members_user_id_key'
  ) then
    alter table company_members add constraint company_members_user_id_key unique (user_id);
  end if;
end $$;

-- 既存のroleが'user'/'admin'以外の値を持っていないことを保証する
-- （create table if not existsでは既存テーブルへcheck制約は追加されないため、
-- 新規プロジェクトと既存プロジェクトの両方で効くよう、ここでも明示的に追加する）。
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'company_members_role_check'
  ) then
    alter table company_members add constraint company_members_role_check check (role in ('user', 'admin'));
  end if;
end $$;

-- --- 7-2. 招待コード（会社ごとに1つ、ハッシュ化して保存） ---------------------
--
-- 招待コード自体は「会社から口頭・メール等で案内される、ログイン後に入力する
-- 合言葉」という位置づけであり、パスワードほどの機密性は求めないが、
-- 万一DBがまるごと漏洩した場合に備え、平文ではなくSHA-256ハッシュで保存する
-- （pgcrypto（extensionsスキーマ）のdigest()を使う。ソルトは付与していない：
-- 招待コードは会社単位で使い回す性質上、辞書攻撃よりも「DB漏洩時に生の合言葉が
-- 読めない」ことを主眼にしているため、この用途ではハッシュのみで十分と判断した）。
alter table companies add column if not exists invite_code_hash text;

comment on column companies.invite_code_hash is
  '招待コードのSHA-256ハッシュ（hex）。運営者がSQL Editorから会社登録時に設定する。'
  '平文の招待コードはDBに保存せず、発行時に管理者へ別途伝える。';

-- --- 7-3. get_my_public_config(): ログイン中ユーザー専用、会社自動判定 -------
--
-- 一般利用者Bot画面の唯一のデータ取得口。引数を一切取らない
-- （company_codeを渡させない＝他社を指定する余地自体が無い）。
-- auth.uid()から company_members → companies → published_versions の順に
-- 解決し、以下のいずれの状態も同じ関数で自然に区別できる：
--   ・company_membersに行が無い     → 0行を返す（＝会社未所属）
--   ・行はあるが未公開               → company_code/company_name/roleは返るが
--                                       config_snapshot/published_atはnull
--   ・行があり公開済み               → 全列が埋まって返る
-- roleも一緒に返すことで、呼び出し側が「管理画面への導線を出してよいか」を
-- 追加の問い合わせ無しに判断できる。
create or replace function get_my_public_config()
returns table (
  company_code text,
  company_name text,
  role text,
  config_snapshot jsonb,
  published_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select c.company_code, c.company_name, cm.role, pv.config_snapshot, pv.published_at
  from company_members cm
  join companies c on c.id = cm.company_id
  left join published_versions pv on pv.id = c.current_published_version_id
  where cm.user_id = auth.uid();
$$;

comment on function get_my_public_config() is
  'ログイン中ユーザー(auth.uid())の所属会社を自動判定し、company_code・company_name・'
  'role・config_snapshot・published_atを返す。パラメータは無く、他社を指定する経路が'
  '存在しない。未所属なら0行、所属していても未公開ならconfig_snapshot/published_atがnull。';

revoke all on function get_my_public_config() from public;
grant execute on function get_my_public_config() to authenticated;

-- --- 7-4. redeem_invite_code(): 招待コードで会社へ所属する（role=userのみ） ---
--
-- 権限昇格を防ぐ設計：
--   ・roleはこの関数の中で 'user' に固定でINSERTする（パラメータとして
--     受け取らない＝クライアントがrole=adminを指定する経路が存在しない）。
--   ・既にどこかの会社へ所属している場合は拒否する（1ユーザー1社を、
--     DB制約に加えてアプリ層でも早期に分かりやすいエラーとして守る）。
--   ・招待コードはハッシュ同士の比較でのみ照合する。
--
-- 重要（実Supabaseで発生した不具合の修正）：
--   この関数は search_path = public に固定している（SECURITY DEFINERの
--   乗っ取り防止のため）。しかしpgcryptoのdigest()は多くのSupabaseプロジェクトで
--   extensionsスキーマにインストールされており、search_pathがpublicだけの状態では
--   単に digest(...) と書いても解決できず、実行時に
--   「function digest(text, unknown) does not exist」（Postgresエラーコード42883）
--   になる。search_pathに頼らず、常に extensions.digest(...) と明示的に
--   スキーマ修飾して呼び出す（本ファイル冒頭のcreate extension ... with schema
--   extensionsと対応させている）。
create or replace function redeem_invite_code(p_code text)
returns table (company_code text, company_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company companies%rowtype;
  v_normalized text := trim(p_code);
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if v_normalized = '' then
    raise exception 'invite code required' using errcode = '22023';
  end if;

  if exists (select 1 from company_members where company_members.user_id = auth.uid()) then
    raise exception 'already belongs to a company' using errcode = '42710';
  end if;

  select * into v_company
  from companies c
  where c.invite_code_hash = encode(extensions.digest(v_normalized, 'sha256'), 'hex');

  if not found then
    raise exception 'invalid invite code' using errcode = 'P0002';
  end if;

  insert into company_members (company_id, user_id, role)
  values (v_company.id, auth.uid(), 'user');

  return query select v_company.company_code, v_company.company_name;
exception
  when unique_violation then
    -- company_members_user_id_key（1ユーザー1社制約）に、上のexists検査と
    -- このINSERTの間の競合状態で引っかかった場合の保険。
    raise exception 'already belongs to a company' using errcode = '42710';
end;
$$;

comment on function redeem_invite_code(text) is
  '招待コードを検証し、ログイン中ユーザーをrole=userとして対象会社のcompany_membersへ'
  '登録する。roleはこの関数内で固定しており、呼び出し側から管理者権限を要求する'
  '経路は存在しない。';

revoke all on function redeem_invite_code(text) from public;
grant execute on function redeem_invite_code(text) to authenticated;

-- --- 7-5. list_my_company_members(): 自社ユーザー一覧（adminのみ、メール込み）---
--
-- なぜSECURITY DEFINERが必要か：
--   一覧にメールアドレスを表示するには auth.users.email が要るが、authは
--   Supabaseが管理する保護スキーマであり、authenticatedロールには
--   auth.usersへの直接SELECT権限が無い（意図的な制限）。この関数だけが
--   その制限を越えて、呼び出し元の所属会社に限定した最小限の列
--   （member_id・user_id・email・role・created_at）を返す。
-- 安全設計：
--   ・パラメータを取らない（company_idを渡させない＝他社を指定できない）。
--   ・呼び出し元がadminでない、または未所属の場合は0行を返す（エラーにはしない。
--     UIが「権限がありません」を自然に出せるようにするため）。
--
-- 重要（実Supabaseで発生した不具合の修正）：
--   auth.users.email の実際の列型は character varying(255) だが、
--   RETURNS TABLEでは email text と宣言している。PL/pgSQLの関数は
--   RETURN QUERYで返す列の型がRETURNS TABLEの宣言と完全に一致している
--   ことを要求するため、varchar(255)のまま返すと実行時に
--   「structure of query does not match function result type」
--   （Postgresエラーコード42804）になる。u.email::text と明示的に
--   キャストすることで解消する。
create or replace function list_my_company_members()
returns table (member_id uuid, user_id uuid, email text, role text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_company_id uuid;
  v_role text;
begin
  select cm.company_id, cm.role into v_company_id, v_role
  from company_members cm
  where cm.user_id = auth.uid();

  if v_company_id is null or v_role <> 'admin' then
    return;
  end if;

  return query
    select cm.id, cm.user_id, u.email::text, cm.role, cm.created_at
    from company_members cm
    join auth.users u on u.id = cm.user_id
    where cm.company_id = v_company_id
    order by cm.created_at;
end;
$$;

comment on function list_my_company_members() is
  '呼び出し元がadminの場合のみ、自社company_membersの一覧をemail付きで返す。'
  'それ以外（未所属・一般user）は0行。company_idはパラメータとして受け取らない。';

revoke all on function list_my_company_members() from public;
grant execute on function list_my_company_members() to authenticated;

-- --- 7-6. update_company_member_role(): role変更（adminのみ、最後のadmin保護）---
--
-- 権限昇格・自己昇格・他社操作・最後のadmin降格を、全てこの関数内で明示的に
-- 検証する（RLSのUPDATEポリシーではなくRPC方式を選んだ理由：company_membersの
-- role変更は「対象行の所属会社で自分がadminか」「変更後も自社にadminが
-- 最低1人残るか」という複数行にまたがる条件を伴い、宣言的なRLSポリシーで
-- 表現するより、手続き的なチェックとして1箇所にまとめた方が監査・保守しやすいと
-- 判断したため）。
--
-- Phase 8で追加：is_platform_admin()なら、呼び出し元がその会社のcompany_members
-- でなくても（＝所属していない会社でも）role変更を許可する。これにより、
-- platform_adminが新しく作成した会社の最初のadminを、対象ユーザーが招待コードで
-- 参加した後に安全に設定できるようになる（platform_adminが他人のパスワードを
-- 扱うことは一切ない）。最後のadmin保護は、呼び出し元がplatform_adminであっても
-- 変わらず適用される（対象会社の実際のadmin人数を見て判定するため）。
create or replace function update_company_member_role(p_member_id uuid, p_new_role text)
returns company_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target company_members%rowtype;
  v_is_platform_admin boolean;
  v_caller_is_company_admin boolean;
  v_remaining_admins int;
  v_result company_members%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if p_new_role not in ('user', 'admin') then
    raise exception 'invalid role' using errcode = '22023';
  end if;

  select * into v_target from company_members where id = p_member_id;

  if not found then
    raise exception 'member not found in your company' using errcode = 'P0002';
  end if;

  v_is_platform_admin := is_platform_admin();

  v_caller_is_company_admin := exists (
    select 1
    from company_members
    where company_id = v_target.company_id
      and user_id = auth.uid()
      and role = 'admin'
  );

  if not (v_is_platform_admin or v_caller_is_company_admin) then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;

  -- 最後のadminをuserへ降格することはできない
  -- （対象自身を除いた、同じ会社のadmin人数が0になる変更を拒否する）。
  -- platform_admin経由の呼び出しでも同じ制約が適用される。
  --
  -- 競合対策：2人の別々のadminを同時に降格しようとする2つの呼び出しが
  -- 並行実行された場合、単純にcount(*)だけで判定すると、両方とも
  -- 「もう1人adminがいる」と見えたまま両方コミットしてしまい、
  -- 結果的にadminが0人になる恐れがある（count(*)には集約関数のため
  -- for updateを直接付けられないため、先に対象会社のadmin行を明示的に
  -- ロックしてから数える。これにより2つ目の呼び出しは1つ目がコミットする
  -- まで待たされ、待った後の正しい人数で判定できる）。
  if v_target.role = 'admin' and p_new_role = 'user' then
    perform 1
    from company_members
    where company_id = v_target.company_id
      and role = 'admin'
    for update;

    select count(*) into v_remaining_admins
    from company_members
    where company_id = v_target.company_id
      and role = 'admin'
      and id <> p_member_id;

    if v_remaining_admins = 0 then
      raise exception 'cannot demote the last admin of this company' using errcode = '55000';
    end if;
  end if;

  update company_members
  set role = p_new_role
  where id = p_member_id
  returning * into v_result;

  return v_result;
end;
$$;

comment on function update_company_member_role(uuid, text) is
  '呼び出し元がadminの場合のみ、自社メンバーのroleを変更する。他社のメンバーは'
  '対象にできず、最後のadminをuserへ降格することもできない。';

revoke all on function update_company_member_role(uuid, text) from public;
grant execute on function update_company_member_role(uuid, text) to authenticated;

-- ============================================================================
-- 8. Phase 8: サービス運営者（platform_admin）機能
-- ============================================================================
--
-- platform_adminsテーブル・is_platform_admin()関数、および既存RLS/RPCへの
-- is_platform_admin() OR条件の追加は、本ファイルではcompany_members/companies等の
-- 定義直後（Phase 7以前の節）に置いてある（is_platform_admin()を後から参照する
-- 既存ポリシーより前に定義しておく必要があるため）。本節ではPhase 8で新規に
-- 追加した「platform_admin専用RPC」だけをまとめる。

-- --- 8-1. list_platform_companies(): 全社一覧（platform_adminのみ） -----------
--
-- 通常adminのfetchMyCompanies()（companies_select_adminポリシー経由の素の
-- SELECT）は「自分がadminの1社」しか返らない。platform_adminは全社を横断して
-- 管理対象を選べる必要があるため、専用のRPCを用意する。company_membersへの
-- 所属を一切問わず、is_platform_admin()だけで判定する。
create or replace function list_platform_companies()
returns table (company_id uuid, company_code text, company_name text)
language sql
security definer
set search_path = public
stable
as $$
  select c.id, c.company_code, c.company_name
  from companies c
  where is_platform_admin()
  order by c.company_code;
$$;

comment on function list_platform_companies() is
  'platform_adminの場合のみ、全社のid・company_code・company_nameを返す。'
  'それ以外（一般user・通常admin）は0行。';

revoke all on function list_platform_companies() from public;
grant execute on function list_platform_companies() to authenticated;

-- --- 8-2. create_platform_company(): 新規会社の作成（platform_adminのみ） -----
--
-- 会社コードの検証・重複チェック・招待コードの生成とハッシュ化・companiesへの
-- INSERTを、1つのSECURITY DEFINER関数の中で原子的に行う。会社コードの形式は
-- resolveInitialCompanyId.js（本番Bot側の?companyの形式検証）と同じ
-- 「小文字英数字とハイフンのみ、63文字以内」に揃えている（URL・内部識別子として
-- 安全に使える形式であることを保証するため）。
--
-- 招待コードは平文をDBへ一切保存しない。この関数の戻り値としてのみ、
-- 呼び出した瞬間だけ平文を返す（以後は再取得不可能。紛失した場合は
-- regenerate_invite_code()で再発行する＝古いコードは同時に無効化される）。
create or replace function create_platform_company(p_company_code text, p_company_name text)
returns table (company_id uuid, company_code text, company_name text, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_normalized_code text := lower(trim(p_company_code));
  v_name text := trim(p_company_name);
  v_new_invite_code text;
  v_company companies%rowtype;
begin
  if not is_platform_admin() then
    raise exception 'platform admin privileges required' using errcode = '42501';
  end if;

  if v_normalized_code !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
    raise exception 'invalid company code format' using errcode = '22023';
  end if;

  if v_name = '' then
    raise exception 'company name required' using errcode = '22023';
  end if;

  -- 重要（実Supabaseで発生した不具合の修正）：
  -- この関数はRETURNS TABLEでcompany_codeという列名を返すため、plpgsql関数の
  -- 本体ではその列名がOUTパラメータとしてスコープ全体に見える。company_codeを
  -- テーブル修飾せずに書くと、companies.company_codeなのかOUTパラメータの
  -- company_codeなのかが曖昧になり、実行時に
  -- 「column reference "company_code" is ambiguous」（Postgresエラーコード42702）
  -- になる。companies側に明示的なエイリアス(c)を付けて解消する。
  if exists (select 1 from companies c where c.company_code = v_normalized_code) then
    raise exception 'company code already exists' using errcode = '23505';
  end if;

  v_new_invite_code := encode(extensions.gen_random_bytes(6), 'hex');

  insert into companies (company_code, company_name, invite_code_hash)
  values (
    v_normalized_code,
    v_name,
    encode(extensions.digest(v_new_invite_code, 'sha256'), 'hex')
  )
  returning * into v_company;

  return query
    select v_company.id, v_company.company_code, v_company.company_name, v_new_invite_code;
end;
$$;

comment on function create_platform_company(text, text) is
  'platform_adminの場合のみ、新しい会社を作成し、生成した招待コード（平文、'
  'この戻り値でのみ取得可能）を返す。会社コードの形式検証・重複チェック・'
  '招待コードのハッシュ化を1トランザクションで行うため、中途半端な会社データは残らない。';

revoke all on function create_platform_company(text, text) from public;
grant execute on function create_platform_company(text, text) to authenticated;

-- --- 8-3. regenerate_invite_code(): 招待コードの再発行（platform_adminのみ） ---
--
-- 実行すると、対象会社の招待コードのハッシュを新しい値へ上書きするため、
-- 古い招待コードは即座に無効になる（同じ会社に対して2つの有効な招待コードが
-- 同時に存在することはない）。新しい平文コードはこの戻り値でのみ取得できる。
--
-- 通常adminへこの操作を許可するかどうかは、今回はplatform_admin限定とした
-- （完了報告で比較・理由を報告する）。
create or replace function regenerate_invite_code(p_company_id uuid)
returns table (invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_code text;
begin
  if not is_platform_admin() then
    raise exception 'platform admin privileges required' using errcode = '42501';
  end if;

  if not exists (select 1 from companies where id = p_company_id) then
    raise exception 'company not found' using errcode = 'P0002';
  end if;

  v_new_code := encode(extensions.gen_random_bytes(6), 'hex');

  update companies
  set invite_code_hash = encode(extensions.digest(v_new_code, 'sha256'), 'hex')
  where id = p_company_id;

  return query select v_new_code;
end;
$$;

comment on function regenerate_invite_code(uuid) is
  'platform_adminの場合のみ、対象会社の招待コードを再発行する。古いコードは'
  '即座に無効化される。新しい平文コードはこの戻り値でのみ取得できる。';

revoke all on function regenerate_invite_code(uuid) from public;
grant execute on function regenerate_invite_code(uuid) to authenticated;

-- --- 8-4. list_platform_company_members(): 任意会社のユーザー一覧（platform_adminのみ）---
--
-- list_my_company_members()（Phase 7、引数なし・呼び出し元自身の所属会社限定）
-- とは別の、Phase 8専用の関数にした。理由：
--   ・list_my_company_members()に引数を追加する形（例：p_company_id uuid
--     default null）にすると、Postgresの関数オーバーロード解決上、既存の
--     0引数版と1引数版が別シグネチャの関数として共存してしまい、
--     クライアントからの無引数呼び出しがどちらに解決されるか分かりにくくなる。
--   ・Phase 7で既にデプロイ・動作確認済みのlist_my_company_members()の挙動を
--     一切変更しないことを優先し、新しい関数名で完全に分離した。
create or replace function list_platform_company_members(p_company_id uuid)
returns table (member_id uuid, user_id uuid, email text, role text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not is_platform_admin() then
    return;
  end if;

  return query
    select cm.id, cm.user_id, u.email::text, cm.role, cm.created_at
    from company_members cm
    join auth.users u on u.id = cm.user_id
    where cm.company_id = p_company_id
    order by cm.created_at;
end;
$$;

comment on function list_platform_company_members(uuid) is
  'platform_adminの場合のみ、指定した任意の会社のcompany_members一覧をemail付きで'
  '返す。それ以外は0行。company_idはplatform_admin判定を通った場合のみ有効になる。';

revoke all on function list_platform_company_members(uuid) from public;
grant execute on function list_platform_company_members(uuid) to authenticated;

-- ============================================================================
-- 9. Phase 9: 通常管理画面からの「会社から削除」機能
-- ============================================================================
--
-- 目的：
--   退職者・誤登録ユーザーのcompany_members行（会社所属）を、運営者がSupabase
--   SQL Editorを操作しなくても、管理画面の「ユーザー管理」から安全に削除できる
--   ようにする（Phase 8末尾の「まだ実装していないもの」に挙げていた項目）。
--
--   削除するのはcompany_membersの対象行だけであり、auth.users（ログイン
--   アカウント本体）・platform_admins・companies・draft_configs・
--   published_versionsはこの関数から一切変更しない。
--   company_members.user_id → auth.users(id) の外部キーは on delete cascade だが、
--   これは「auth.usersを消したらcompany_membersも消える」という一方向の関係で
--   あり、逆方向（company_membersの行を消してもauth.usersは一切影響を受けない）。
--   削除後、そのユーザーはSupabase Authとしてはログインし続けられるが、
--   company_membersに行が無くなるため、companies/draft_configs/published_versionsの
--   RLS（いずれも「company_membersに自分がadminとして存在するか」を条件にしている）
--   により会社データへは即座にアクセスできなくなり、get_my_public_config()も
--   0行を返すようになる（利用者Bot画面はNoMembershipGateへ、既存の「未所属」
--   ユーザーと全く同じ扱いで自然に合流する）。同じ会社の招待コードで
--   redeem_invite_code()を使えば、既存のAuthアカウントのまま（新規Authユーザー
--   作成は不要）role='user'として再参加できる＝既存の再参加フローは変更しない。
--
-- 権限判定・最後のadmin保護・競合対策は、既存のupdate_company_member_role()と
-- 基本的に同じ設計をそのまま踏襲する（新しい権限モデルを作らない）。異なるのは
-- 以下の3点：
--   ・対象行をUPDATEではなくDELETEする
--   ・対象が呼び出し元自身（auth.uid() = 対象行のuser_id）の場合は、たとえ
--     最後のadminでなくても常に拒否する。MVPでは「操作した瞬間に自分自身の
--     管理権限・会社所属が消え、以後の画面状態管理が複雑になる」リスクを
--     避けるための意図的な制限であり、platform_adminが自分自身の
--     company_members行を削除しようとした場合も同様に拒否する
--     （安全性優先。platform_admins自体は今回一切操作しない）。
--   ・DELETEはUPDATEと違い「対象行が既に無い」状態になり得るため、ロック取得後に
--     対象行の存在を明示的に再確認する（update_company_member_role()は対象行を
--     消さないため、同じ行への同時UPDATEはただの冪等な再適用で済み、この再確認は
--     不要だった）。詳細は関数本体のコメント参照。
create or replace function remove_company_member(p_member_id uuid)
returns company_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target company_members%rowtype;
  v_is_platform_admin boolean;
  v_caller_is_company_admin boolean;
  v_remaining_admins int;
  v_result company_members%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select * into v_target from company_members where id = p_member_id;

  if not found then
    raise exception 'member not found in your company' using errcode = 'P0002';
  end if;

  v_is_platform_admin := is_platform_admin();

  v_caller_is_company_admin := exists (
    select 1
    from company_members
    where company_id = v_target.company_id
      and user_id = auth.uid()
      and role = 'admin'
  );

  if not (v_is_platform_admin or v_caller_is_company_admin) then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;

  -- 対象が呼び出し元自身の場合は、権限の有無に関わらず常に拒否する
  -- （MVPの意図的な制限。上のコメント参照）。
  if v_target.user_id = auth.uid() then
    raise exception 'cannot remove yourself from the company' using errcode = '42501';
  end if;

  -- 最後のadminは削除できない。update_company_member_role()と同じロック設計：
  -- 対象会社のadmin行を先に明示的にロックしてから数えることで、2つの削除/降格
  -- リクエストが並行実行されても、その会社のadminが0人になることはない。
  --
  -- 加えて、「全く同じ対象行」を2つのリクエストが同時に削除しようとした場合の
  -- 対策として、ロック取得（＝待機）後に対象行がまだ存在するかを明示的に
  -- 再確認する。ロック待機中に先行リクエストが対象行を削除してコミット済みなら、
  -- 後続リクエストはこの再確認で 'member not found' として安全に失敗する
  -- （再確認をしないと、待機後にそのままDELETEを実行して0行しか削除されず、
  -- エラーにもならずNULLを返してしまう＝実際には削除されていないのに成功したかの
  -- ように見えてしまう不具合があった）。
  --
  -- role='admin'とrole='user'でロック方法を分けているのは、デッドロックを
  -- 避けるため。role='admin'の場合は、対象行自身も含まれる既存のadmin集合ロック
  -- （company_id・role='admin'条件、両リクエストが常に同じ集合を同じ条件で
  -- ロックするため安全）をそのまま再利用して存在確認する。role='user'の場合は
  -- このadmin集合ロックが発生しないため、対象行1行だけを個別にロックする
  -- （ロック対象が常に「1行だけ」なので、他のリクエストとの間でロック順序が
  -- 交差してデッドロックすることはない）。
  if v_target.role = 'admin' then
    perform 1
    from company_members
    where company_id = v_target.company_id
      and role = 'admin'
    for update;

    if not exists (select 1 from company_members where id = p_member_id) then
      raise exception 'member not found in your company' using errcode = 'P0002';
    end if;

    select count(*) into v_remaining_admins
    from company_members
    where company_id = v_target.company_id
      and role = 'admin'
      and id <> p_member_id;

    if v_remaining_admins = 0 then
      raise exception 'cannot remove the last admin of this company' using errcode = '55000';
    end if;
  else
    perform 1 from company_members where id = p_member_id for update;

    if not found then
      raise exception 'member not found in your company' using errcode = 'P0002';
    end if;
  end if;

  delete from company_members where id = p_member_id returning * into v_result;

  return v_result;
end;
$$;

comment on function remove_company_member(uuid) is
  '呼び出し元がその会社のadmin、またはplatform_adminの場合のみ、対象のcompany_members'
  '行（会社所属）を削除する。auth.users・platform_admins等、company_members以外の'
  'テーブルは一切変更しない。呼び出し元自身の行、および最後のadminの行は削除できない。';

revoke all on function remove_company_member(uuid) from public;
grant execute on function remove_company_member(uuid) to authenticated;

-- ============================================================================
-- 10. Phase 10: 管理画面からの「会社削除」機能（platform_adminのみ）
-- ============================================================================
--
-- 目的：
--   検証用・誤って作成した会社（例：test、test1）を、運営者がSupabase
--   SQL Editorを操作しなくても、管理画面の会社セレクタ横から安全に削除できる
--   ようにする。
--
-- 削除範囲（孤立データ対策）：
--   companiesの対象行のみをDELETEする。会社配下の各テーブルは、いずれも
--   company_id（またはdraft_configsの場合はcompany_id自体が主キー）が
--   companies(id) on delete cascadeとして定義済みのため（Phase 1・6・8参照：
--   company_members.company_id／draft_configs.company_id／
--   published_versions.company_id）、Postgresが自動的にカスケード削除する。
--   手動でのDELETE FROM（子テーブル→親テーブルの順）は不要であり、あえて
--   individually DELETEしない（カスケード定義と処理が二重になり、将来
--   スキーマ側だけ変更されて処理側が追従し忘れる不整合の原因になるため）。
--   platform_admins・auth.usersはcompaniesと無関係のテーブルであり、
--   この関数から一切変更しない。
--
-- 権限・安全対策：
--   ・is_platform_admin()のみ実行可能（create_platform_company()と対称の設計）。
--   ・対象会社が存在しない場合は 'company not found'（P0002）。
--   ・「最低1社は必ず存在する」という前提を守るため、companiesが1件しか
--     無い状態からの削除は拒否する（'cannot delete the last remaining
--     company'、55000）。companies全体を先に行ロック（for update）してから
--     件数を数えることで、2つの削除リクエストが同時に走っても
--     「どちらも2件あるから削除してよい」と判断してcompaniesが0件に
--     なってしまう競合を防ぐ（remove_company_member()のadmin集合ロックと
--     同じ考え方）。
create or replace function delete_platform_company(p_company_id uuid)
returns table (company_id uuid, company_code text, company_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company companies%rowtype;
begin
  if not is_platform_admin() then
    raise exception 'platform admin privileges required' using errcode = '42501';
  end if;

  perform 1 from companies for update;

  if not exists (select 1 from companies where id = p_company_id) then
    raise exception 'company not found' using errcode = 'P0002';
  end if;

  if (select count(*) from companies) <= 1 then
    raise exception 'cannot delete the last remaining company' using errcode = '55000';
  end if;

  delete from companies where id = p_company_id returning * into v_company;

  return query
    select v_company.id, v_company.company_code, v_company.company_name;
end;
$$;

comment on function delete_platform_company(uuid) is
  'platform_adminの場合のみ、対象会社を削除する。company_members・draft_configs・'
  'published_versionsはon delete cascadeにより自動的に削除される（孤立データは'
  '残らない）。companiesが1件のみの場合は削除できない（最低1社は存在する'
  '前提を守るため）。';

revoke all on function delete_platform_company(uuid) from public;
grant execute on function delete_platform_company(uuid) to authenticated;

-- ============================================================================
-- 11. Phase 11: Concur Expense Type mappingの保存・公開基盤
-- ============================================================================
--
-- 目的：
--   会社ごとのConcur Expense Type mapping（会社＋ポリシー＋Bot側経費タイプID→
--   Concur側の識別子、という対応表）を、既存のdraft_configs/published_versionsと
--   全く同じ「会社ごと1ドキュメントのJSON-blob」方式で保存できるようにする
--   （設計調査・比較の詳細は完了報告を参照。正規化された専用mappingテーブルは
--   意図的に作らない）。
--
--   今回のPhaseはあくまで保存・公開の「経路」を完成させるだけで、これを編集する
--   管理画面UIはまだ無い（後続Commitで対応）。そのため実運用では、この列は
--   当面ずっと空配列'[]'::jsonbのままになる。
--
-- 既存会社への影響：
--   invite_code_hash（Phase 7）と同じ理由・同じ方式で、create table本体を
--   書き換えず alter table ... add column if not exists で追加する
--   （新規プロジェクトでも既存プロジェクトでも、このファイルを実行すれば
--   同じ状態になる）。デフォルト値'[]'::jsonbにより、既存の全てのdraft_configs行・
--   published_versions行は、この列が追加された時点で自動的に空配列を持つ
--   （NOT NULLだが、既存行はPostgresがデフォルト値で埋めるため失敗しない）。
--   アプリ側（buildConfigFromFlow()・draftConfigRepository.js）もmapping未設定を
--   「空配列」として安全に扱う設計のため、Concurを導入していない会社・
--   このPhase適用前に保存された下書きの挙動は一切変化しない。
-- 【将来の削除予定・現時点では未適用のメモ】
-- 経費タイプID＝Concur EXP_KEYという設計への正式リファクタリングにより、
-- アプリ側（buildConfigFromFlow.js・draftConfigRepository.js・
-- create-concur-quick-expense Edge Function）はこの列を一切読み書きしなく
-- なった。ただし、この変更だけでは列自体もこのコメントも削除しない
-- （安全なdeploy順序：①アプリを新方式へ切り替える →
-- ②旧列を参照していないことを本番で確認する → ③旧列を一定期間残す →
-- ④別commit・別migrationで列を削除する、という段階を踏む）。
-- 実際に削除する際は、以下をそれぞれ別のmigrationとして本番へ適用する想定：
--   alter table draft_configs drop column if exists concur_expense_type_mappings;
--   alter table published_versions drop column if exists concur_expense_type_mappings;
-- publish_company_draft()も、concur_expense_type_mappings列のselect/insert部分を
-- 削除した版へ差し替える必要がある（下の定義を参照）。
-- 今回はこれらのdrop/migrationを一切実行していない（既存公開済みデータを
-- 壊さないことを最優先するため）。
alter table draft_configs
  add column if not exists concur_expense_type_mappings jsonb not null default '[]'::jsonb;
alter table published_versions
  add column if not exists concur_expense_type_mappings jsonb not null default '[]'::jsonb;

comment on column draft_configs.concur_expense_type_mappings is
  '【非推奨・未使用】経費タイプID＝Concur EXP_KEYという設計への正式リファクタリング'
  '（管理画面「Concurマッピング」タブ・07_Concurマッピングシートを廃止）により、'
  'アプリ側はこの列を一切読み書きしない。旧データが残っている可能性はあるが、'
  '安全なdeploy順序に従い列自体は後日別migrationで削除予定（現時点では未適用）。';
comment on column published_versions.concur_expense_type_mappings is
  '【非推奨・未使用】draft_configs.concur_expense_type_mappingsと同じ理由により、'
  'publish_company_draft()がdraft_configsからそのままコピーするだけの列になった。'
  'config_snapshotにはもうこの内容は含まれない（config_snapshot.expenseTypes[].id'
  'がConcur側の識別子そのもの）。列自体は後日別migrationで削除予定（現時点では未適用）。';

-- ============================================================================
-- 12. Phase 12: Concur OAuth Refresh TokenのSupabase Vault保存
-- ============================================================================
--
-- 【重要・このPhaseだけ本番未適用】
-- schema.sqlの他の全Phaseとは異なり、このPhase 12は本番のSupabaseプロジェクトへ
-- まだ適用していません。適用にはsupabase/migrations/20260729115405_concur_
-- oauth_vault.sqlを使用してください（このPhaseの内容と同一）。適用前に必ず
-- レビューし、可能であれば一時的な検証環境で動作確認してください。
-- 設計の詳細・A/B/C比較・残存リスクはdocs/supabase-setup.md Step 19参照。
--
-- 目的：
--   Concur OAuth2「Refresh Token Grant」で使うRefresh Tokenを、Supabase
--   Secrets（環境変数、実行中のEdge Functionから更新不可）ではなく、Supabase
--   Vault（SQL関数から読み書きできる暗号化されたシークレットストア）へ保存する。
--   これにより、Concur側で新しいRefresh Tokenが発行された場合（ローテーション）、
--   Edge Function側でVaultへ自動的に書き戻せるようにする。
--
--   Refresh Token本体はconcur_oauth_connectionsへ保存しない（保存するのは
--   vault.secrets.idへの参照だけ）。Client ID/Secret/Token URLは引き続き
--   Supabase Secretsで管理し、このPhaseの対象外。
--
-- vault_secret_idについて（外部キー制約を付けない理由）：
--   vault.secretsは通常のテーブル（id uuid primary key default gen_random_uuid()）
--   だが、Vault拡張が管理する内部実装の一部であり、公式の利用インターフェースは
--   vault.create_secret()/vault.update_secret()/vault.decrypted_secretsに
--   限定されている。拡張の将来のバージョンアップでvault.secretsの構造が
--   変わった場合にアプリ側のFK制約が予期せず壊れるリスクを避けるため、
--   vault_secret_idは「不透明なUUID参照」として保持し、FK制約は付けない
--   （存在確認は各RPC内でvault.decrypted_secretsへの問い合わせ結果によって行う）。
--
-- 同時実行制御（lease_id）について：
--   status・lock_expires_atだけでは、「リース期限切れ後に別処理が新しい
--   リースを取得し、その後に古い処理が遅れて完了処理を実行すると、新しい
--   処理の結果を上書きしてしまう」という問題がある。リース取得のたびに
--   新しいlease_idを発行し、完了処理はconnection_id・lease_idの両方が現在の
--   リースと完全一致する場合だけ実行するようにして、この上書きを防ぐ。
--
-- updated_atについて：
--   このプロジェクトには既存のupdated_at自動更新トリガーが無く、各テーブルの
--   UPDATE文で毎回updated_at = now()を明示的に設定する方式のため、本Phaseの
--   テーブル・RPCも同じ方式を踏襲し、新しいトリガーは追加しない。
--
-- 含めていないもの（意図的）：
--   Refresh Token・Client Secretの実値、vault.create_secret()による実際の
--   シークレット登録（本Phase適用後の手作業とする）、Vault extensionの
--   有効化文（Supabaseホスティング環境では既定で有効なため。詳細は
--   supabase/migrations/20260729115405_concur_oauth_vault.sqlの該当コメント参照）。
create table if not exists concur_oauth_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  vault_secret_id uuid not null,
  status text not null default 'inactive'
    check (status in ('inactive', 'active', 'rotating', 'error')),
  lease_id uuid,
  lock_expires_at timestamptz,
  last_refreshed_at timestamptz,
  last_error_code text
    check (last_error_code is null or char_length(last_error_code) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- rotating中だけlease_id・lock_expires_atが非NULLになる不変条件をDB側でも
  -- 強制する（get_concur_refresh_token_for_edge()・complete_concur_oauth_
  -- refresh()の両方の遷移がこの条件を満たすことを確認済み）。
  check (
    (status = 'rotating' and lease_id is not null and lock_expires_at is not null)
    or
    (status <> 'rotating' and lease_id is null and lock_expires_at is null)
  )
);

comment on table concur_oauth_connections is
  'Concur OAuth接続ごとのメタデータ。Refresh Token本体は持たない。実体は'
  'vault.secretsにあり、vault_secret_idで参照する（FK制約は意図的に付けない。'
  '上記コメント参照）。';
comment on column concur_oauth_connections.company_id is
  '将来の複数会社対応用。現時点では単一の既定接続のためnullを許容する'
  '（下の部分unique indexで、company_idがnullの行は最大1件に制限）。';
comment on column concur_oauth_connections.vault_secret_id is
  'vault.secrets.idへの参照（外部キー制約なし）。呼び出し元（Edge Function）から'
  'この値を直接指定させることはせず、RPC内部でこの列に保存された値だけを使う。';
comment on column concur_oauth_connections.status is
  'inactive=明示的に無効化された接続。get_concur_refresh_token_for_edge()の'
  '取得対象外。active=通常利用可能で取得対象。rotating=ローテーション処理中の'
  '一時的なリース状態（期限切れの場合のみ再取得可能）。error=直近の疎通確認が'
  '失敗した状態だが、再試行のため取得対象に含む。新規接続行を登録する際、'
  '直ちに疎通確認可能にしたい場合はstatus=''active''で作成すること（デフォルト'
  '値''inactive''のままだと取得対象にならない）。';
comment on column concur_oauth_connections.lease_id is
  'get_concur_refresh_token_for_edge()がリースを獲得するたびに新しく発行する'
  'ランダムUUID。complete_concur_oauth_refresh()は、この列の現在値と呼び'
  '出し元が提示したp_lease_idが完全一致する場合だけ処理を実行する。';
comment on column concur_oauth_connections.lock_expires_at is
  'rotating状態のリース期限（30秒）。期限切れ後は他のリクエストが新しい'
  'lease_idでリースを奪える。';
comment on column concur_oauth_connections.last_error_code is
  '直近の疎通確認・完了処理で記録された内部エラーコードのみ（OAuthサーバーの'
  'error_description・生レスポンス・Token値は一切保存しない）。';

-- 会社ごとに1件、かつ「既定接続」(company_id is null)も全体で最大1件に制限する
-- （通常のunique(company_id)だけではNULL同士が区別されるため、部分unique index
-- 2本に分ける）。
create unique index if not exists concur_oauth_connections_company_id_key
  on concur_oauth_connections (company_id)
  where company_id is not null;
create unique index if not exists concur_oauth_connections_default_key
  on concur_oauth_connections ((true))
  where company_id is null;

alter table concur_oauth_connections enable row level security;
revoke all on concur_oauth_connections from anon, authenticated, public;
-- 意図的にRLSポリシーを1件も作らない：anon/authenticated（platform_admin本人の
-- 通常ログインセッションを含む）はこのテーブルへ一切アクセスできない。アクセスは
-- service_role権限のEdge Functionが、下記のSECURITY DEFINER RPC経由でのみ行う。

revoke all on vault.decrypted_secrets from anon, authenticated, public;
-- Vault拡張の既定権限がどうであっても明示的に再確認する（公式ドキュメントの
-- 「decrypted_secretsビューへのアクセスは適切なSQL権限で常に保護すること」への対応）。

-- RPC: 現在のRefresh Tokenを取得し、同時に新しいlease_idでローテーション用の
-- リースを獲得する（Edge Function専用。service_roleだけがEXECUTE可能）。
-- 【改訂】単一のUPDATE ... FROM vault.decrypted_secrets ... RETURNINGで、
-- 「接続行の選定」「Vault Secretの存在・非空確認」「status条件確認」
-- 「rotatingへの変更・lease_id発行」を原子的に行う。対応するVault Secretが
-- 存在しない・空文字・空白のみの場合は0行のまま完了し、接続行のstatus・
-- lease_id・lock_expires_atは一切変更されない（以前の実装は先にrotatingへ
-- UPDATEしてから後でVault Secretを確認していたため、Vault Secret不在時に
-- 接続行がrotatingのまま30秒ロックされる欠陥があった。詳細はsupabase/
-- migrations/20260729115405_concur_oauth_vault.sqlの該当コメント参照）。
-- 取得対象となるstatusはactive・error、またはrotatingかつlock_expires_at<now
-- の行のみで、inactiveの行は対象外（status列コメント参照）。
create or replace function get_concur_refresh_token_for_edge(
  p_company_id uuid default null
)
returns table (connection_id uuid, lease_id uuid, refresh_token text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lease_id uuid := gen_random_uuid();
begin
  return query
    update concur_oauth_connections c
      set status = 'rotating',
          lease_id = v_lease_id,
          lock_expires_at = now() + interval '30 seconds',
          updated_at = now()
      from vault.decrypted_secrets vs
      where vs.id = c.vault_secret_id
        and vs.decrypted_secret is not null
        and trim(vs.decrypted_secret) <> ''
        and (
          (p_company_id is null and c.company_id is null)
          or c.company_id = p_company_id
        )
        and (
          c.status = 'active'
          or c.status = 'error'
          or (c.status = 'rotating' and c.lock_expires_at < now())
        )
      returning c.id as connection_id, c.lease_id as lease_id, vs.decrypted_secret as refresh_token;
end;
$$;

revoke all on function get_concur_refresh_token_for_edge(uuid) from public, anon, authenticated;
grant execute on function get_concur_refresh_token_for_edge(uuid) to service_role;

comment on function get_concur_refresh_token_for_edge(uuid) is
  'Edge Function専用（service_roleのみEXECUTE可）。指定した会社（またはNULLで'
  '既定接続）の現在のRefresh Tokenを復号して返すと同時に、新しいlease_idで'
  'ローテーション用のリースを獲得する。取得対象はstatus=active・error、または'
  'status=rotatingかつlock_expires_at<nowの行のみで、inactiveの行は対象外。'
  '対応するVault Secretが存在しない・空文字・空白のみの場合も対象外（この'
  '場合は接続行が一切変更されない）。ロック中・接続なし・Vault Secret不在の'
  'いずれも0行を返す（理由は区別しない）。呼び出し元は成功・失敗いずれの'
  '場合も必ずcomplete_concur_oauth_refresh()を呼び、リースを解放すること。';

-- RPC: ローテーション結果を確定し、リースを解放する。connection_id・lease_id
-- の両方が現在のリースと完全一致する場合だけ実行する。
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
  select vault_secret_id into v_vault_secret_id
    from concur_oauth_connections
    where id = p_connection_id
      and lease_id = p_lease_id
      and status = 'rotating'
      and lock_expires_at is not null
    for update;

  if v_vault_secret_id is null then
    return false;
  end if;

  if p_success then
    if p_new_refresh_token is not null and length(p_new_refresh_token) > 0 then
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
  'Edge Function専用（service_roleのみEXECUTE可）。lease_idが完全一致する場合'
  'だけリースを解放する。p_success=trueかつp_new_refresh_tokenが非null・'
  '非空文字の場合のみvault.update_secret()でRefresh Tokenを更新する。'
  'p_success=falseの場合はToken値を受け取らずlast_error_codeだけを記録する。'
  'lease_id不一致はfalseを返すだけで例外・状態変更を起こさない。Vault更新と'
  'メタデータ更新は同一トランザクション内。';

-- ============================================================================
-- ここまででPhase 9・10・11・12のスキーマも完成です。
--
-- 最初のplatform_admin登録について：
--   platform_adminsへのINSERTは、company_membersの最初のadmin登録と同様、
--   運営者がSupabaseダッシュボード/SQL Editorから手動で行うBootstrap方式である
--   （アプリからplatform_adminへ自己昇格・他者昇格できる経路は一切無い）。
--   具体的な手順は完了報告・docs/supabase-setup.md参照。
--
-- まだ実装していないもの（後続Phaseで対応、または今回スコープ外）：
--   ・通常adminへの招待コード再発行権限の付与（今回はplatform_admin限定。
--     完了報告で比較・理由を報告する）
--   ・platform_adminsの一覧・追加・削除を管理画面から行うUI（Bootstrap方式の
--     ままSQL Editorから運営者が行う運用）
--   ・company_membersのユーザー「非有効化」（is_active等のフラグ列を追加した
--     一時停止）は今回もスコープ外。Phase 9で追加したのは「会社から削除」
--     （remove_company_member()、role変更と同じ設計での物理削除）のみ。
--   ・list_public_companies() / get_public_config(text) のanon EXECUTE剥奪
--     （本番の認証UI稼働確認が済んでから、別途「段階移行」として実施する。
--     本節では両関数への既存のanon権限には一切手を加えていない）
--   ・過去バージョンへのロールバック（current_published_version_idを
--     過去のpublished_versions.idへ切り替えるだけで実現できる構造にはなっている）
--   ・複数人同時編集の考慮
--   ・get_public_config / list_public_companiesの呼び出し頻度制限・キャッシュ
--   ・Concur Expense Type mapping（Phase 11）を管理画面から編集するCRUD UI、
--     Excelからの取り込み、実際のConcur API送信（いずれも後続Commitでスコープ外）
--   ・Phase 12（Concur OAuth Vault連携）は本番未適用。適用は
--     supabase/migrations/20260729115405_concur_oauth_vault.sqlで行う想定
--     （このファイル自体はまだ`supabase db push`していない）。
--     check-concur-oauthのコード自体は既にこのPhaseのRPC呼び出しへ対応済み
--     だが、migration未適用のためRPC自体が存在せず、実際には呼び出せない。
--     適用後、Vaultへの実Refresh Token登録（手作業）・
--     CONCUR_OAUTH_CHECK_ENABLEDの有効化を検討する
--
-- 「下書き変更履歴（draft_config_versions・save_draft_with_history・
-- restore_draft_version）」は一度Phase 5として実装したが、オーバースペックと
-- 判断し撤去した。「保存前の状態に戻す」機能はdraft_configsのみを使う設計の
-- ため、履歴テーブルへの依存はなく撤去の影響を受けていない。
-- ============================================================================
