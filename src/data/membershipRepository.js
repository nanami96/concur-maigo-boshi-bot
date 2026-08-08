import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";

// RPCが返すエラーの内、この画面群で意味のある種別だけを判定する。
// 実際の文言はSupabaseのraise exceptionメッセージ（英語）そのままなので、
// 呼び出し側（画面）が日本語の定型メッセージへ変換する際に使うキーを返す。
//   "already_member"      : 既にどこかの会社へ所属している（redeem_invite_code）
//   "invalid_code"        : 招待コードが正しくない（redeem_invite_code）
//   "platform_forbidden"  : platform_admin権限が無い（create_platform_company等）
//   "forbidden"           : admin権限が無い（update_company_member_role等）
//   "last_admin"          : 最後のadminを降格しようとした（update_company_member_role）
//   "last_admin_removal"  : 最後のadminを会社から削除しようとした（remove_company_member）
//   "last_company"        : 会社が1件しか無い状態で削除しようとした（delete_platform_company）
//   "cannot_remove_self"  : 自分自身を会社から削除しようとした（remove_company_member）
//   "invalid_role"        : 不正なrole値を渡した（update_company_member_role）
//   "invalid_company_code": 会社コードの形式が不正（create_platform_company）
//   "company_name_required": 会社名が空（create_platform_company）
//   "company_code_taken"  : 会社コードが重複している（create_platform_company）
//   "not_found"           : 対象が見つからない（自社のメンバーではない等）
//   "auth"                : ログインセッションが無い
//   "network"             : 通信エラー
//   "unknown"             : 上記以外
//
// 判定順序に注意：「platform admin privileges required」は文字列として
// 「admin privileges required」を含んでしまうため、より具体的な
// platform_forbiddenの判定を先に行い、一般的なforbiddenの判定より前に
// 置いている（順序を入れ替えるとplatform_forbiddenへ到達できなくなる）。
export function classifyMembershipRpcError(error) {
  if (!error) {
    return null;
  }

  const message = String(error.message || "").toLowerCase();

  if (message.includes("already belongs to a company")) {
    return "already_member";
  }
  if (message.includes("invalid invite code")) {
    return "invalid_code";
  }
  if (message.includes("cannot demote the last admin")) {
    return "last_admin";
  }
  if (message.includes("cannot remove yourself")) {
    return "cannot_remove_self";
  }
  if (message.includes("cannot remove the last admin")) {
    return "last_admin_removal";
  }
  if (message.includes("cannot delete the last remaining company")) {
    return "last_company";
  }
  if (message.includes("platform admin privileges required")) {
    return "platform_forbidden";
  }
  if (message.includes("admin privileges required")) {
    return "forbidden";
  }
  if (message.includes("invalid role")) {
    return "invalid_role";
  }
  if (message.includes("invalid company code format")) {
    return "invalid_company_code";
  }
  if (message.includes("company name required")) {
    return "company_name_required";
  }
  if (message.includes("company code already exists")) {
    return "company_code_taken";
  }
  if (message.includes("not found")) {
    return "not_found";
  }
  if (message.includes("authentication required")) {
    return "auth";
  }
  if (error.name === "AuthRetryableFetchError" || message.includes("failed to fetch")) {
    return "network";
  }

  return "unknown";
}

