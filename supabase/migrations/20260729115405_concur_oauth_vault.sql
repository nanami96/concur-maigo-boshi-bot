-- ============================================================================
-- 【未適用】Concur Refresh TokenのSupabase Vault保存（Phase 12）
-- ============================================================================
-- このファイルはこのプロジェクトで最初のsupabase/migrations/配下のファイルです。
-- これまでこのプロジェクトはsupabase/schema.sqlをSQL Editorへ直接貼り付けて
-- 適用する方式を採っており（supabase/config.toml冒頭コメント参照）、CLIの
-- `supabase migration new`によるmigrationディレクトリは存在しませんでした。
-- 本ファイルは、Supabase CLIの標準命名規則（<タイムスタンプ>_<説明>.sql）に
-- 従って新規に作成した、このプロジェクト最初のmigrationファイルです。
--
-- 設計はdocs/supabase-setup.md Step 19（commit e4e0419で確定・その後lease_id
-- 対応へ改訂）を実装可能な形に落とし込んだものです。
--
-- 重要：このファイルは本番Supabaseプロジェクトへまだ適用していません
-- （`supabase db push`等は実行していません）。適用前に必ずレビューし、
-- 可能であれば一時的な検証環境で動作確認してから、本番へ適用してください。
--
-- 重要：supabase/migrations/配下にはこのファイル1件だけが存在し、他には
-- ありません。適用前に`supabase migration list`等でリモート側のmigration
-- 適用履歴（このプロジェクトはこれまでCLI migrationを使っていないため、
-- 履歴が空である可能性が高い）とschema.sqlの実際の状態が矛盾しないかを
-- 必ず確認してください（詳細はdocs/supabase-setup.md Step 19
-- 「Migration履歴に関する注意」参照）。
--
-- 含めていないもの（意図的）：
--   - Refresh Token・Client Secretの実値
--   - vault.create_secret()による実際のシークレット登録
--     （登録は本migration適用後の手作業とする。docs/supabase-setup.md参照）
--   - 既存テーブルへのDROP COLUMN等、破壊的な変更
--
-- 冪等性：本ファイルは`if not exists`・`create or replace`・`revoke`/`grant`
-- （すべて再実行しても同じ最終状態になる）で構成しており、複数回適用しても
-- 安全です。

-- ----------------------------------------------------------------------------
-- 1. Vault extensionについて（検討結果：本migrationでは有効化文を実行しない）
-- ----------------------------------------------------------------------------
-- 公式ドキュメント（https://supabase.com/docs/guides/database/vault、
-- https://github.com/supabase/vault/blob/main/README.md）によれば、
-- 「Vault拡張はSupabaseホスティング環境では既定で有効」であり、セルフホスト等の
-- 場合のみ `create extension supabase_vault cascade;` で有効化するとされています。
--
-- このプロジェクトの実際のリンク先Supabaseプロジェクトは通常のSupabase
-- ホスティング環境（無料/Pro等のクラウドプロジェクト）であり、セルフホストでは
-- ないため、`create extension`文は本migrationには含めません。
--
-- 含めなかった理由（推測で追加しなかった理由）：
--   (a) 公式ドキュメント上、ホスティング環境では既定で有効であることが
--       明記されており、追加の有効化操作自体が不要と判断できる。
--   (b) `create extension if not exists ...` は冪等ではあるものの、
--       拡張の有効化にはSQL Editorの実行ロールの権限次第で成否が変わりうる
--       （このセッションでは実際のロール・権限を確認していない）。不要な
--       操作を含めることで、意図しない権限エラーによりmigration全体が
--       失敗するリスクを増やしたくない。
--
-- もし実際に適用する環境がセルフホスト、またはVaultが無効な特殊環境で
-- あることが判明した場合は、この節を以下のように有効化した上で、
-- 拡張の有効化権限を持つロールで実行してください（今回は未検証・未適用）。
--
-- create extension if not exists supabase_vault cascade;

