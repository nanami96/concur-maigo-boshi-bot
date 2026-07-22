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

-- gen_random_uuid() を使うための拡張機能。Supabaseでは通常デフォルトで有効だが、
-- 念のため明示しておく（既に有効な場合は何も起きない）。
create extension if not exists pgcrypto;

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

-- 会社ごとの管理者。誰がどの会社を編集できるかを表す唯一のテーブル。
-- 将来「1社に複数管理者」「1管理者が複数社を兼務」のどちらにも対応できる形にしてある。
create table if not exists company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'admin',
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);

comment on column company_members.role is
  '現時点では admin のみ運用。将来 viewer 等の役割を追加する余地を残してある。';

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
-- 所属している会社だけ閲覧・更新できる。
drop policy if exists companies_select_member on companies;
create policy companies_select_member
  on companies
  for select
  to authenticated
  using (
    exists (
      select 1
      from company_members
      where company_members.company_id = companies.id
        and company_members.user_id = auth.uid()
    )
  );

drop policy if exists companies_update_member on companies;
create policy companies_update_member
  on companies
  for update
  to authenticated
  using (
    exists (
      select 1
      from company_members
      where company_members.company_id = companies.id
        and company_members.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from company_members
      where company_members.company_id = companies.id
        and company_members.user_id = auth.uid()
    )
  );

-- INSERT/DELETEのポリシーは意図的に作らない。会社の新規作成・削除は
-- 今回のPhaseの対象外（現状はダッシュボード/SQL Editorから行う）。

-- --- draft_configs -------------------------------------------------------------
-- 所属会社の下書きだけ読み書きできる。所属していない会社の下書きは
-- 存在自体も含めて一切見えない。
drop policy if exists draft_configs_select_member on draft_configs;
create policy draft_configs_select_member
  on draft_configs
  for select
  to authenticated
  using (
    exists (
      select 1
      from company_members
      where company_members.company_id = draft_configs.company_id
        and company_members.user_id = auth.uid()
    )
  );

drop policy if exists draft_configs_insert_member on draft_configs;
create policy draft_configs_insert_member
  on draft_configs
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from company_members
      where company_members.company_id = draft_configs.company_id
        and company_members.user_id = auth.uid()
    )
  );

drop policy if exists draft_configs_update_member on draft_configs;
create policy draft_configs_update_member
  on draft_configs
  for update
  to authenticated
  using (
    exists (
      select 1
      from company_members
      where company_members.company_id = draft_configs.company_id
        and company_members.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from company_members
      where company_members.company_id = draft_configs.company_id
        and company_members.user_id = auth.uid()
    )
  );

drop policy if exists draft_configs_delete_member on draft_configs;
create policy draft_configs_delete_member
  on draft_configs
  for delete
  to authenticated
  using (
    exists (
      select 1
      from company_members
      where company_members.company_id = draft_configs.company_id
        and company_members.user_id = auth.uid()
    )
  );

-- --- published_versions --------------------------------------------------------
-- 所属会社の公開履歴だけ閲覧・追記できる。UPDATE/DELETEのポリシーは
-- 意図的に作らない（公開履歴は追記専用＝一度書いたら変更・削除されない設計のため）。
drop policy if exists published_versions_select_member on published_versions;
create policy published_versions_select_member
  on published_versions
  for select
  to authenticated
  using (
    exists (
      select 1
      from company_members
      where company_members.company_id = published_versions.company_id
        and company_members.user_id = auth.uid()
    )
  );

drop policy if exists published_versions_insert_member on published_versions;
create policy published_versions_insert_member
  on published_versions
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from company_members
      where company_members.company_id = published_versions.company_id
        and company_members.user_id = auth.uid()
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
--   ・関数内で明示的に「auth.uid()がp_company_idのcompany_membersに
--     含まれるか」を検証する（RLSも独立して同じ制約を課すため二重防御になる）。
--   ・EXECUTE権限はauthenticatedのみに付与し、anonからは呼び出せない。

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

  if not exists (
    select 1
    from company_members
    where company_members.company_id = p_company_id
      and company_members.user_id = auth.uid()
  ) then
    raise exception 'not a member of this company' using errcode = '42501';
  end if;

  select * into v_draft from draft_configs where draft_configs.company_id = p_company_id;

  if not found then
    raise exception 'no draft found for this company' using errcode = 'P0002';
  end if;

  insert into published_versions (
    company_id, company_settings, policies, expense_types, flow, config_snapshot, published_by
  )
  values (
    p_company_id, v_draft.company_settings, v_draft.policies, v_draft.expense_types, v_draft.flow,
    p_config_snapshot, auth.uid()
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
-- ここまででPhase 6のスキーマも完成です。
--
-- まだ実装していないもの（後続Phaseで対応）：
--   ・過去バージョンへのロールバック（current_published_version_idを
--     過去のpublished_versions.idへ切り替えるだけで実現できる構造にはなっている）
--   ・複数人同時編集の考慮
--   ・get_public_config / list_public_companiesの呼び出し頻度制限・キャッシュ
--   ・顧客によるセルフサービスの会社登録（companiesへのINSERTは引き続き
--     authenticatedへ付与しない。会社の新規登録はSupabase側の作業者が
--     SQL Editor等から行う運用のまま）
--
-- 「下書き変更履歴（draft_config_versions・save_draft_with_history・
-- restore_draft_version）」は一度Phase 5として実装したが、オーバースペックと
-- 判断し撤去した。「保存前の状態に戻す」機能はdraft_configsのみを使う設計の
-- ため、履歴テーブルへの依存はなく撤去の影響を受けていない。
-- ============================================================================
