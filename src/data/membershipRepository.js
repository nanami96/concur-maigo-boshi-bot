import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";

// RPCが返すエラーの内、この画面群で意味のある種別だけを判定する。
// 実際の文言はSupabaseのraise exceptionメッセージ（英語）そのままなので、
// 呼び出し側（画面）が日本語の定型メッセージへ変換する際に使うキーを返す。
//   "already_member"      : 既にどこかの会社へ所属している（redeem_invite_code）
//   "invalid_code"        : 招待コードが正しくない（redeem_invite_code）
//   "platform_forbidden"  : platform_admin権限が無い（create_platform_company等）
//   "forbidden"           : admin権限が無い（update_company_member_role等）
//   "last_admin"          : 最後のadminを降格しようとした（update_company_member_role）
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

// ログイン中ユーザーの所属会社でのroleだけを取得する（#adminへのアクセス制御用）。
// company_membersへの通常SELECTを、フィルタ条件無しでそのまま投げる。
// 既存のcompany_members_select_own RLSポリシー（user_id = auth.uid()の行のみ
// 見える）により、これだけで安全に「自分の行だけ」に絞り込まれる
// （fetchMyCompanies・getCompanyDbIdと同じ、既存RLSを再利用する方針）。
// 未所属の場合はrole: nullを返す（エラーではない）。
export async function fetchMyRole() {
  if (!isSupabaseConfigured) {
    return { role: null, error: null };
  }

  try {
    const { data, error } = await supabase.from("company_members").select("role").maybeSingle();

    if (error) {
      return { role: null, error: { type: "unknown", message: error.message } };
    }

    return { role: data?.role ?? null, error: null };
  } catch (caughtError) {
    return { role: null, error: { type: "network", message: caughtError.message } };
  }
}

// ログイン中ユーザー(auth.uid())の所属会社・役割・公開設定をまとめて取得する。
// company_codeを一切渡さない＝他社を指定する経路が存在しない
// （get_my_public_config() RPC参照）。
//
// membership: null            … 未所属（company_membersに行が無い）
// membership: {companyCode, companyName, role, configSnapshot, publishedAt}
//   configSnapshot/publishedAtは、所属していてもまだ未公開ならnullになる。
export async function fetchMyMembership() {
  if (!isSupabaseConfigured) {
    return { membership: null, error: null };
  }

  try {
    const { data, error } = await supabase.rpc("get_my_public_config");

    if (error) {
      return { membership: null, error: { type: "unknown", message: error.message } };
    }

    const row = Array.isArray(data) ? data[0] : data;

    if (!row) {
      return { membership: null, error: null };
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
    };
  } catch (caughtError) {
    return { membership: null, error: { type: "network", message: caughtError.message } };
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
export async function fetchMyCompanyMembers() {
  if (!isSupabaseConfigured) {
    return { members: [], error: null };
  }

  try {
    const { data, error } = await supabase.rpc("list_my_company_members");

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
