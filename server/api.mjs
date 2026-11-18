// 本地数据服务：SQLite + REST，替代原来的 Meoo Cloud（Supabase）元数据层。
// 表结构与原迁移 SQL 保持一致（video_categories / videos），不再需要任何云服务。
//
// 用法： node server/api.mjs
// 可配置环境变量：
//   LIBRARY_API_PORT  监听端口（默认 8787，前端通过 vite 代理 /api 访问）
//   LIBRARY_DB        SQLite 文件路径（默认 .data/library.db）

import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.LIBRARY_API_PORT ?? 8787);
const DB_PATH = path.resolve(process.env.LIBRARY_DB ?? path.join(here, "..", ".data", "library.db"));

await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS video_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    original_name TEXT NOT NULL,
    category_id TEXT REFERENCES video_categories(id) ON DELETE SET NULL,
    storage_path TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'video/mp4',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    duration_seconds REAL,
    cover_path TEXT,
    folder_hint TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS videos_category_idx ON videos (category_id);
  CREATE INDEX IF NOT EXISTS videos_created_idx ON videos (created_at DESC);

  -- 标签：name 是展示用（保留用户输入的全角/大小写），name_key 是去重键（NFKC + 小写 + trim）
  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );

  -- 一个视频可以有多个标签，与 category_id 互不冲突
  CREATE TABLE IF NOT EXISTS video_tags (
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (video_id, tag_id)
  );

  CREATE INDEX IF NOT EXISTS video_tags_tag_idx ON video_tags (tag_id);
