import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { localProxyPlugin } from "./server/local-proxy";

const SOURCE_LOCATION_PLUGIN_CANDIDATES = [
  process.env.MEOO_SOURCE_LOCATION_PLUGIN_PATH,
  "/app/sdk/lib/src/plugins/source-location-babel.js",
  resolve(process.cwd(), "node_modules/@ali/oneday-agent-sdk/lib/src/plugins/source-location-babel.js"),
].filter(Boolean) as string[];

const SOURCE_LOCATION_PLUGIN_PATH = SOURCE_LOCATION_PLUGIN_CANDIDATES.find((path) => existsSync(path));
const PROJECT_ROOT = fileURLToPath(new URL(".", import.meta.url));
const normalizeWatchPath = (filePath: string) => filePath.replace(/\\/g, "/");
const TMP_DIRECTORY = normalizeWatchPath(resolve(PROJECT_ROOT, "tmp"));

/**
 * React + Vite 构建配置
 *
 * 硬约束：
 * - dev server 必须监听 3015 + strictPort（沙箱只开放一个代理端口）
 * - outDir 'dist' / assetsDir 'assets' — 归一化产物目录
 */
export default defineConfig({
  plugins: [
    {
      name: "meoo-require-real-homepage",
      apply: "build",
      buildStart() {
        const homepage = resolve(PROJECT_ROOT, "src/routes/index.tsx");
        if (existsSync(homepage) && readFileSync(homepage, "utf8").includes("data-meoo-blank-placeholder")) {
          this.error("[MEOO_DEFAULT_HOMEPAGE_NOT_REPLACED] src/routes/index.tsx 仍为默认占位首页，业务页面尚未接入。主 Agent 必须替换首页并装配业务组件，然后重新构建；不能只删除占位标记。");
        }
      },
    },
    tailwindcss(),
    TanStackRouterVite(),
    viteReact({
      babel: {
        plugins: SOURCE_LOCATION_PLUGIN_PATH
          ? [[SOURCE_LOCATION_PLUGIN_PATH, { projectRoot: process.cwd() }]]
          : [],
      },
    }),
    tsConfigPaths(),
    localProxyPlugin([
      {
        prefix: "/api",
        port: 8787,
        envKey: "LIBRARY_API_TARGET",
        fallback: "http://127.0.0.1:8787",
        stripPrefix: false,
      },
      {
        prefix: "/storage",
        port: 9000,
        envKey: "OBJECT_STORE_TARGET",
        fallback: "http://127.0.0.1:9000",
        stripPrefix: true,
      },
    ]),
  ],
  optimizeDeps: {
    entries: ["index.html", "src/main.tsx"],
  },
  server: {
    host: "0.0.0.0",
    port: 3015,
    strictPort: true,
    allowedHosts: true,
    // 本地数据服务（SQLite）：/api 由 localProxyPlugin 转发到本机 8787。
    // 对象存储：/storage 转发到本机 9000，让手机等局域网设备也用同一套相对地址（不会指向自己的 127.0.0.1）。
    // 转发用 server/local-proxy.ts 里的流式实现，不用 vite 自带 server.proxy：
    // 自带那套在视频播放中途断连时会抛未捕获的 ECONNRESET，把整个前端进程带走。

    // 沙箱预览关闭 WebSocket 和 HMR，避免 iframe 下整页 reload 放大 transform error。
    ws: false,
    hmr: false,
    // tmp 是下载/解压等临时工作区，默认不参与递归监听；public 仍保持监听，
    // 以支持运行期间新增、修改和删除静态资源。
    watch: {
      ignored: (filePath) => {
        const normalizedPath = normalizeWatchPath(filePath);
        return normalizedPath === TMP_DIRECTORY
          || normalizedPath.startsWith(`${TMP_DIRECTORY}/`);
      },
    },
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