-- ----------------------------------------------------------------------------
-- 2. メタデータテーブル（Refresh Token本体・平文は一切持たない）
-- ----------------------------------------------------------------------------
-- vault_secret_idについて（検討結果：外部キー制約は付けない）：
-- vault.secretsは通常のテーブル（id uuid primary key default gen_random_uuid()）
-- であり、技術的にはFKを張ることは可能である
-- （https://github.com/supabase/vault/blob/main/sql/supabase_vault--0.3.0.sql
-- で実際のCREATE TABLE文を確認済み）。しかし、
--   (a) vault.secretsはVault拡張が管理する内部実装の一部であり、公式の
--       利用インターフェースはvault.create_secret()/vault.update_secret()/
--       vault.decrypted_secretsに限定されている（直接のDML・外部制約は
--       想定された使い方ではない）。
--   (b) 拡張の将来のバージョンアップ（Supabaseプラットフォームが管理する）で
--       vault.secretsの構造が変わった場合、アプリ側のFK制約が予期せず
--       壊れるリスクがある。
-- という理由から、vault_secret_idは「不透明なUUID参照」として保持し、
-- FK制約は付けない。存在確認は各RPC内でvault.decrypted_secretsへの
-- 問い合わせ結果（0行かどうか）によって行う。
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
  -- rotating中だけlease_id・lock_expires_atが非NULLになる、という不変条件を
  -- DB側でも強制する（get_concur_refresh_token_for_edge()・
  -- complete_concur_oauth_refresh()の両方の遷移がこの条件を満たすことを確認
  -- 済み。既定値'inactive'・lease_id無し・lock_expires_at無しの初期状態も含め、
  -- 矛盾する遷移は存在しない）。
  check (
    (status = 'rotating' and lease_id is not null and lock_expires_at is not null)
    or
    (status <> 'rotating' and lease_id is null and lock_expires_at is null)
  )
);

comment on table concur_oauth_connections is
  'Concur OAuth接続ごとのメタデータ。Refresh Token本体は持たない。実体は'
  'vault.secretsにあり、vault_secret_idで参照する（FK制約は意図的に付けない。'
  '本ファイル冒頭のコメント参照）。';
comment on column concur_oauth_connections.company_id is
  '将来の複数会社対応用。現時点では単一の既定接続のためnullを許容する'
  '（下の部分unique indexで、company_idがnullの行は最大1件に制限）。'
  'public.companies.idと同じuuid型（supabase/schema.sqlのcompanies定義を'
  '確認済み）。';
comment on column concur_oauth_connections.vault_secret_id is
  'vault.secrets.idへの参照（外部キー制約なし。本ファイル冒頭コメント参照）。'
  '呼び出し元（Edge Function）からこの値を直接指定させることはせず、RPC内部で'
  'この列に保存された値だけを使う。';
comment on column concur_oauth_connections.status is
  'inactive=明示的に無効化された接続。get_concur_refresh_token_for_edge()の'
  '取得対象外（意図的に取得不可にしている状態）。active=通常利用可能で取得'
  '対象。rotating=ローテーション処理中の一時的なリース状態（期限切れの場合の'
  'み再取得可能）。error=直近の疎通確認が失敗した状態だが、再試行のため取得'
  '対象に含む。新規接続行を登録する際、直ちに疎通確認可能にしたい場合は'
  'status=''active''で作成すること（docs/supabase-setup.md Step 19参照。'
  'デフォルト値''inactive''のままだと取得対象にならない）。';
comment on column concur_oauth_connections.lease_id is
  'get_concur_refresh_token_for_edge()がリースを獲得するたびに新しく発行する'
  'ランダムUUID。complete_concur_oauth_refresh()は、この列の現在値と呼び'
  '出し元が提示したp_lease_idが完全一致する場合だけ処理を実行する（同時実行時の'
  '二重ローテーション・古い処理による上書きを防ぐ）。';
comment on column concur_oauth_connections.lock_expires_at is
  'rotating状態のリース期限。Edge Function側の異常終了時にリースが永久に'
  '残らないよう、期限切れ後は他のリクエストが新しいlease_idでリースを'
  '奪えるようにする（30秒。get_concur_refresh_token_for_edge()参照）。';
comment on column concur_oauth_connections.last_error_code is
  '直近の疎通確認・完了処理で記録された内部エラーコードのみ（OAuthサーバーの'
  'error_description・生レスポンス・Token値は一切保存しない）。';

-- 3. unique index：会社ごとに1件、かつ「既定接続」(company_id is null)も
--    全体で最大1件に制限する。
--    通常のunique(company_id)制約だけでは、PostgreSQLはNULL同士を「異なる値」
--    として扱うため、company_id is null の行を何件登録しても制約違反になら
--    ない。そのため、company_id is not null の行専用と、company_id is null
--    の行専用（定数式(true)へのunique index、という一般的なテクニック）の
--    2本の部分unique indexへ分けて、それぞれ独立に「最大1件」を強制する。
create unique index if not exists concur_oauth_connections_company_id_key
  on concur_oauth_connections (company_id)
  where company_id is not null;