// ログイン中ユーザーのroleを取得する（#adminへのアクセス制御用）。
// company_membersへの通常SELECTを、既存のcompany_members_select_own RLS
// ポリシー（user_id = auth.uid()の行のみ見える）を再利用して安全に
// 「自分の行だけ」に絞り込む（fetchMyCompanies・getCompanyDbIdと同じ方針）。
//
// 【複数社所属対応・Commit 6で変更】company_membersのunique(user_id)制約は
// 既に撤廃済みのため（supabase/schema.sql Phase 7-1参照）、companyIdを指定
// せずに.maybeSingle()を使うと、2社以上でrole='admin'の行を持つ利用者に対して
// 「複数行が返った」というPostgRESTのエラーになってしまう（AuthGate.jsxが
// これを踏んで管理画面アクセス判定自体が壊れるバグがあった）。
//
//   ・companyId（companies.id、uuid）を指定した場合：
//       unique(company_id, user_id)により、特定の会社+ユーザーの組み合わせは
//       高々1行しか無いことが保証されるため、.maybeSingle()が安全に使える
//       （get_my_public_config(p_company_code)と同じ理由）。その会社での
//       roleをそのまま返す（未所属ならrole: null）。
//   ・companyIdを省略した場合：
//       「どこか1社でもrole='admin'の行を持っているか」という存在確認だけを
//       行う（AuthGate.jsxの粗い入室可否判定用）。.maybeSingle()は使わず、
//       複数行が返っても例外にならない形（配列の有無判定）にする。
//       実際にどの会社を管理できるか（admin所属会社の一覧）は、
//       AdminRoot.jsx側の会社一覧（RLSでadmin所属会社だけに絞り込み済み。
//       src/data/draftConfigRepository.js の fetchMyCompanies() 参照）が担う。
export async function fetchMyRole(companyId) {
  if (!isSupabaseConfigured) {
    return { role: null, error: null };
  }

  try {
    if (companyId) {
      const { data, error } = await supabase
        .from("company_members")
        .select("role")
        .eq("company_id", companyId)
        .maybeSingle();

      if (error) {
        return { role: null, error: { type: "unknown", message: error.message } };
      }

      return { role: data?.role ?? null, error: null };
    }

    const { data, error } = await supabase.from("company_members").select("role").eq("role", "admin").limit(1);

    if (error) {
      return { role: null, error: { type: "unknown", message: error.message } };
    }

    return { role: Array.isArray(data) && data.length > 0 ? "admin" : null, error: null };
  } catch (caughtError) {
    return { role: null, error: { type: "network", message: caughtError.message } };
  }
}

// ログイン中ユーザー(auth.uid())の所属会社・役割・公開設定をまとめて取得する。
//
// 【複数社所属対応・Commit 2で変更】companyCodeを省略した場合の挙動は
// get_my_public_config() RPC（supabase/schema.sql参照）自体の仕様に従う：
//   - 所属0件 → membership: null（未所属）
//   - 所属1件 → サーバー側で自動解決（既存の1社利用者との後方互換）
//   - 所属2件以上 → RPCがfail-closedな例外を返す。これをambiguous: trueとして
//     呼び出し側（resolveCurrentCompany.js）へ伝える（データを一切返さない。
//     先頭行を機械的に選ぶことは絶対に行わない）。
// companyCodeを明示指定した場合は、その会社に実際に所属しているかどうかを
// サーバー側（get_my_public_config内のcompany_members照合）が検証する。
// 所属していなければmembership: nullが返るだけで、他社の情報が漏れることはない。
//
// membership: null            … 未所属、または指定した会社に所属していない
// membership: {companyCode, companyName, role, configSnapshot, publishedAt}
//   configSnapshot/publishedAtは、所属していてもまだ未公開ならnullになる。
// ambiguous: true             … companyCode省略・所属2件以上のため一意に決定できない
//   （このときmembership/errorは共にnull）。
export async function fetchMyMembership(companyCode) {
  if (!isSupabaseConfigured) {
    return { membership: null, error: null, ambiguous: false };
  }

  try {
    const hasCompanyCode = typeof companyCode === "string" && companyCode.trim() !== "";
    const { data, error } = hasCompanyCode
      ? await supabase.rpc("get_my_public_config", { p_company_code: companyCode })
      : await supabase.rpc("get_my_public_config");

    if (error) {
      if (String(error.message || "").includes("company must be specified")) {
        return { membership: null, error: null, ambiguous: true };
      }
      return { membership: null, error: { type: "unknown", message: error.message }, ambiguous: false };
    }

    const row = Array.isArray(data) ? data[0] : data;

    if (!row) {
      return { membership: null, error: null, ambiguous: false };
    }

    return {
      membership: {
        companyCode: row.company_code,
        companyName: row.company_name,
        role: row.role,
        configSnapshot: row.config_snapshot || null,
        publishedAt: row.published_at || null,
      },
      error: null,
      ambiguous: false,
    };
  } catch (caughtError) {
    return { membership: null, error: { type: "network", message: caughtError.message }, ambiguous: false };
  }
}

