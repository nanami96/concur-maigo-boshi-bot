-- ============================================================================
-- 【未適用】Concurログイン ID の user_id × company_id 単位での紐付け保存（Phase 13）
-- ============================================================================
-- このファイルはsupabase/schema.sqlの「13. Phase 13」節と同一内容です
-- （tests/schemaSqlConcurUserLinks.test.jsで両ファイルの本文一致を確認）。
--
-- 重要：このファイルは本番Supabaseプロジェクトへまだ適用していません
-- （`supabase db push`等は実行していません）。適用前に必ずレビューし、
-- 可能であれば一時的な検証環境で動作確認してから、本番へ適用してください。
--
-- 適用対象：
--   1. 新規テーブル concur_user_links（RLS有効・ポリシーなし・grantなし）
--   2. 新規RPC get_my_concur_link_status(text)（authenticated）
--   3. 新規RPC unlink_my_concur_user(text)（authenticated）
--   4. 新規RPC save_concur_user_link(uuid, uuid, text)（service_role専用）
--   5. 新規RPC get_concur_user_link_for_edge(uuid, uuid)（service_role専用）
--   6. 既存関数 remove_company_member(uuid) の置き換え（company_members削除時に
--      対応するconcur_user_links行も同一トランザクション内で削除するよう変更）
--
-- 含めていないもの（意図的）：
--   - Concur Identity User ID（Concur内部のUUID）を保存する列・機能
--     （既存方針どおり保存しない。concur_login_id列にはログインIDの文字列のみ）
--   - concur_user_linksへの直接SELECT/INSERT/UPDATE/DELETE用RLSポリシー
--     （concur_oauth_connectionsと同じ「RPC経由のみ」の設計。詳細はschema.sql
--     Phase 13節のコメント参照）
--   - CONCUR_USER_LINK_ENABLEDの有効化（Secrets登録は本migration適用後、
--     別途手作業で行う）
--
-- 冪等性：本ファイルは`if not exists`・`create or replace`・`revoke`/`grant`
-- （すべて再実行しても同じ最終状態になる）で構成しており、複数回適用しても
-- 安全です。

-- ----------------------------------------------------------------------------
-- 1. remove_company_member(uuid) の置き換え（cleanup追加）
-- ----------------------------------------------------------------------------
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

  if v_target.user_id = auth.uid() then
    raise exception 'cannot remove yourself from the company' using errcode = '42501';
  end if;

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

  -- 【Phase 13で追加】company_membersから削除された(user_id, company_id)の
  -- 組み合わせに対応するConcurログインID紐付け（concur_user_links）も、
  -- 同じトランザクション内で削除する。詳細はschema.sqlの同関数コメント参照。
  delete from concur_user_links
  where user_id = v_target.user_id
    and company_id = v_target.company_id;

  return v_result;
end;
$$;

comment on function remove_company_member(uuid) is
  '呼び出し元がその会社のadmin、またはplatform_adminの場合のみ、対象のcompany_members'
  '行（会社所属）を削除する。auth.users・platform_admins等、company_members以外の'
  'テーブルは一切変更しない。呼び出し元自身の行、および最後のadminの行は削除できない。'
  '【Phase 13で追加】削除された(user_id, company_id)に対応するconcur_user_links行'
  '（ConcurログインID紐付け）も同一トランザクション内で削除する。';

revoke all on function remove_company_member(uuid) from public;
grant execute on function remove_company_member(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. concur_user_links テーブル
-- ----------------------------------------------------------------------------
create table if not exists concur_user_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  concur_login_id text not null
    check (char_length(concur_login_id) between 1 and 320),
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, company_id)
);

comment on table concur_user_links is
  'Supabase user_id × company_id単位でのConcurログインID紐付け。Identity API'
  '（GET /profile/identity/v4/Users）でfound=true・hasUserId=true・'
  'multipleMatches=falseを確認できたログインIDだけを保存する（link-concur-user'
  'Edge Function経由）。Concur内部のUser ID（UUID）は保存しない。';
comment on column concur_user_links.concur_login_id is
  'Identity APIで実在確認済みのConcurログインID（例：メールアドレス）のみ。'
  '未検証の文字列を保存する経路は無い（save_concur_user_linkはservice_role'
  '専用で、呼び出し元のlink-concur-user Edge Functionが確認済みの値だけを渡す）。';
comment on column concur_user_links.verified_at is
  'Identity APIによる実在確認に成功した時刻（link-concur-user側でnow()を設定）。';

create index if not exists idx_concur_user_links_user_id on concur_user_links (user_id);