create unique index if not exists concur_oauth_connections_default_key
  on concur_oauth_connections ((true))
  where company_id is null;

-- 4. RLS・権限
--    updated_atについて：このプロジェクトのsupabase/schema.sqlには既存の
--    updated_at自動更新トリガーが存在しない（各テーブルのUPDATE文で毎回
--    updated_at = now()を明示的に設定する方式。事前に確認済み）。既存設計との
--    整合性を優先し、本テーブル・本RPCも同じ方式（トリガーを新設せず、各
--    UPDATE文でupdated_at = now()を明示する）を踏襲する。
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

-- ----------------------------------------------------------------------------
-- 5. RPC: 現在のRefresh Tokenを取得し、同時にローテーション用のリースを
--    新しいlease_idで獲得する（Edge Function専用。service_roleだけがEXECUTE
--    可能）。
--
--    【重要・改訂】以前の実装は(a)先にstatus='rotating'へUPDATEし、(b)その後
--    vault.decrypted_secretsをSELECTする、という2段階の処理だった。この順序
--    では、対応するVault Secretが存在しない・空文字・復号できない場合でも
--    (a)の時点で接続行が既にrotatingへ更新済みとなり、lock_expires_atの
--    期限（30秒）が切れるまで他のリクエストがその接続を一切取得できなく
--    なる欠陥があった。
--
--    今回、単一のUPDATE ... FROM vault.decrypted_secrets ... RETURNINGへ
--    書き直し、「接続行の選定」「Vault Secretの存在確認」「復号値が空文字
--    でないことの確認」「status条件の確認」「status='rotating'への変更・
--    lease_id発行・lock_expires_at設定」を1つの原子的な操作として行う。
--    Vault Secretが存在しない・decrypted_secretがnull・trim後に空文字の
--    場合は、FROM句のJOIN条件（WHERE句内のvs.decrypted_secret関連の条件）
--    自体が満たされないため、UPDATEは対象0行のまま終わり、
--    concur_oauth_connections側の行は一切変更されない（status・lease_id・
--    lock_expires_atのいずれも変わらない）。
--
--    同時実行時も、Postgresの行ロックにより片方だけがこのUPDATEに成功し、
--    もう片方は0行を受け取る（Tokenを同時に2件が取得することはない）。
--
--    取得対象となるstatus（意味の確定。上記status列のコメントも参照）：
--      - active（通常利用可能）
--      - error（前回失敗。再試行可能）
--      - rotating かつ lock_expires_at < now()（リース期限切れ後の再取得）
--    inactive（明示的に無効化された接続）は取得対象に含めない。
-- ----------------------------------------------------------------------------
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
  -- 対象接続が存在しない、対応するVault Secretが存在しない/空/空白のみ、
  -- status条件を満たさない（inactive、またはロック中で期限内のrotating）の
  -- いずれの場合も、上のUPDATEは0行のまま完了し、呼び出し元へは0行を返す
  -- （理由は区別しない。呼び出し元はconcur_oauth_not_connected等、単一の
  -- 安全なコードへまとめる）。期限切れ後の再取得では、WHERE句の
  -- 「c.lock_expires_at < now()」が真になるため通常どおりUPDATEが成功し、
  -- v_lease_id（今回新しく生成した値）へ差し替わる＝再取得のたびに
  -- lease_idが変わる。
end;
$$;

revoke all on function get_concur_refresh_token_for_edge(uuid) from public, anon, authenticated;
grant execute on function get_concur_refresh_token_for_edge(uuid) to service_role;

comment on function get_concur_refresh_token_for_edge(uuid) is
  'Edge Function専用（service_roleのみEXECUTE可）。指定した会社（またはNULLで'
  '既定接続）の現在のRefresh Tokenを復号して返すと同時に、新しいlease_idで'
  'ローテーション用のリース（status=rotating、30秒）を獲得する。取得対象は'
  'status=active・error、またはstatus=rotatingかつlock_expires_at<nowの行の'
  'みで、inactiveの行は対象外。対応するVault Secretが存在しない・空文字・'
  '空白のみの場合も対象外（単一のUPDATE ... FROM ... RETURNINGで判定する'
  'ため、この場合は接続行のstatus・lease_id・lock_expires_atのいずれも変更'
  'されない）。ロック中・接続なし・Vault Secret不在のいずれも0行を返す（理由は'
  '区別しない）。呼び出し元はconnection_id・lease_idを保持し、成功・失敗いずれの'
  '場合も必ずcomplete_concur_oauth_refresh()へその両方を渡してリースを'
  '解放すること。Token値をRAISE・NOTICE・ログへ出さないこと。';