// ログイン中ユーザー(auth.uid())が所属する会社一覧を取得する（Commit 3で追加）。
// list_my_companies() RPC（supabase/schema.sql参照）はcompany_members.user_id =
// auth.uid()の行だけを対象にする（クライアントからuser_idを渡す経路は無い）ため、
// 他人の所属会社が混ざることはない。platform_adminであっても本人の所属会社
// だけが返る（全社一覧はfetchPlatformCompanies()の責務。混同しない）。
//
// companies: [{companyCode, companyName, role}, ...]
//   所属0件なら空配列（エラーではない）。複数件あればその全件を返す
//   （fetchMyMembership()と異なり、ここでは1件へ絞り込まない）。
export async function fetchMyCompanies() {
  if (!isSupabaseConfigured) {
    return { companies: [], error: null };
  }

  try {
    const { data, error } = await supabase.rpc("list_my_companies");

    if (error) {
      return { companies: [], error: { type: "unknown", message: error.message } };
    }

    const companies = (Array.isArray(data) ? data : []).map((row) => ({
      companyCode: row.company_code,
      companyName: row.company_name,
      role: row.role,
    }));

    return { companies, error: null };
  } catch (caughtError) {
    return { companies: [], error: { type: "network", message: caughtError.message } };
  }
}

// 招待コードを検証し、ログイン中ユーザーをrole=userとして会社へ所属させる。
// roleはサーバー側（redeem_invite_code RPC内）で固定されており、
// クライアントから渡すことはできない。
export async function redeemInviteCode(code) {
  if (!isSupabaseConfigured) {
    return { company: null, error: { type: "unknown", message: "Supabaseが設定されていません。" } };
  }

  try {
    const { data, error } = await supabase.rpc("redeem_invite_code", { p_code: code });

    if (error) {
      return { company: null, error: { type: classifyMembershipRpcError(error), message: error.message } };
    }

    const row = Array.isArray(data) ? data[0] : data;
    return {
      company: row ? { companyCode: row.company_code, companyName: row.company_name } : null,
      error: null,
    };
  } catch (caughtError) {
    return { company: null, error: { type: "network", message: caughtError.message } };
  }
}

// 自社（呼び出し元がadminの場合のみ）のメンバー一覧をメール付きで取得する。
// admin以外・未所属の場合は空配列（エラーではない。list_my_company_members()参照）。
//
// 【複数社所属対応・Commit 6で変更】companyId（companies.id、uuid）を指定できる
// ようにした。省略時はlist_my_company_members()自体の後方互換動作（admin所属
// 会社がちょうど1件ならその会社を自動解決、2件以上ある場合は0件を返す）に従う。
// 呼び出し元（UserManagementPanel.jsx）が「現在管理対象としている会社」の
// companyDbIdを把握している場合は、必ずそれを渡すことで、admin所属会社が
// 2件以上ある利用者でも正しく対象会社へスコープされる。
export async function fetchMyCompanyMembers(companyId) {
  if (!isSupabaseConfigured) {
    return { members: [], error: null };
  }

  try {
    const { data, error } = companyId
      ? await supabase.rpc("list_my_company_members", { p_company_id: companyId })
      : await supabase.rpc("list_my_company_members");

    if (error) {
      return { members: [], error: { type: "unknown", message: error.message } };
    }

    const members = (Array.isArray(data) ? data : []).map((row) => ({
      memberId: row.member_id,
      userId: row.user_id,
      email: row.email,
      role: row.role,
      createdAt: row.created_at,
    }));

    return { members, error: null };
  } catch (caughtError) {
    return { members: [], error: { type: "network", message: caughtError.message } };
  }
}

