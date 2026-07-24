-- ============================================================================
-- RLS実地検証スクリプト（authenticatedユーザーをJWT claimsで模擬）
-- ============================================================================
--
-- 目的：
--   Magic Linkのメール送信レート制限に関わらず、Supabase SQL Editor上で
--   「ログイン済みの管理者として振る舞った場合にRLSが正しく動くか」を
--   安全に検証する。
--
-- 仕組み：
--   Supabaseの本番環境（PostgREST）は、リクエストごとに
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub": "<uuid>", ...}';
--   を実行してからSQLを流すことで、auth.uid()やRLSポリシーを評価している。
--   このスクリプトはSQL Editor上で同じ手順を手動で再現するだけであり、
--   特別な抜け道ではなく、本番と同じ評価経路を通す。
--
-- 安全性：
--   ・service_roleキーは一切使わない（このファイルはSQL Editor専用で、
--     フロントエンドのコードとは無関係）。
--   ・BEGIN 〜 ROLLBACK で全体を1トランザクションに囲っており、
--     途中でどんな結果になっても最後に必ず巻き戻す。
--     company-aへ一時的に作る検証用のdraft_configs行や、
--     companies.company_nameへの一時的な変更も含め、実データへの影響はない。
--
-- 使い方：
--   1. 下記の <YOUR_USER_UID> を、sample-companyのcompany_membersに
--      登録済みの自分のUser UIDに置き換える
--      （Supabase Dashboard → Authentication → Users で確認できる）。
--   2. このファイルの内容を丸ごとSupabase SQL Editorに貼り付けて実行する。
--   3. 最後に表示される rls_test_results の一覧で、pass列が全てtrueに
--      なっていることを確認する。
--
-- ============================================================================

begin;

create temporary table rls_test_results (
  seq int generated always as identity,
  test_name text,
  expected text,
  actual text,
  pass boolean
) on commit drop;

-- この一時テーブルは、まだ set local role authenticated に切り替える前の
-- （SQL Editorが最初に接続しているロールの）所有物として作られる。
-- そのため、この後 authenticated ロールに切り替えると、authenticatedは
-- このテーブルへのSELECT/INSERT権限を一切持たず、42501 permission deniedになる。
-- これは本番のcompanies/company_members等のRLSとは無関係な、単なる
-- 「一時テーブルの権限」の問題なので、この一時テーブルにだけ、
-- このトランザクション内限定でSELECT/INSERTを許可しておく
-- （on commit dropのため、トランザクション終了と同時にテーブルごと消え、
-- 恒久的な権限変更にはならない。本番テーブルへのGRANTは一切行っていない）。
grant select, insert on rls_test_results to authenticated;

-- company-aのidを、まだRLSに縛られていない（postgres相当の）ロールのうちに
-- 確定させておくための一時テーブル。
-- authenticatedロールに切り替えた後は company-a はRLSで見えなくなるため、
-- もしテストの中で毎回 select id from companies where company_code='company-a'
-- のように引こうとすると、結果はNULLになる。NULLをcompany_idとしてINSERTしようと
-- すればNOT NULL制約で落ちるだけで、それは「RLSに拒否された」のではなく
-- 「そもそも対象行のidを取得できなかった」だけであり、テストとして意味が薄れる。
-- そのため、company-aの実在するidを先に確保しておき、以降のテストでは
-- 常にこの確定済みidを使って「本物のcompany-aへ攻撃を試みて、それでも
-- RLSに拒否されるか」を検証する。
create temporary table rls_test_context (
  sample_company_id uuid,
  company_a_id uuid
) on commit drop;

insert into rls_test_context (sample_company_id, company_a_id)
select
  (select id from companies where company_code = 'sample-company'),
  (select id from companies where company_code = 'company-a');

grant select on rls_test_context to authenticated;

-- --- 事前準備（まだ postgres ロールのまま。RLSを介さずに検証用データを整える）---
-- company-aにも「既存の下書き」がある状態をあらかじめ作っておく。
-- こうすることで test 4a が「他社の下書きが実在するのに見えない」という、
-- より説得力のある検証になる（単に何も無いから0件、ではなく本当に隠れているか）。
insert into draft_configs (company_id, company_settings)
select company_a_id, '{"seed":"company-a-existing-draft-for-rls-test"}'::jsonb
from rls_test_context
on conflict (company_id) do nothing;

-- --- ここから authenticated ユーザー（あなた自身）として振る舞う ---
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '2202cee8-f8ea-477f-bda6-a908b01119b5', 'role', 'authenticated')::text,
  true
);
select set_config('request.jwt.claim.sub', '2202cee8-f8ea-477f-bda6-a908b01119b5', true);

-- TEST 1: sample-companyがSELECTできる（自社）
insert into rls_test_results (test_name, expected, actual, pass)
select
  '1. sample-companyをSELECT',
  '1件見える',
  count(*)::text || '件見える',
  count(*) = 1
