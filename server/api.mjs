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
`);

// 兜底分类：与原先「未分类」默认分类对齐。
const seedName = "未分类";
const existingDefault = db.prepare("SELECT id FROM video_categories WHERE name = ?").get(seedName);
if (!existingDefault) {
  db.prepare(
    "INSERT INTO video_categories (id, name, sort_order, is_default, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(randomUUID(), seedName, 0, 1, new Date().toISOString());
}

const VIDEO_COLS =
  "id, title, original_name, category_id, storage_path, mime_type, size_bytes, duration_seconds, cover_path, folder_hint, created_at";

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

function asVideo(row) {
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
  };
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

function listVideos() {
  return db
    .prepare(`SELECT ${VIDEO_COLS} FROM videos ORDER BY created_at DESC LIMIT 1000`)
    .all()
    .map(asVideo);
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
    `INSERT INTO videos (${VIDEO_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id, row.title, row.original_name, row.category_id, row.storage_path, row.mime_type,
    row.size_bytes, row.duration_seconds, row.cover_path, row.folder_hint, row.created_at,
  );
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
  const existing = db.prepare("SELECT id FROM videos WHERE id = ?").get(id);
  if (!existing) return false;
  db.prepare("DELETE FROM videos WHERE id = ?").run(id);
  return true;
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

    // /api/videos
    if (segments[1] === "videos") {
      const id = segments[2];
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
        if (!removed) fail(res, 404, "视频不存在。");
        else sendJson(res, 200, { ok: true });
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