// 自社メンバーのroleを変更する。呼び出し元がadminであること、対象が自社の
// メンバーであること、最後のadminを降格しないことは全てupdate_company_member_role
// RPC側で検証される（クライアント側では信用しない）。
export async function updateMemberRole(memberId, newRole) {
  if (!isSupabaseConfigured) {
    return { member: null, error: { type: "unknown", message: "Supabaseが設定されていません。" } };
  }

  try {
    const { data, error } = await supabase.rpc("update_company_member_role", {
      p_member_id: memberId,
      p_new_role: newRole,
    });

    if (error) {
      return { member: null, error: { type: classifyMembershipRpcError(error), message: error.message } };
    }

    return { member: data, error: null };
  } catch (caughtError) {
    return { member: null, error: { type: "network", message: caughtError.message } };
  }
}

// 自社メンバーを会社から削除する（＝company_membersの対象行を削除するだけ。
// auth.usersのアカウント自体・platform_admins・他のテーブルは一切変更しない）。
// 呼び出し元が対象の所属会社のadminであること、対象が呼び出し元自身ではないこと、
// 最後のadminではないことは全てremove_company_member RPC側（DB側）で検証される
// （クライアント側では信用しない。UserManagementPanel.jsx側の disabled 制御は
// あくまでUXのための早期フィードバックに過ぎない）。
export async function removeCompanyMember(memberId) {
  if (!isSupabaseConfigured) {
    return { member: null, error: { type: "unknown", message: "Supabaseが設定されていません。" } };
  }

  try {
    const { data, error } = await supabase.rpc("remove_company_member", {
      p_member_id: memberId,
    });

    if (error) {
      return { member: null, error: { type: classifyMembershipRpcError(error), message: error.message } };
    }

    return { member: data, error: null };
  } catch (caughtError) {
    return { member: null, error: { type: "network", message: caughtError.message } };
  }
}

// ログイン中ユーザー自身のuser_id（auth.uid()相当）をクライアント側で確認する。
// UserManagementPanel.jsxが「会社から削除」ボタンを自分自身の行に対して
// 表示しない（disabledにする）ためだけのUI用の判定であり、セキュリティ境界では
// ない（最終的な自己削除の防止はremove_company_member() RPC内部のauth.uid()検証が
// 担う。詳細はsupabase/schema.sql参照）。AuthGate.jsx等が既に使っている
// supabase.auth.getSession()（ローカルのセッション情報を読むだけで、
// getUser()と違いAuthサーバーへの問い合わせを伴わない）をそのまま利用する。
export async function fetchCurrentUserId() {
  if (!isSupabaseConfigured) {
    return { userId: null, error: null };
  }

  try {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      return { userId: null, error: { type: "unknown", message: error.message } };
    }

    return { userId: data?.session?.user?.id ?? null, error: null };
  } catch (caughtError) {
    return { userId: null, error: { type: "network", message: caughtError.message } };
  }
}

// --- Phase 8: platform_admin（サービス運営者）向け ---------------------------

// ログイン中ユーザーがplatform_adminかどうかを判定する（#adminのアクセス制御・
// 会社セレクタ表示可否等に使う）。is_platform_admin() RPCはauth.uid()だけから
// 判定するため、クライアントからtrue/falseを渡して信用させる経路は無い。
export async function fetchIsPlatformAdmin() {
  if (!isSupabaseConfigured) {
    return { isPlatformAdmin: false, error: null };
  }

  try {
    const { data, error } = await supabase.rpc("is_platform_admin");

    if (error) {
      return { isPlatformAdmin: false, error: { type: "unknown", message: error.message } };
    }

    return { isPlatformAdmin: Boolean(data), error: null };
  } catch (caughtError) {
    return { isPlatformAdmin: false, error: { type: "network", message: caughtError.message } };
  }
}

// platform_adminの場合のみ、全社の一覧（id・company_code・company_name）を返す。
// それ以外（一般user・通常admin）は空配列（list_platform_companies()側で0行）。
export async function fetchPlatformCompanies() {
  if (!isSupabaseConfigured) {
    return { companies: [], error: null };
  }

  try {
    const { data, error } = await supabase.rpc("list_platform_companies");

    if (error) {
      return { companies: [], error: { type: "unknown", message: error.message } };
    }

    const companies = (Array.isArray(data) ? data : []).map((row) => ({
      id: row.company_code,
      companyDbId: row.company_id,
      label: row.company_name,
    }));

    return { companies, error: null };
  } catch (caughtError) {
    return { companies: [], error: { type: "network", message: caughtError.message } };
  }
}