alter table concur_user_links enable row level security;
revoke all on concur_user_links from anon, authenticated, public;
-- 意図的にRLSポリシーを1件も作らない（concur_oauth_connectionsと同じ設計。
-- 詳細はschema.sqlのPhase 13節コメント参照）。

-- ----------------------------------------------------------------------------
-- 3. RPC: get_my_concur_link_status(text) — authenticated
-- ----------------------------------------------------------------------------
create or replace function get_my_concur_link_status(p_company_code text)
returns table (has_link boolean, verified_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select
    (cul.id is not null) as has_link,
    cul.verified_at
  from companies c
  join company_members cm
    on cm.company_id = c.id
   and cm.user_id = auth.uid()
  left join concur_user_links cul
    on cul.company_id = c.id
   and cul.user_id = auth.uid()
  where c.company_code = p_company_code;
$$;

revoke all on function get_my_concur_link_status(text) from public;
grant execute on function get_my_concur_link_status(text) to authenticated;

comment on function get_my_concur_link_status(text) is
  'ログイン中ユーザー(auth.uid())自身の、指定した会社（company_code）に対する'
  'ConcurログインID紐付けの有無（has_link）とverified_atだけを返す。'
  'concur_login_id自体は一切返さない。対象会社へ所属していなければ0行'
  '（fail-closed）。他ユーザーの紐付けは一切参照できない。';

-- ----------------------------------------------------------------------------
-- 4. RPC: unlink_my_concur_user(text) — authenticated
-- ----------------------------------------------------------------------------
create or replace function unlink_my_concur_user(p_company_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_deleted_count int;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select c.id into v_company_id
  from companies c
  join company_members cm
    on cm.company_id = c.id
   and cm.user_id = auth.uid()
  where c.company_code = p_company_code;

  if v_company_id is null then
    return false;
  end if;

  delete from concur_user_links
  where user_id = auth.uid()
    and company_id = v_company_id;

  get diagnostics v_deleted_count = row_count;
  return v_deleted_count > 0;
end;
$$;

revoke all on function unlink_my_concur_user(text) from public;
grant execute on function unlink_my_concur_user(text) to authenticated;

comment on function unlink_my_concur_user(text) is
  'ログイン中ユーザー(auth.uid())本人の、指定した会社（company_code）に対する'
  'concur_user_links行だけを削除する。他ユーザーの行・他社の行は対象にならない。'
  '対象会社へ所属していない、または紐付けが無い場合はfalseを返す（例外にしない）。';

-- ----------------------------------------------------------------------------
-- 5. RPC: save_concur_user_link(uuid, uuid, text) — service_role専用
-- ----------------------------------------------------------------------------
create or replace function save_concur_user_link(
  p_user_id uuid,
  p_company_id uuid,
  p_concur_login_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into concur_user_links (user_id, company_id, concur_login_id, verified_at)
  values (p_user_id, p_company_id, p_concur_login_id, now())
  on conflict (user_id, company_id)
  do update set
    concur_login_id = excluded.concur_login_id,
    verified_at = excluded.verified_at,
    updated_at = now();
end;
$$;

revoke all on function save_concur_user_link(uuid, uuid, text) from public, anon, authenticated;
grant execute on function save_concur_user_link(uuid, uuid, text) to service_role;

comment on function save_concur_user_link(uuid, uuid, text) is
  'Edge Function専用（service_roleのみEXECUTE可）。link-concur-userがIdentity API'
  'でfound=true・hasUserId=true・multipleMatches=falseを確認した場合だけ呼び出す。'
  '未検証の値を保存する経路はこの関数の外には無い。(user_id, company_id)が'
  '既存なら上書き（ログインIDの変更に対応）、無ければ新規作成する。';

-- ----------------------------------------------------------------------------
-- 6. RPC: get_concur_user_link_for_edge(uuid, uuid) — service_role専用
-- ----------------------------------------------------------------------------
create or replace function get_concur_user_link_for_edge(
  p_user_id uuid,
  p_company_id uuid
)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select concur_login_id
  from concur_user_links
  where user_id = p_user_id
    and company_id = p_company_id;
$$;

revoke all on function get_concur_user_link_for_edge(uuid, uuid) from public, anon, authenticated;
grant execute on function get_concur_user_link_for_edge(uuid, uuid) to service_role;

comment on function get_concur_user_link_for_edge(uuid, uuid) is
  'Edge Function専用（service_roleのみEXECUTE可）。create-concur-quick-expenseが'
  '保存済みのConcurログインIDを取得するためだけに使う。該当行が無ければNULL'
  '（未紐付け。呼び出し元はfail-closedで扱い、既定接続的なフォールバックは'
  '行わない）。';