from companies where company_code = 'sample-company';

-- TEST 2: company-aがSELECTできない（他社）
insert into rls_test_results (test_name, expected, actual, pass)
select
  '2. company-aをSELECT',
  '0件（見えない）',
  count(*)::text || '件見える',
  count(*) = 0
from companies where company_code = 'company-a';

-- TEST 3: sample-companyのdraft_configsを読み書きできる（自社）
do $$
declare
  v_company_id uuid;
  v_count int;
begin
  select id into v_company_id from companies where company_code = 'sample-company';

  insert into draft_configs (company_id, company_settings)
  values (v_company_id, '{"rls_test":"sample-company write ok"}'::jsonb)
  on conflict (company_id) do update set company_settings = excluded.company_settings;

  select count(*) into v_count from draft_configs where company_id = v_company_id;

  insert into rls_test_results (test_name, expected, actual, pass)
  values (
    '3. sample-companyのdraft_configsを読み書き',
    '成功・1件見える',
    '読み書き成功・' || v_count || '件見える',
    v_count = 1
  );
exception when others then
  insert into rls_test_results (test_name, expected, actual, pass)
  values ('3. sample-companyのdraft_configsを読み書き', '成功・1件見える', '失敗: ' || sqlerrm, false);
end;
$$;

-- TEST 4a: company-aのdraft_configsをSELECT（既存行があるのに見えないか）
do $$
declare
  v_company_id uuid;
  v_count int;
begin
  select company_a_id into v_company_id from rls_test_context;
  select count(*) into v_count from draft_configs where company_id = v_company_id;

  insert into rls_test_results (test_name, expected, actual, pass)
  values (
    '4a. company-aのdraft_configsをSELECT(既存行あり)',
    '0件（見えない）',
    v_count || '件見える',
    v_count = 0
  );
end;
$$;

-- TEST 4b: company-aのdraft_configsへ書き込みを試みる（拒否されるはず）
do $$
declare
  v_company_id uuid;
begin
  select company_a_id into v_company_id from rls_test_context;

  insert into draft_configs (company_id, company_settings)
  values (v_company_id, '{"attack":"should not be allowed"}'::jsonb)
  on conflict (company_id) do update set company_settings = excluded.company_settings;

  insert into rls_test_results (test_name, expected, actual, pass)
  values ('4b. company-aのdraft_configsへ書き込み試行', '拒否される', '★成功してしまった(危険)', false);
exception when others then
  insert into rls_test_results (test_name, expected, actual, pass)
  values ('4b. company-aのdraft_configsへ書き込み試行', '拒否される', '拒否: ' || sqlerrm, true);
end;
$$;

-- TEST 5: company_membersへ自分をcompany-aのadminとしてINSERT（特権昇格の試み。拒否されるはず）
do $$
declare
  v_company_id uuid;
begin
  select company_a_id into v_company_id from rls_test_context;

  insert into company_members (company_id, user_id, role)
  values (v_company_id, '2202cee8-f8ea-477f-bda6-a908b01119b5', 'admin');

  insert into rls_test_results (test_name, expected, actual, pass)
  values ('5. company_membersへ自分をcompany-aのadminとしてINSERT', '拒否される', '★成功してしまった(危険)', false);
exception when others then
  insert into rls_test_results (test_name, expected, actual, pass)
  values ('5. company_membersへ自分をcompany-aのadminとしてINSERT', '拒否される', '拒否: ' || sqlerrm, true);
end;
$$;

-- TEST 6: 他社(company-a)のcompaniesをUPDATE（拒否＝0件更新のはず）
do $$
declare
  v_updated int;
begin
  update companies
  set company_name = company_name || ' (RLS TEST - should not persist)'
  where company_code = 'company-a';
  get diagnostics v_updated = row_count;

  insert into rls_test_results (test_name, expected, actual, pass)
  values ('6. company-aのcompaniesをUPDATE', '0件（更新されない）', v_updated || '件更新', v_updated = 0);
end;
$$;

-- TEST 6b（参考・陽性対照）: 自社(sample-company)のcompaniesをUPDATE（成功＝1件更新のはず）
do $$
declare
  v_updated int;
begin
  update companies
  set company_name = company_name
  where company_code = 'sample-company';
  get diagnostics v_updated = row_count;

  insert into rls_test_results (test_name, expected, actual, pass)
  values ('6b.(参考)sample-companyのcompaniesをUPDATE', '1件（更新される）', v_updated || '件更新', v_updated = 1);
end;
$$;

-- --- 結果一覧を表示 ---
select seq, test_name, expected, actual, pass from rls_test_results order by seq;

-- --- 必ず巻き戻す（実データへの影響ゼロ）---
rollback;