-- ----------------------------------------------------------------------------
-- 6. RPC: ローテーション結果を確定し、リースを解放する。
--    p_connection_id・p_lease_idの両方が現在のリースと完全一致する場合だけ
--    実行する。古いlease_id・別connectionのlease_id流用・既に解放済み
--    （二重実行）のいずれも「対象0件」として安全に失敗し、falseを返すだけで、
--    現在のToken・status・（他のリクエストが獲得した）新しいリースへは
--    一切触れない。
-- ----------------------------------------------------------------------------
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
    if p_new_refresh_token is not null and length(p_new_refresh_token) > 0 then
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
  'trueかつp_new_refresh_tokenが非null・非空文字の場合のみvault.update_secret()'
  'で実際にRefresh Tokenを更新する（rotated:falseの場合はp_new_refresh_token'
  'をnullのまま呼び、リースの解放とlast_refreshed_at更新だけを行う）。'
  'p_success=falseの場合はToken値を一切受け取らず、last_error_codeだけを'
  '記録する。lease_id不一致（古いlease_id・他のconnection_idへの流用・'
  '二重実行）はfalseを返すだけで、例外・状態変更のいずれも起こさない。'
  'Vault更新（vault.update_secret）とメタデータ更新は同一トランザクション内。';

-- ----------------------------------------------------------------------------
-- 7. RPC: create-concur-quick-expense専用・Concur OAuth Vault接続の会社境界
--    解決（company_members/companiesから直接解決。concur_oauth_connections
--    自体には依存しないため、このRPC単体は本migrationが未適用でも動作しうるが、
--    用途上Phase 12と一体で扱う）。
--
-- 【設計レビューの結論・追記】当初はget_my_public_config(p_company_code)
-- （supabase/schema.sql Phase 7、既に本番適用済みの利用者向けRPC）の戻り値へ
-- company_id列を追加する案を検討したが、(a)利用者向けRPCにEdge Function
-- 内部専用の値を持ち込むべきではない、(b)既存のlist_my_companies()が
-- company UUIDを意図的に含めない最小metadata設計を採っており矛盾する、
-- (c)get_concur_refresh_token_for_edge・complete_concur_oauth_refreshと同じ
-- service_role専用RPCとして分離すれば、company UUIDをブラウザへ一切返さずに
-- 解決できる、という理由から採用しなかった。詳細はsupabase/schema.sqlの
-- 同名関数の直前コメント参照（本ファイルとschema.sqlのこのRPC本体は一致させる
-- こと。tests/schemaSqlConcurOAuthVault.test.js参照）。
create or replace function resolve_concur_oauth_company_id(
  p_user_id uuid,
  p_company_code text
)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select c.id
  from company_members cm
  join companies c on c.id = cm.company_id
  where cm.user_id = p_user_id
    and c.company_code = p_company_code;
$$;

revoke all on function resolve_concur_oauth_company_id(uuid, text) from public, anon, authenticated;
grant execute on function resolve_concur_oauth_company_id(uuid, text) to service_role;

comment on function resolve_concur_oauth_company_id(uuid, text) is
  'Edge Function専用（service_roleのみEXECUTE可）。p_user_id（呼び出し元が'
  '既にauth.getUser()等で検証済みのユーザーID）がp_company_codeで指定された'
  '会社へ実際に所属している場合だけ、その会社のcompanies.id（Supabase内部'
  'UUID）を返す。未所属・存在しない会社はNULLを返す（先頭行の自動選択は行わ'
  'ない。company_code完全一致のみで解決するため複数社所属でも一意に決まる）。'
  'auth.uid()は使わない（service_role呼び出しにはJWTコンテキストが無いため）。'
  'create-concur-quick-expenseがConcur OAuth Vault接続'
  '（concur_oauth_connections.company_id）の会社境界解決にのみ使う。';

-- ----------------------------------------------------------------------------
-- rollback（未適用・案。実行が必要になった場合にこのブロックだけを使う）
-- ----------------------------------------------------------------------------
-- drop function if exists resolve_concur_oauth_company_id(uuid, text);
-- drop function if exists complete_concur_oauth_refresh(uuid, uuid, boolean, text, text);
-- drop function if exists get_concur_refresh_token_for_edge(uuid);
-- drop table if exists concur_oauth_connections;
-- -- vault.secrets内の実際のシークレット行は、このrollbackでは削除しない
-- -- （ロールバックは「メタデータ層の後始末」に留め、実データの削除有無は
-- -- 別途手動判断とする）。