`);

// 网页版（浏览器友好版）：HEVC 等浏览器解不了的编码，服务端转一份 H.264 供在线播放。
// proxy_path 为空表示没有网页版；proxy_status 记录队列状态（pending / processing / ready / failed）。
{
  const cols = db.prepare("PRAGMA table_info(videos)").all().map((c) => c.name);
  if (!cols.includes("proxy_path")) db.exec("ALTER TABLE videos ADD COLUMN proxy_path TEXT");
  if (!cols.includes("proxy_status")) db.exec("ALTER TABLE videos ADD COLUMN proxy_status TEXT");
}

// 兜底分类：与原先「未分类」默认分类对齐。
const seedName = "未分类";
const existingDefault = db.prepare("SELECT id FROM video_categories WHERE name = ?").get(seedName);
if (!existingDefault) {
  db.prepare(
    "INSERT INTO video_categories (id, name, sort_order, is_default, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(randomUUID(), seedName, 0, 1, new Date().toISOString());
}

const VIDEO_COLS =
  "id, title, original_name, category_id, storage_path, mime_type, size_bytes, duration_seconds, cover_path, folder_hint, created_at, proxy_path, proxy_status";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function sendJson(res, status, payload) {
  const body = body_of(payload);
  res.writeHead(status, {
    ...CORS_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function body_of(payload) {
  return JSON.stringify(payload ?? null);
}

function fail(res, status, message) {
  sendJson(res, status, { error: message });
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error("请求体过大");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function asCategory(row) {
  return {
    id: row.id,
    name: row.name,
    sort_order: Number(row.sort_order),
    is_default: Boolean(row.is_default),
  };
}

function asVideo(row, tagIds) {
  return {
    id: row.id,
    title: row.title,
    original_name: row.original_name,
    category_id: row.category_id,
    storage_path: row.storage_path,
    mime_type: row.mime_type,
    size_bytes: Number(row.size_bytes),
    duration_seconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    cover_path: row.cover_path,
    folder_hint: row.folder_hint,
    created_at: row.created_at,
    proxy_path: row.proxy_path ?? null,
    proxy_status: row.proxy_status ?? null,
    tag_ids: tagIds ?? tagIdsOf(row.id),
  };
}

/* ── 标签 ─────────────────────────────────────────────────── */

/** 去重键：全角/半角、大小写、首尾空白都归一到同一个 key，展示名仍保留原样。 */
function tagKeyOf(name) {
  return String(name ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function asTag(row, count) {
  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    video_count: Number(count ?? 0),
  };
}

const tagCounts = () => {
  const map = new Map();
  for (const row of db.prepare("SELECT tag_id, COUNT(*) AS n FROM video_tags GROUP BY tag_id").all()) {
    map.set(row.tag_id, Number(row.n));
  }
  return map;
};

function listTags() {
  const counts = tagCounts();
  return db
    .prepare("SELECT id, name, created_at FROM tags ORDER BY name ASC")
    .all()
    .map((row) => asTag(row, counts.get(row.id) ?? 0));
}

/** 建标签：同名（归一化后）直接复用，不报错也不产生第二条。 */
function ensureTag(rawName) {
  const name = String(rawName ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
  if (!name) throw new Error("标签名不能为空。");
  const key = tagKeyOf(name);
  const existing = db.prepare("SELECT id, name, created_at FROM tags WHERE name_key = ?").get(key);
  if (existing) return asTag(existing, tagCounts().get(existing.id) ?? 0);
  const row = { id: randomUUID(), name, name_key: key, created_at: new Date().toISOString() };
  try {
    db.prepare("INSERT INTO tags (id, name, name_key, created_at) VALUES (?, ?, ?, ?)").run(
      row.id, row.name, row.name_key, row.created_at,
    );
  } catch (cause) {
    // 并发下唯一键可能被抢先写入，回读即可
    if (String(cause.message).includes("UNIQUE")) {
      const again = db.prepare("SELECT id, name, created_at FROM tags WHERE name_key = ?").get(key);
      if (again) return asTag(again, 0);
    }
    throw cause;
  }
  return asTag(row, 0);
}

function renameTag(id, rawName) {
  const existing = db.prepare("SELECT id, name, name_key, created_at FROM tags WHERE id = ?").get(id);
  if (!existing) return null;
  const name = String(rawName ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
  if (!name) throw new Error("标签名不能为空。");
  const key = tagKeyOf(name);
  const clash = db.prepare("SELECT id FROM tags WHERE name_key = ? AND id <> ?").get(key, id);
  if (clash) throw new Error(`标签「${name}」已存在`);
  db.prepare("UPDATE tags SET name = ?, name_key = ? WHERE id = ?").run(name, key, id);
  return asTag({ ...existing, name }, tagCounts().get(id) ?? 0);
}

function deleteTag(id) {
  if (!db.prepare("SELECT id FROM tags WHERE id = ?").get(id)) return false;
  // 关联行随 ON DELETE CASCADE 一起清掉；视频本身不动
  db.prepare("DELETE FROM tags WHERE id = ?").run(id);
  return true;
}

function tagIdsOf(videoId) {
  return db
    .prepare("SELECT tag_id FROM video_tags WHERE video_id = ?")
    .all(videoId)
    .map((row) => row.tag_id);
}

/** 给一个视频设置标签集合：传入的 id 必须已存在；重复的忽略。 */
function setVideoTags(videoId, tagIds) {
  if (!db.prepare("SELECT id FROM videos WHERE id = ?").get(videoId)) return null;
  if (!Array.isArray(tagIds)) throw new Error("tag_ids 必须是数组。");
  const ids = [...new Set(tagIds.map((value) => String(value)))];
  for (const tagId of ids) {
    if (!db.prepare("SELECT id FROM tags WHERE id = ?").get(tagId)) throw new Error("标签不存在。");
  }
  db.prepare("DELETE FROM video_tags WHERE video_id = ?").run(videoId);
  const now = new Date().toISOString();
  const insert = db.prepare("INSERT INTO video_tags (video_id, tag_id, created_at) VALUES (?, ?, ?)");
  for (const tagId of ids) insert.run(videoId, tagId, now);
  return getVideo(videoId);
}

/** 批量加/减标签：一次请求处理多个视频，上传弹窗与首页多选都用它。 */
function bulkTagVideos(videoIds, tagIds, mode) {
  if (!Array.isArray(videoIds) || videoIds.length === 0) throw new Error("未指定视频。");
  const ids = [...new Set(videoIds.map((value) => String(value)))];
  for (const videoId of ids) {
    if (!db.prepare("SELECT id FROM videos WHERE id = ?").get(videoId)) throw new Error("视频不存在。");
  }
  const tagIdsList = Array.isArray(tagIds) ? [...new Set(tagIds.map((value) => String(value)))] : [];
  if (mode === "add") {
    if (tagIdsList.length === 0) throw new Error("未指定标签。");
    for (const tagId of tagIdsList) {
      if (!db.prepare("SELECT id FROM tags WHERE id = ?").get(tagId)) throw new Error("标签不存在。");
    }
    const now = new Date().toISOString();
    const insert = db.prepare(
      "INSERT OR IGNORE INTO video_tags (video_id, tag_id, created_at) VALUES (?, ?, ?)",
    );
    for (const videoId of ids) for (const tagId of tagIdsList) insert.run(videoId, tagId, now);
  } else if (mode === "remove") {
    if (tagIdsList.length === 0) throw new Error("未指定标签。");
    const remove = db.prepare("DELETE FROM video_tags WHERE video_id = ? AND tag_id = ?");
    for (const videoId of ids) for (const tagId of tagIdsList) remove.run(videoId, tagId);
  } else {
    throw new Error("mode 只能是 add 或 remove。");
  }
  return { ok: true, video_ids: ids, tag_ids: tagIdsList, mode };
}


const categoryExists = (name, exceptId) => {
  const row = exceptId
    ? db.prepare("SELECT id FROM video_categories WHERE name = ? AND id <> ?").get(name, exceptId)
    : db.prepare("SELECT id FROM video_categories WHERE name = ?").get(name);
  return Boolean(row);
};

function listCategories() {
  return db
    .prepare("SELECT id, name, sort_order, is_default FROM video_categories ORDER BY sort_order ASC, created_at ASC")
    .all()
    .map(asCategory);
}

function createCategory(name) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw new Error("分类名不能为空。");
  if (categoryExists(trimmed)) throw new Error(`分类「${trimmed}」已存在`);
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS n FROM video_categories").get().n;
  const row = {
    id: randomUUID(),
    name: trimmed,
    sort_order: Number(maxOrder) + 1,
    is_default: 0,
    created_at: new Date().toISOString(),
  };
  try {
    db.prepare(
      "INSERT INTO video_categories (id, name, sort_order, is_default, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(row.id, row.name, row.sort_order, row.is_default, row.created_at);
  } catch (cause) {
    if (String(cause.message).includes("UNIQUE")) throw new Error(`分类「${trimmed}」已存在`);
    throw cause;
  }
  return asCategory(db.prepare("SELECT id, name, sort_order, is_default FROM video_categories WHERE id = ?").get(row.id));
}

function patchCategory(id, payload) {
  const existing = db.prepare("SELECT id FROM video_categories WHERE id = ?").get(id);
  if (!existing) return null;
  if (payload.name !== undefined) {
    const trimmed = String(payload.name).trim();
    if (!trimmed) throw new Error("分类名不能为空。");
    if (categoryExists(trimmed, id)) throw new Error(`分类「${trimmed}」已存在`);
    db.prepare("UPDATE video_categories SET name = ? WHERE id = ?").run(trimmed, id);
  }
  if (payload.sort_order !== undefined) {
    const order = Number(payload.sort_order);
    if (!Number.isFinite(order)) throw new Error("排序值无效。");
    db.prepare("UPDATE video_categories SET sort_order = ? WHERE id = ?").run(Math.round(order), id);
  }
  return asCategory(db.prepare("SELECT id, name, sort_order, is_default FROM video_categories WHERE id = ?").get(id));
}

function deleteCategory(id) {
  const existing = db.prepare("SELECT id FROM video_categories WHERE id = ?").get(id);
  if (!existing) return false;
  // 与原 SQL 的 ON DELETE SET NULL 一致：该分类下的视频归入未分类。
  db.prepare("UPDATE videos SET category_id = NULL WHERE category_id = ?").run(id);
  db.prepare("DELETE FROM video_categories WHERE id = ?").run(id);
  return true;
}

/** 批量把一批视频改成同一个分类（null = 未分类）。分类是单选，语义就是「整批改成」。 */
function bulkSetCategory(videoIds, categoryId) {
  const ids = Array.isArray(videoIds) ? videoIds.map((v) => String(v)) : [];
  if (ids.length === 0) throw new Error("没有选中任何视频。");
  if (categoryId !== null && categoryId !== undefined) {
    if (!db.prepare("SELECT id FROM video_categories WHERE id = ?").get(String(categoryId))) {
      throw new Error("分类不存在。");
    }
  }
  const target = categoryId === null || categoryId === undefined ? null : String(categoryId);
  const update = db.prepare("UPDATE videos SET category_id = ? WHERE id = ?");
  let updated = 0;
  for (const id of ids) updated += update.run(target, id).changes;
  return { ok: true, updated };
}

function listVideos() {
  // 一次查出全部关联，避免每条视频各查一次标签
  const byVideo = new Map();
  for (const row of db.prepare("SELECT video_id, tag_id FROM video_tags").all()) {
    const list = byVideo.get(row.video_id);
    if (list) list.push(row.tag_id);
    else byVideo.set(row.video_id, [row.tag_id]);
  }
  return db
    .prepare(`SELECT ${VIDEO_COLS} FROM videos ORDER BY created_at DESC LIMIT 1000`)
    .all()
    .map((row) => asVideo(row, byVideo.get(row.id) ?? []));
}

function getVideo(id) {
  const row = db.prepare(`SELECT ${VIDEO_COLS} FROM videos WHERE id = ?`).get(id);
  return row ? asVideo(row) : null;
}

function createVideo(payload) {
  const title = String(payload.title ?? "").trim();
  const originalName = String(payload.original_name ?? "").trim();
  const storagePath = String(payload.storage_path ?? "").trim();
  if (!title) throw new Error("视频标题不能为空。");
  if (!originalName) throw new Error("原始文件名不能为空。");
  if (!storagePath) throw new Error("存储路径不能为空。");
  const categoryId = payload.category_id ? String(payload.category_id) : null;
  if (categoryId && !db.prepare("SELECT id FROM video_categories WHERE id = ?").get(categoryId)) {
    throw new Error("分类不存在。");
  }
  const duration = payload.duration_seconds === null || payload.duration_seconds === undefined
    ? null
    : Number(payload.duration_seconds);
  const size = Number(payload.size_bytes ?? 0);
  if (!Number.isFinite(size) || size < 0) throw new Error("文件大小无效。");

  const row = {
    id: randomUUID(),
    title,
    original_name: originalName,
    category_id: categoryId,
    storage_path: storagePath,
    mime_type: String(payload.mime_type ?? "video/mp4"),
    size_bytes: Math.round(size),
    duration_seconds: Number.isFinite(duration) ? duration : null,
    cover_path: payload.cover_path ? String(payload.cover_path) : null,
    folder_hint: payload.folder_hint ? String(payload.folder_hint) : null,
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO videos (${VIDEO_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id, row.title, row.original_name, row.category_id, row.storage_path, row.mime_type,
    row.size_bytes, row.duration_seconds, row.cover_path, row.folder_hint, row.created_at,
    null, null,
  );
  // 入库后做两件后台事：缺封面就补（前端 canvas 解不了 HEVC），需要网页版就排队转码
  postProcessVideo(row.id);
  return getVideo(row.id);
}

function patchVideo(id, payload) {
  const existing = db.prepare("SELECT id FROM videos WHERE id = ?").get(id);
  if (!existing) return null;
  if (payload.title !== undefined) {
    const title = String(payload.title).trim();
    if (!title) throw new Error("视频标题不能为空。");
    db.prepare("UPDATE videos SET title = ? WHERE id = ?").run(title, id);
  }
  if (payload.category_id !== undefined) {
    if (payload.category_id === null) {
      db.prepare("UPDATE videos SET category_id = NULL WHERE id = ?").run(id);
    } else {
      const categoryId = String(payload.category_id);
      if (!db.prepare("SELECT id FROM video_categories WHERE id = ?").get(categoryId)) {
        throw new Error("分类不存在。");
      }
      db.prepare("UPDATE videos SET category_id = ? WHERE id = ?").run(categoryId, id);
    }
  }
  return getVideo(id);
}

function deleteVideo(id) {
  const existing = db
    .prepare("SELECT storage_path, cover_path, proxy_path FROM videos WHERE id = ?")
    .get(id);
  if (!existing) return null;
  db.prepare("DELETE FROM videos WHERE id = ?").run(id);
  return existing;
}

// 删除记录后顺手清掉对象文件（storage_path 是桶内相对 key，如 uploads/xxx.mp4）
const OBJECT_ROOT = path.resolve(
  process.env.OBJECT_STORE_DATA ?? path.join(here, "..", ".data", "objects"),
);

async function removeStoredObject(key) {
  const relative = String(key ?? "").trim().replace(/^\/+/, "");
  if (!relative || relative.includes("..")) return false;
  let buckets;
  try {
    buckets = (await fs.readdir(OBJECT_ROOT, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return false;
  }
  let removed = false;
  for (const bucket of buckets) {
    const base = path.join(OBJECT_ROOT, bucket);
    const target = path.join(base, relative);
    if (!target.startsWith(base + path.sep)) continue;
    try {
      await fs.unlink(target);
      removed = true;
    } catch {
      // 文件不存在就跳过，不让删除接口因为孤儿对象失败
    }
  }
  return removed;
}

/* ── 网页版转码队列（HEVC → H.264）─────────────────────────
   浏览器（Chrome/Edge/手机）不带 H.265 解码，HEVC 文件只能下载后看。
   这里在服务端按需转一份 H.264 的 <原文件>.web.mp4，前端优先播它，原片不动。
   队列串行跑，避免几路 ffmpeg 同时把 CPU 吃满。 */

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";
const BROWSER_OK_CODECS = new Set(["h264", "vp9", "vp09", "av1", "av01", "theora", "mpeg4"]);
const transcodeQueue = [];
let transcodeRunning = false;

/** 在对象根的所有桶里找 key 对应的真实文件路径（与 removeStoredObject 同布局，但只读）。 */
async function locateObjectPath(key) {
  const relative = String(key ?? "").trim().replace(/^\/+/, "");
  if (!relative || relative.includes("..")) return null;
  let buckets;
  try {
    buckets = (await fs.readdir(OBJECT_ROOT, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return null;
  }
  for (const bucket of buckets) {
    const base = path.join(OBJECT_ROOT, bucket);
    const target = path.join(base, relative);
    if (!target.startsWith(base + path.sep)) continue;
    try {
      await fs.access(target);
      return target;
    } catch {
      // 不存在就找下一个桶
    }
  }
  return null;
}

function spawnCapture(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("error", (cause) => resolve({ code: -1, out, err: String(cause?.message ?? cause) }));
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

/** 读视频轨编码与尺寸；读不到返回 null。 */
async function probeStream(file) {
  const r = await spawnCapture(FFPROBE, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,pix_fmt,color_transfer",
    "-of", "json",
    file,
  ]);
  if (r.code !== 0) return null;
  try {
    const data = JSON.parse(r.out);
    const stream = (data.streams ?? [])[0];
    if (!stream?.codec_name) return null;
    return {
      codec: String(stream.codec_name).toLowerCase(),
      width: Number(stream.width) || 0,
      height: Number(stream.height) || 0,
      transfer: String(stream.color_transfer ?? "").toLowerCase(),
    };
  } catch {
    return null;
  }
}

/** HDR 传输特性：这类片子直接抽帧会发灰发暗，要先做色调映射。 */
const HDR_TRANSFERS = new Set(["smpte2084", "arib-std-b67"]);

/* ------------------------------------------------------------------ *
 * 封面 + 时长（服务端兜底）
 *
 * 上传时前端会用 <video> + canvas 抽一张封面，但浏览器解不了 HEVC/H.265，
 * 这类文件抽出来是空的（卡片只能显示胶片图标 + 短横线）。
 * 所以这里用 ffmpeg 再补一遍：前端成功的直接跳过，失败的兜底。
 * ------------------------------------------------------------------ */

/** 读总时长（秒）；读不到返回 0。 */
async function probeDuration(file) {
  const r = await spawnCapture(FFPROBE, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "json",
    file,
  ]);
  if (r.code !== 0) return 0;
  try {
    const duration = Number(JSON.parse(r.out)?.format?.duration);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch {
    return 0;
  }
}

/** 某一时刻画面的平均亮度（0-255）；读不到返回 -1。用来判断是不是黑场。 */
async function frameLuma(file, sec) {
  const r = await spawnCapture(FFMPEG, [
    "-hide_banner",
    "-ss", sec.toFixed(3),
    "-i", file,
    "-frames:v", "1",
    // 缩到 1 像素 + 灰度，再用 signalstats 打一个 YAVG（平均亮度）出来
    "-vf", "scale=1:1,format=gray,signalstats,metadata=print:key=lavfi.signalstats.YAVG",
    "-f", "null",
    "-",
  ]);
  const match = /lavfi\.signalstats\.YAVG=([0-9.]+)/.exec(`${r.err}\n${r.out}`);
  return match ? Number(match[1]) : -1;
}

/** 抽一帧存成 JPEG（640 宽、等比缩放）。HDR 片先做色调映射，否则图会灰蒙蒙。 */
async function extractCover(file, sec, outPath, hdr = false) {
  const plainVf = "scale=640:-2";
  const hdrVf =
    "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0," +
    "zscale=t=bt709:m=bt709:r=tv,format=yuv420p,scale=640:-2";
  const run = (vf) =>
    spawnCapture(FFMPEG, [
      "-y", "-v", "error",
      "-ss", sec.toFixed(3),
      "-i", file,
      "-frames:v", "1",
      "-vf", vf,
      "-q:v", "3",
      outPath,
    ]);
  let r = await run(hdr ? hdrVf : plainVf);
  if (r.code !== 0 && hdr) r = await run(plainVf); // 色调映射失败就退回普通抽帧
  return r.code === 0;
}

/**
 * 缺封面就补：挑一个不太暗的时间点抽帧，写 <原文件>.cover.jpg，顺便补齐 duration。
 * 已有封面 / 对象里已经存在封面文件时直接写库，不重抽。
 * 返回 true 表示最终有了封面。
 */
async function ensureCover(videoId) {
  const row = db
    .prepare("SELECT storage_path, cover_path, duration_seconds FROM videos WHERE id = ?")
    .get(videoId);
  if (!row) return false;
  const file = await locateObjectPath(row.storage_path);
  if (!file) return false;

  const coverKey = row.cover_path || `${row.storage_path}.cover.jpg`;
  const coverAbs = `${file}.cover.jpg`;

  let duration = Number(row.duration_seconds) || 0;
  if (!duration) duration = await probeDuration(file);

  let haveCover = Boolean(row.cover_path);
  if (!haveCover) {
    const preExisting = await locateObjectPath(coverKey);
    if (preExisting) {
      haveCover = true;
    } else {
      // HDR 片抽帧会发灰，先判一下要不要做色调映射
      const stream = await probeStream(file);
      const isHdr = HDR_TRANSFERS.has(stream?.transfer ?? "");
      // 默认取 1.5s（短视频取 10% 处），片头淡入黑场时往后再试几个点，取最亮的
      const baseSeek = duration > 15 ? 1.5 : Math.max(0.1, duration * 0.1);
      let bestSec = baseSeek;
      let bestLuma = await frameLuma(file, baseSeek);
      if (bestLuma >= 0 && bestLuma < 40 && duration > 3) {
        for (const ratio of [0.15, 0.25, 0.35, 0.5, 0.7]) {
          const sec = duration * ratio;
          const luma = await frameLuma(file, sec);
          if (luma > bestLuma) {
            bestLuma = luma;
            bestSec = sec;
          }
          if (luma >= 110) break;
        }
      }
      let ok = await extractCover(file, bestSec, coverAbs, isHdr);
      if (!ok) ok = await extractCover(file, 0, coverAbs, false); // 兜底首帧
      if (!ok) return false;
      haveCover = true;
      console.log(
        `[cover] 补封面 ${videoId} @ ${bestSec.toFixed(1)}s（亮度 ${Math.round(bestLuma)}${isHdr ? "，HDR 已映射" : ""}）`,
      );
    }
  }

  db.prepare("UPDATE videos SET cover_path = ?, duration_seconds = ? WHERE id = ?").run(
    haveCover ? coverKey : row.cover_path ?? null,
    duration > 0 ? duration : row.duration_seconds ?? null,
    videoId,
  );
  return haveCover;
}

/** 存量补封面：逐条补缺的，串行跑，避免抢 CPU。 */
async function backfillMissingCovers() {
  const rows = db.prepare("SELECT id, cover_path FROM videos").all();
  let fixed = 0;
  let had = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.cover_path) {
      // 封面字段有，但时长可能缺，顺手补一下
      const dur = db
        .prepare("SELECT duration_seconds FROM videos WHERE id = ?")
        .get(row.id)?.duration_seconds;
      if (!dur) {
        await ensureCover(row.id);
        had++;
      }
      continue;
    }
    const ok = await ensureCover(row.id);
    if (ok) fixed++;
    else failed++;
  }
  return { ok: true, checked: rows.length, fixed, had_cover: had, failed };
}


function setProxyStatus(id, status, proxyPath) {
  if (proxyPath === undefined) {
    db.prepare("UPDATE videos SET proxy_status = ? WHERE id = ?").run(status, id);
  } else {
    db.prepare("UPDATE videos SET proxy_status = ?, proxy_path = ? WHERE id = ?").run(status, proxyPath, id);
  }
}

/** 转一条：产出 <原文件>.web.mp4，成功才写 proxy_path。失败只改状态，绝不替换原片。 */
async function transcodeOne(videoId) {
  const row = db.prepare("SELECT storage_path FROM videos WHERE id = ?").get(videoId);
  if (!row) return;
  const file = await locateObjectPath(row.storage_path);
  if (!file) {
    setProxyStatus(videoId, "failed");
    return;
  }
  const stream = await probeStream(file);
  if (!stream) {
    setProxyStatus(videoId, "failed");
    return;
  }
  // 已经转过的直接标 ready，不重复跑
  const proxyKey = `${row.storage_path}.web.mp4`;
  const existing = await locateObjectPath(proxyKey);
  if (existing) {
    setProxyStatus(videoId, "ready", proxyKey);
    return;
  }

  setProxyStatus(videoId, "processing");
  const outAbs = `${file}.web.mp4`;
  const scale = stream.height > 1080
    ? "scale=-2:1080"
    : "scale=trunc(iw/2)*2:trunc(ih/2)*2";
  const started = Date.now();
  const r = await spawnCapture(FFMPEG, [
    "-y", "-v", "error",
    "-i", file,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p",
    "-vf", scale,
    "-c:a", "aac", "-b:a", "128k", "-ac", "2",
    "-movflags", "+faststart",
    outAbs,
  ]);
  if (r.code !== 0) {
    console.error(`[transcode] 失败 ${videoId}: ${String(r.err).slice(-300)}`);
    await fs.rm(outAbs, { force: true }).catch(() => {});
    setProxyStatus(videoId, "failed");
    return;
  }
  const stat = await fs.stat(outAbs).catch(() => null);
  if (!stat || stat.size < 1024) {
    await fs.rm(outAbs, { force: true }).catch(() => {});
    setProxyStatus(videoId, "failed");
    return;
  }
  setProxyStatus(videoId, "ready", proxyKey);
  console.log(
    `[transcode] 完成 ${videoId}，${Math.round((Date.now() - started) / 1000)}s，${(stat.size / 1048576).toFixed(1)}MB`,
  );
  // 转出来的这份是 H.264，抽帧百分百能成；万一前面没补上封面，这里再兜一次
  try {
    await ensureCover(videoId);
  } catch (cause) {
    console.error("[cover] 转码后补封面失败:", cause?.message ?? cause);
  }
}

async function drainTranscodeQueue() {
  if (transcodeRunning) return;
  transcodeRunning = true;
  try {
    while (transcodeQueue.length > 0) {
      const id = transcodeQueue.shift();
      try {
        await transcodeOne(id);
      } catch (cause) {
        console.error("[transcode] 队列异常:", cause?.message ?? cause);
        setProxyStatus(id, "failed");
      }
    }
  } finally {
    transcodeRunning = false;
  }
}

function enqueueTranscode(videoId) {
  const id = String(videoId);
  if (!transcodeQueue.includes(id)) transcodeQueue.push(id);
  setProxyStatus(id, "pending");
  void drainTranscodeQueue();
}

/** 新上传/新入库时判定：能在浏览器播的不动，放不了的自动排队转网页版。 */
function queueTranscodeIfNeeded(videoId) {
  // 不阻塞创建接口：探测和转码都在后台做
  setImmediate(async () => {
    try {
      const row = db.prepare("SELECT storage_path FROM videos WHERE id = ?").get(videoId);
      if (!row) return;
      const file = await locateObjectPath(row.storage_path);
      if (!file) return;
      const stream = await probeStream(file);
      if (!stream) return;
      if (BROWSER_OK_CODECS.has(stream.codec)) {
        setProxyStatus(videoId, null);
        return;
      }
      enqueueTranscode(videoId);
    } catch (cause) {
      console.error("[transcode] 入队判定失败:", cause?.message ?? cause);
    }
  });
}

/**
 * 入库后的后台处理：先补封面（用户几秒内就能看到图），再判编码决定要不要转网页版。
 * 两步互不影响，任何一步挂了都不影响记录本身。
 */
function postProcessVideo(videoId) {
  setImmediate(async () => {
    try {
      await ensureCover(videoId);
    } catch (cause) {
      console.error("[cover] 补封面失败:", cause?.message ?? cause);
    }
    queueTranscodeIfNeeded(videoId);
  });
}

/** 存量补转：逐个探测，只有浏览器放不了的编码才排队；H.264 一律标为「不需要网页版」。 */
async function enqueueAllNeedingWebVersion() {
  const rows = db
    .prepare("SELECT id, storage_path, proxy_status, proxy_path FROM videos")
    .all();
  let queued = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row.proxy_path) continue;
    if (row.proxy_status === "pending" || row.proxy_status === "processing") continue;
    const file = await locateObjectPath(row.storage_path);
    if (!file) continue;
    const stream = await probeStream(file);
    if (!stream) continue;
    if (BROWSER_OK_CODECS.has(stream.codec)) {
      setProxyStatus(row.id, null);
      skipped++;
      continue;
    }
    enqueueTranscode(row.id);
    queued++;
  }
  return { ok: true, checked: rows.length, queued, already_playable: skipped };
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const segments = url.pathname.split("/").filter(Boolean);

  try {
    if (segments[0] !== "api") {
      fail(res, 404, "未找到接口");
      return;
    }

    // /api/categories
    if (segments[1] === "categories") {
      const id = segments[2];
      if (req.method === "GET" && !id) {
        sendJson(res, 200, listCategories());
        return;
      }
      if (req.method === "POST" && !id) {
        const body = await readJsonBody(req);
        sendJson(res, 201, createCategory(body.name));
        return;
      }
      if (req.method === "PATCH" && id) {
        const body = await readJsonBody(req);
        const updated = patchCategory(id, body);
        if (!updated) fail(res, 404, "分类不存在。");
        else sendJson(res, 200, updated);
        return;
      }
      if (req.method === "DELETE" && id) {
        const removed = deleteCategory(id);
        if (!removed) fail(res, 404, "分类不存在。");
        else sendJson(res, 200, { ok: true });
        return;
      }
      fail(res, 405, "分类接口不支持该方法");
      return;
    }

    // /api/tags
    if (segments[1] === "tags") {
      const id = segments[2];
      if (req.method === "GET" && !id) {
        sendJson(res, 200, listTags());
        return;
      }
      if (req.method === "POST" && !id) {
        const body = await readJsonBody(req);
        sendJson(res, 201, ensureTag(body.name));
        return;
      }
      // 批量加/减标签：{ video_ids: [], tag_ids: [], mode: "add" | "remove" }
      if (req.method === "POST" && id === "bulk") {
        const body = await readJsonBody(req);
        sendJson(res, 200, bulkTagVideos(body.video_ids, body.tag_ids, body.mode));
        return;
      }
      if (req.method === "PATCH" && id) {
        const body = await readJsonBody(req);
        const updated = renameTag(id, body.name);
        if (!updated) fail(res, 404, "标签不存在。");
        else sendJson(res, 200, updated);
        return;
      }
      if (req.method === "DELETE" && id) {
        const removed = deleteTag(id);
        if (!removed) fail(res, 404, "标签不存在。");
        else sendJson(res, 200, { ok: true });
        return;
      }
      fail(res, 405, "标签接口不支持该方法");
      return;
    }

    // /api/videos
    if (segments[1] === "videos") {
      const id = segments[2];
      // PUT /api/videos/:id/tags —— 直接设置该视频的标签集合
      if (req.method === "PUT" && id && segments[3] === "tags") {
        const body = await readJsonBody(req);
        const updated = setVideoTags(id, body.tag_ids ?? []);
        if (!updated) fail(res, 404, "视频不存在。");
        else sendJson(res, 200, updated);
        return;
      }
      // POST /api/videos/bulk-category —— 批量把一批视频设为同一个分类（null = 未分类）
      if (req.method === "POST" && id === "bulk-category") {
        const body = await readJsonBody(req);
        sendJson(res, 200, bulkSetCategory(body.video_ids, body.category_id ?? null));
        return;
      }
      // POST /api/videos/backfill-covers —— 存量补封面（缺封面/缺时长的都补，后台串行跑）
      if (req.method === "POST" && id === "backfill-covers") {
        setImmediate(() => {
          backfillMissingCovers()
            .then((result) => {
              console.log(
                `[cover] 存量补封面完成：检查 ${result.checked}，补上 ${result.fixed}，补时长 ${result.had_cover}，失败 ${result.failed}`,
              );
            })
            .catch((cause) => {
              console.error("[cover] 存量补封面失败:", cause?.message ?? cause);
            });
        });
        sendJson(res, 202, { ok: true, started: true });
        return;
      }
      // POST /api/videos/web-version-all —— 存量扫描：给浏览器放不了的编码排队转网页版
      if (req.method === "POST" && id === "web-version-all") {
        // 扫描要逐个 ffprobe，放到后台跑，别把接口和其他请求一起堵住
        setImmediate(() => {
          enqueueAllNeedingWebVersion().catch((cause) => {
            console.error("[transcode] 存量扫描失败:", cause?.message ?? cause);
          });
        });
        sendJson(res, 202, { ok: true, started: true });
        return;
      }
      // POST /api/videos/:id/web-version —— 手动触发某条转网页版
      if (req.method === "POST" && id && segments[3] === "web-version") {
        const row = getVideo(id);
        if (!row) {
          fail(res, 404, "视频不存在。");
        } else {
          enqueueTranscode(id);
          sendJson(res, 202, getVideo(id));
        }
        return;
      }
      if (req.method === "GET" && !id) {
        sendJson(res, 200, listVideos());
        return;
      }
      if (req.method === "GET" && id) {
        const row = getVideo(id);
        if (!row) fail(res, 404, "视频不存在。");
        else sendJson(res, 200, row);
        return;
      }
      if (req.method === "POST" && !id) {
        const body = await readJsonBody(req);
        sendJson(res, 201, createVideo(body));
        return;
      }
      if (req.method === "PATCH" && id) {
        const body = await readJsonBody(req);
        const updated = patchVideo(id, body);
        if (!updated) fail(res, 404, "视频不存在。");
        else sendJson(res, 200, updated);
        return;
      }
      if (req.method === "DELETE" && id) {
        const removed = deleteVideo(id);
        if (!removed) {
          fail(res, 404, "视频不存在。");
        } else {
          await removeStoredObject(removed.storage_path);
          if (removed.cover_path) await removeStoredObject(removed.cover_path);
          if (removed.proxy_path) await removeStoredObject(removed.proxy_path);
          sendJson(res, 200, { ok: true });
        }
        return;
      }
      fail(res, 405, "视频接口不支持该方法");
      return;
    }

    if (segments[1] === "health") {
      sendJson(res, 200, { status: "ok", db: DB_PATH });
      return;
    }

    fail(res, 404, "未找到接口");
  } catch (cause) {
    fail(res, 400, cause instanceof Error ? cause.message : "请求处理失败");
  }
});

// 手机端随时可能中断请求，兜住连接层错误，别让单个坏连接带走整个服务。
server.on("clientError", (err, socket) => {
  socket.destroy();
  if (err?.code !== "ECONNRESET" && err?.code !== "EPIPE") {
    console.error("[api] 连接异常:", err?.message ?? err);
  }
});

process.on("uncaughtException", (err) => {
  console.error("[api] 已忽略未捕获异常:", err?.message ?? err);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[api] listening on http://127.0.0.1:${PORT}`);
  console.log(`[api] database: ${DB_PATH}`);
});
