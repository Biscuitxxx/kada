// 一条命令拉起本地全套：对象存储(9000) + 数据 API(8787) + 前端(3015)
// 三者都不依赖任何云服务，可以完全离线运行。
//
// 用法： node server/dev-all.mjs    （或 pnpm local）
//
// 任何一个子进程意外退出都会自动重启（视频播放中途断连这类偶发错误不至于让整库停摆）。
// 10 分钟内同一进程崩 8 次就不再重启，直接报错退出，避免无限重启刷屏。

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const node = process.execPath;

const SHUTDOWN = { flag: false };
const entries = [];
const CRASH_WINDOW_MS = 10 * 60 * 1000;
const CRASH_LIMIT = 8;

function launch(entry) {
  const child = spawn(node, entry.args, { cwd: root, stdio: "inherit", env: process.env });
  entry.child = child;
  entry.startedAt = Date.now();

  child.on("exit", (code, signal) => {
    if (SHUTDOWN.flag) return;
    const ranMs = Date.now() - entry.startedAt;
    if (ranMs > CRASH_WINDOW_MS) {
      // 稳定跑了很久才退出，把崩溃计数清零
      entry.crashes = [];
    }
    const now = Date.now();
    entry.crashes = (entry.crashes ?? []).filter((at) => now - at < CRASH_WINDOW_MS);
    entry.crashes.push(now);

    if (entry.crashes.length >= CRASH_LIMIT) {
      console.error(
        `[local] ${entry.label} 短时间内反复退出 ${entry.crashes.length} 次（code=${code ?? "null"}，signal=${signal ?? "none"}），停止重启。请查看上面的日志定位原因。`,
      );
      shutdown(1);
      return;
    }

    const delay = Math.min(1000 * entry.crashes.length, 5000);
    console.log(
      `[local] ${entry.label} 退出（code=${code ?? "null"}，signal=${signal ?? "none"}），${(delay / 1000).toFixed(1)}s 后自动重启…`,
    );
    setTimeout(() => {
      if (!SHUTDOWN.flag) launch(entry);
    }, delay);
  });

  console.log(`[local] 已启动 ${entry.label}（pid=${child.pid}）`);
}

function shutdown(code = 0) {
  if (SHUTDOWN.flag) return;
  SHUTDOWN.flag = true;
  for (const entry of entries) {
    const child = entry.child;
    if (child && !child.killed) {
      try {
        child.kill();
      } catch {
        // 忽略
      }
    }
  }
  setTimeout(() => process.exit(code), 500);
}

process.on("SIGINT", () => {
  console.log("\n[local] 收到 Ctrl+C，停止所有进程…");
  shutdown(0);
});
process.on("SIGTERM", () => shutdown(0));
process.on("uncaughtException", (err) => {
  console.error("[local] 已忽略未捕获异常（保持服务运行）:", err?.message ?? err);
});

/**
 * 启动前先探一下 3015：如果已经有本项目的实例在跑，就别再起第二份。
 * 否则两个实例抢端口，前端会以 "Port 3015 is already in use" 反复失败重启，终端刷屏也看不出问题在哪。
 */
async function detectRunningInstance() {
  try {
    const response = await fetch("http://127.0.0.1:3015/api/health", {
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.status === "ok";
  } catch {
    return false;
  }
}

if (await detectRunningInstance()) {
  console.log("");
  console.log("[local] 已经有咔哒的实例在运行，这次不再重复启动。");
  console.log("[local] 直接访问 http://localhost:3015 即可。");
  console.log("[local] 想换成这个终端来管，先停掉旧实例再跑一次本命令：");
  console.log(
    "[local]   foreach ($p in 3015,8787,9000) { Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force } }",
  );
  process.exit(0);
}

for (const [label, args] of [
  ["对象存储 :9000", [path.join(here, "object-store.mjs")]],
  ["数据 API :8787", [path.join(here, "api.mjs")]],
  ["前端 :3015", [path.join(root, "node_modules", "vite", "bin", "vite.js"), "--port", "3015", "--host", "0.0.0.0", "--strictPort"]],
]) {
  const entry = { label, args, child: null, startedAt: 0, crashes: [] };
  entries.push(entry);
  launch(entry);
}