// 新しい会社を作成する（platform_adminのみ）。招待コードは平文でこの戻り値に
// だけ含まれ、以後は再取得できない（DBにはハッシュのみ保存される）。
export async function createPlatformCompany({ companyCode, companyName }) {
  if (!isSupabaseConfigured) {
    return { company: null, error: { type: "unknown", message: "Supabaseが設定されていません。" } };
  }

  try {
    const { data, error } = await supabase.rpc("create_platform_company", {
      p_company_code: companyCode,
      p_company_name: companyName,
    });

    if (error) {
      return { company: null, error: { type: classifyMembershipRpcError(error), message: error.message } };
    }

    const row = Array.isArray(data) ? data[0] : data;

    return {
      company: row
        ? {
            companyDbId: row.company_id,
            companyCode: row.company_code,
            companyName: row.company_name,
            inviteCode: row.invite_code,
          }
        : null,
      error: null,
    };
  } catch (caughtError) {
    return { company: null, error: { type: "network", message: caughtError.message } };
  }
}

// 会社を削除する（platform_adminのみ）。company_members・draft_configs・
// published_versionsはdelete_platform_company() RPC側のon delete cascadeにより
// 自動的に削除されるため、ここで個別にDELETEする処理は無い（孤立データが
// 残らないことはRPC側の保証に委ねる。詳細はsupabase/schema.sql参照）。
// 会社が1件しか無い場合はRPC側で拒否される（last_companyとして分類される）。
export async function deletePlatformCompany(companyDbId) {
  if (!isSupabaseConfigured) {
    return { company: null, error: { type: "unknown", message: "Supabaseが設定されていません。" } };
  }

  try {
    const { data, error } = await supabase.rpc("delete_platform_company", {
      p_company_id: companyDbId,
    });

    if (error) {
      return { company: null, error: { type: classifyMembershipRpcError(error), message: error.message } };
    }

    const row = Array.isArray(data) ? data[0] : data;

    return {
      company: row
        ? { companyDbId: row.company_id, companyCode: row.company_code, companyName: row.company_name }
        : null,
      error: null,
    };
  } catch (caughtError) {
    return { company: null, error: { type: "network", message: caughtError.message } };
  }
}

// 招待コードを再発行する（platform_adminのみ）。古いコードは即座に無効化され、
// 新しい平文コードはこの戻り値でのみ取得できる。
export async function regenerateInviteCode(companyDbId) {
  if (!isSupabaseConfigured) {
    return { inviteCode: null, error: { type: "unknown", message: "Supabaseが設定されていません。" } };
  }

  try {
    const { data, error } = await supabase.rpc("regenerate_invite_code", {
      p_company_id: companyDbId,
    });

    if (error) {
      return { inviteCode: null, error: { type: classifyMembershipRpcError(error), message: error.message } };
    }

    const row = Array.isArray(data) ? data[0] : data;
    return { inviteCode: row?.invite_code ?? null, error: null };
  } catch (caughtError) {
    return { inviteCode: null, error: { type: "network", message: caughtError.message } };
  }
}

// platform_adminが、任意の（自分が所属していない可能性がある）会社のユーザー
// 一覧をメール付きで取得する。list_my_company_members()（呼び出し元自身の
// 所属会社限定）とは別のRPCを使う。
export async function fetchPlatformCompanyMembers(companyDbId) {
  if (!isSupabaseConfigured) {
    return { members: [], error: null };
  }

  try {
    const { data, error } = await supabase.rpc("list_platform_company_members", {
      p_company_id: companyDbId,
    });

    if (error) {
      return { members: [], error: { type: "unknown", message: error.message } };
    }

    const members = (Array.isArray(data) ? data : []).map((row) => ({
      memberId: row.member_id,
      userId: row.user_id,
      email: row.email,
      role: row.role,
      createdAt: row.created_at,
    }));

    return { members, error: null };
  } catch (caughtError) {
    return { members: [], error: { type: "network", message: caughtError.message } };
  }
}
