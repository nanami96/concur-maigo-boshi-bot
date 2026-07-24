import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

const isPublicDemo = process.env.VITE_PUBLIC_DEMO === "true";

export default defineConfig({
  base: isPublicDemo ? "/concur-maigo-boshi-bot/" : "/",
  plugins: [
    react(),
    // PWA化（ホーム画面への追加・standalone起動・オフライン時のapp shell表示）。
    // start_url/scopeを"."（相対）にしているのは、GitHub Pagesのサブパス公開
    // （base: "/concur-maigo-boshi-bot/"）でもローカル（base: "/"）でも、
    // 生成されるmanifest.webmanifest内のURLが実際にbaseへ解決されるように
    // するため（vite-plugin-pwaはVite本体のbase設定を自動的に踏まえて
    // manifest・Service Workerのパスを組み立てる。ここで絶対パスを
    // ハードコードしないのは、既存のindex.htmlのfavicon参照と同じ理由）。
    //
    // workboxのglobPatterns等は既定値のまま変更していない。既定では
    // distに出力される同一オリジンの静的ファイルだけをプリキャッシュし、
    // Supabase（別オリジンのREST/RPC/Edge Functions）へのリクエストは
    // 一切intercept・キャッシュしない。rules/*/config.jsonは
    // import.meta.globで既にJSバンドルに含まれており（configSource.local.js/
    // configSource.public.js参照）、実行時に別ファイルとして取得される
    // ものではないため、Service Workerによる意図しないキャッシュの対象にも
    // ならない。既存のExcelインポート・下書き保存・公開・admin機能等は
    // いずれもfetch/RPC呼び出しであり、この設定によるキャッシュ対象にも含まれない。
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: {
        name: "Concur迷子防止Bot",
        short_name: "迷子ボット",
        description:
          "質問に答えるだけで、SAP Concur申請に使う経費タイプと入力のコツを確認できるBotです。",
        lang: "ja",
        start_url: ".",
        scope: ".",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#1f4fd8",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@configSource": path.resolve(
        __dirname,
        isPublicDemo
          ? "src/configSource.public.js"
          : "src/configSource.local.js",
      ),
    },
  },
});
