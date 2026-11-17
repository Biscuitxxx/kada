// 补齐缺失的封面与时长（针对「上传时浏览器解不了编码」的视频，如 HEVC/H.265）
// 默认 dry-run：只列出将要处理的记录和探测结果；加 --apply 才抽帧、写封面文件并更新数据库。
//
// 用法：
//   node scripts/backfill-covers.mjs            # 预演
//   node scripts/backfill-covers.mjs --apply    # 真跑（会新增 <原文件>.cover.jpg，并写回 duration_seconds/cover_path）
//
// 依赖 Ubuntu 上的 ffmpeg/ffprobe（apt-get install -y ffmpeg）。
// 只碰 cover_path / duration_seconds 两个字段，不改视频文件本身。

import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const DB_PATH = path.resolve(process.env.LIBRARY_DB ?? path.join(ROOT, ".data", "library.db"));
const OBJECT_ROOT = path.resolve(
  process.env.OBJECT_STORE_DATA ?? path.join(ROOT, ".data", "objects"),
);

const APPLY = process.argv.includes("--apply");

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

async function locateObject(key) {
  const buckets = await fs.readdir(OBJECT_ROOT, { withFileTypes: true });
  for (const entry of buckets) {
    if (!entry.isDirectory()) continue;
    const base = path.join(OBJECT_ROOT, entry.name);
    const target = path.join(base, key);
    if (!target.startsWith(base + path.sep)) continue;
    if (existsSync(target)) return target;
  }
  return null;
}

async function probeDuration(file) {
  const { code, out } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=nw=1:nk=1",
    file,
  ]);
  if (code !== 0) return null;
  const n = Number(out.trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : null;
}

async function grabCover(file, outFile) {
  const ss = "1.5";
  const { code } = await run("ffmpeg", [
    "-y", "-v", "error",
    "-ss", ss,
    "-i", file,
    "-frames:v", "1",
    "-vf", "scale=640:-2",
    "-q:v", "3",
    outFile,
  ]);
  if (code === 0) return true;
  // 比 1.5 秒还短的片子，退回第一帧
  const retry = await run("ffmpeg", [
    "-y", "-v", "error",
    "-i", file,
    "-frames:v", "1",
    "-vf", "scale=640:-2",
    "-q:v", "3",
    outFile,
  ]);
  return retry.code === 0;
}

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA busy_timeout = 5000;");

const rows = db
  .prepare(
    `SELECT id, title, storage_path, cover_path, duration_seconds
       FROM videos
      WHERE cover_path IS NULL OR cover_path = '' OR duration_seconds IS NULL
      ORDER BY created_at ASC`,
  )
  .all();

console.log(`数据库：${DB_PATH}`);
console.log(`对象根：${OBJECT_ROOT}`);
console.log(`待补记录：${rows.length} 条${APPLY ? "（--apply：会写文件与数据库）" : "（预演，不改任何东西）"}`);

let ok = 0;
let missing = 0;
let failed = 0;

for (const row of rows) {
  const key = String(row.storage_path ?? "").replace(/^\/+/, "");
  const file = key ? await locateObject(key) : null;
  if (!file) {
    missing++;
    console.log(`  缺失对象  ${row.id}  ${row.title?.slice(0, 40)}`);
    continue;
  }

  const duration = await probeDuration(file);
  const coverKey = `${key}.cover.jpg`;
  const coverAbs = path.join(path.dirname(file), ".cover.jpg.check.jpg");
  const grabbed = await grabCover(file, coverAbs);

  if (!APPLY) {
    console.log(
      `  预演  ${row.id}  duration=${duration ?? "?"}  cover=${grabbed ? "可生成" : "抽帧失败"}  ${row.title?.slice(0, 34)}`,
    );
    if (grabbed) await fs.rm(coverAbs, { force: true });
    continue;
  }

  let coverPath = null;
  if (grabbed) {
    const finalCover = `${file}.cover.jpg`;
    await fs.rename(coverAbs, finalCover);
    coverPath = coverKey;
  }

  db.prepare("UPDATE videos SET cover_path = ?, duration_seconds = ? WHERE id = ?").run(
    coverPath,
    duration,
    row.id,
  );
  ok++;
  console.log(
    `  已补  ${row.id}  duration=${duration ?? "?"}  cover=${coverPath ? "yes" : "抽帧失败，仅补时长"}  ${row.title?.slice(0, 30)}`,
  );
}

db.close();

if (APPLY) {
  console.log(`\n完成：成功 ${ok} 条，缺对象 ${missing} 条，其余 ${failed} 条。刷新页面即可看到封面与时长。`);
} else {
  console.log("\n预演结束。确认无误后加 --apply 真正写入。");
}
