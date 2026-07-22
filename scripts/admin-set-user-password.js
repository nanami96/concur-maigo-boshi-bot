// 一度だけローカルで実行する、既存Supabase Authユーザーへパスワードを設定するための
// 管理用スクリプト。アプリ本体（Vite/ブラウザ）からは一切参照されない。
//
// なぜこれが必要か:
//   Supabase公式ドキュメントには「Dashboardから既存ユーザーへ直接パスワードを
//   設定するUI」の記載が見当たらず（招待メール送信の説明のみ）、コミュニティには
//   SQL Editorから auth.users を直接UPDATEする非公式な回避策も見られるが、
//   これはSupabaseの内部スキーマを直接操作する行為であり採用しない。
//   公式にサポートされているのは supabase.auth.admin.updateUserById() という
//   Admin APIで、公式ドキュメントに「サーバー上でのみ呼び出すこと。
//   service_roleキーをブラウザに露出させないこと」と明記されている。
//   このスクリプトはその「信頼されたサーバー環境」として、開発者のローカル
//   マシンで一度だけ手動実行するためのもの。
//
// 安全設計:
//   ・service_roleキーはこのファイルにもGitにも一切書かない。
//     .env.admin.local（.gitignoreに追加済み・Viteからは一切読み込まれない、
//     VITE_接頭辞も付けない）から読むか、実行時の環境変数として渡す。
//   ・パスワードもコードに書かない。環境変数 ADMIN_NEW_PASSWORD か、
//     未指定なら対話的に入力を求める（画面に表示される点に注意。表示させたく
//     ない場合は事前に環境変数を設定しておくこと）。
//   ・console.logへパスワードやservice_roleキーの値そのものは一切出力しない。
//   ・対象ユーザーはUID指定 or メールアドレス指定のどちらでも良い（コマンドライン引数）。
//     UIDをこのファイルへ固定で書き込むことはしない。
//   ・updateUserByIdはpasswordだけを更新し、UID・emailは変更しない。
//     company_membersはuser_idの外部キー参照のみを持つテーブルであり、
//     このスクリプトはcompany_membersに一切アクセスしない
//     （既存の紐付けはそのまま残る）。
//
// 使い方:
//   1. .env.admin.local.example を .env.admin.local としてコピーし、
//      SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY を記入する。
//      service_roleキーは Supabase Dashboard → Project Settings → API →
//      「service_role」secretキー。絶対にVITE_接頭辞を付けず、.env.localにも書かないこと。
//   2. 以下のいずれかで実行する。
//        node scripts/admin-set-user-password.js --email you@example.com
//        node scripts/admin-set-user-password.js --uid 6aa5d0d4-xxxx-....
//   3. パスワードの入力を求められるので入力する
//      （事前に環境変数 ADMIN_NEW_PASSWORD を設定しておけば、その値が使われ
//      対話入力は発生しない）。
//   4. 成功したら、.env.admin.local を削除するか、Supabase Dashboardで
//      service_roleキーを再生成（ローテーション）することを推奨する。

const fs = require("fs");
const path = require("path");
const readline = require("readline");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const text = fs.readFileSync(filePath, "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

function parseArgs(argv) {
  const args = { email: null, uid: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--email") {
      args.email = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--uid") {
      args.uid = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function promptPassword(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function resolveUidByEmail(adminClient, email) {
  let page = 1;
  const perPage = 200;

  for (;;) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`ユーザー一覧の取得に失敗しました: ${error.message}`);
    }

    const found = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) {
      return found.id;
    }

    if (data.users.length < perPage) {
      return null;
    }

    page += 1;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.email && !args.uid) {
    console.error("使い方:");
    console.error("  node scripts/admin-set-user-password.js --email you@example.com");
    console.error("  node scripts/admin-set-user-password.js --uid <UUID>");
    process.exitCode = 1;
    return;
  }

  const adminEnvPath = path.resolve(__dirname, "../.env.admin.local");
  const adminEnv = loadEnvFile(adminEnvPath);

  const supabaseUrl = process.env.SUPABASE_URL || adminEnv.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || adminEnv.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が見つかりません。" +
        " .env.admin.local を用意するか、環境変数として渡してください（.env.admin.local.example 参照）。",
    );
    process.exitCode = 1;
    return;
  }

  let password = process.env.ADMIN_NEW_PASSWORD;
  if (!password) {
    console.log("（環境変数 ADMIN_NEW_PASSWORD 未指定のため、対話入力します。入力内容は画面に表示されます）");
    password = await promptPassword("新しいパスワード: ");
  }

  if (!password) {
    console.error("パスワードが空です。処理を中止しました。");
    process.exitCode = 1;
    return;
  }

  // eslint-disable-next-line global-require
  const { createClient } = require("@supabase/supabase-js");
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    let targetUid = args.uid;

    if (!targetUid) {
      console.log(`メールアドレス "${args.email}" に一致するユーザーを検索しています…`);
      targetUid = await resolveUidByEmail(adminClient, args.email);
      if (!targetUid) {
        console.error(`メールアドレス "${args.email}" のユーザーが見つかりませんでした。`);
        process.exitCode = 1;
        return;
      }
    }

    console.log(`対象ユーザー UID: ${targetUid}`);

    const { data, error } = await adminClient.auth.admin.updateUserById(targetUid, { password });

    if (error) {
      console.error("パスワードの更新に失敗しました:", error.message);
      process.exitCode = 1;
      return;
    }

    console.log("パスワードを更新しました。");
    console.log(`  UID  : ${data.user.id}`);
    console.log(`  email: ${data.user.email}`);
    console.log("");
    console.log("このスクリプトの役目は終わりです。.env.admin.local の削除、または");
    console.log("Supabase Dashboardでのservice_roleキーの再生成（ローテーション）を推奨します。");
  } catch (caughtError) {
    console.error("予期しないエラーが発生しました:", caughtError.message);
    process.exitCode = 1;
  }
}

main();
