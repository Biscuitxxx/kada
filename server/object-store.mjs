// 本地对象存储服务：S3/MinIO 兼容的 URL 布局（/<bucket>/<key>），供本地开发使用。
// 换成真正的 MinIO（本机或 NAS）后把 VITE_S3_ENDPOINT 指过去即可，前端不用改。
//
// 用法： node server/object-store.mjs
// 可配置环境变量：
//   OBJECT_STORE_PORT  监听端口（默认 9000，与 MinIO 默认 API 端口一致）
//   OBJECT_STORE_DATA  数据目录（默认 .data/objects）
//   OBJECT_STORE_BUCKETS 允许的桶名，逗号分隔（默认 video-library）

import { createServer } from "node:http";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.OBJECT_STORE_PORT ?? 9000);
const DATA_ROOT = path.resolve(process.env.OBJECT_STORE_DATA ?? path.join(here, "..", ".data", "objects"));
const BUCKETS = (process.env.OBJECT_STORE_BUCKETS ?? "video-library")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean)
  .filter((item) => /^[a-z0-9][a-z0-9._-]{0,99}$/i.test(item));

const MIME_BY_EXT = new Map(Object.entries({
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mpg": "video/mpeg",
  ".mpeg": "video/mpeg",
  ".3gp": "video/3gpp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
}));

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range, If-None-Match, X-Requested-With",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, ETag",
  "Access-Control-Max-Age": "86400",
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

/** 把 URL 路径解析成磁盘路径，并拒绝越界访问。 */
function resolveObjectPath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const segments = decoded.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 2) return { error: "缺少桶名或对象键", status: 400 };
  const bucket = segments[0];
  if (!BUCKETS.includes(bucket)) return { error: `桶不存在：${bucket}`, status: 404 };
  if (segments.some((segment) => segment === ".." || segment === "." || segment.includes("\\"))) {
    return { error: "非法对象键", status: 400 };
  }
  const target = path.resolve(DATA_ROOT, bucket, ...segments.slice(1));
  const bucketRoot = path.resolve(DATA_ROOT, bucket);
  if (target !== bucketRoot && !target.startsWith(bucketRoot + path.sep)) {
    return { error: "非法对象键", status: 400 };
  }
  return { bucket, key: segments.slice(1).join("/"), target };
}

function contentTypeOf(key) {
  const ext = path.extname(key).toLowerCase();
  return MIME_BY_EXT.get(ext) ?? "application/octet-stream";
}

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;
  let start;
  let end;
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

/**
 * 把文件流式发给响应，并吞掉「客户端中途断开」这类错误。
 * 播放器拖进度条、关标签页、手机切后台都会让连接突然断开，此前没兜底会让整个进程退出。
 */
function pipeFileToResponse(fileStream, res) {
  fileStream.on("error", () => {
    // 读盘出错或被提前销毁，连接已经废了，安静收尾即可
    res.destroy();
  });
  res.on("error", () => {
    fileStream.destroy();
  });
  res.on("close", () => {
    if (!res.writableEnded) fileStream.destroy();
  });
  fileStream.pipe(res);
}

async function handleRead(req, res, target, key, headOnly) {
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    sendJson(res, 404, { error: "对象不存在" });
    return;
  }
  if (!stat.isFile()) {
    sendJson(res, 404, { error: "对象不存在" });
    return;
  }
  const baseHeaders = {
    ...CORS_HEADERS,
    "Content-Type": contentTypeOf(key),
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=300",
    ETag: `"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`,
  };
  const range = parseRange(req.headers.range, stat.size);
  if (range) {
    const { start, end } = range;
    res.writeHead(206, {
      ...baseHeaders,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Content-Length": String(end - start + 1),
    });
    if (headOnly) {
      res.end();
      return;
    }
    pipeFileToResponse(createReadStream(target, { start, end }), res);
    return;
  }
  res.writeHead(200, { ...baseHeaders, "Content-Length": String(stat.size) });
  if (headOnly) {
    res.end();
    return;
  }
  pipeFileToResponse(createReadStream(target), res);
}

async function handleWrite(req, res, target, key) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporaryPath = `${target}.part-${process.pid}-${Date.now()}`;
  try {
    await new Promise((resolve, reject) => {
      const sink = createWriteStream(temporaryPath);
      sink.on("finish", resolve);
      sink.on("error", reject);
      req.on("error", reject);
      req.pipe(sink);
    });
  } catch (cause) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    sendJson(res, 500, { error: `对象写入失败：${cause.message}` });
    return;
  }
  try {
    await fs.rename(temporaryPath, target);
  } catch (cause) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    sendJson(res, 500, { error: `对象落盘失败：${cause.message}` });
    return;
  }
  const stat = await fs.stat(target);
  sendJson(res, 200, { key, size: stat.size });
}

async function handleDelete(res, target) {
  try {
    await fs.unlink(target);
    res.writeHead(204, CORS_HEADERS);
    res.end();
  } catch (cause) {
    if (cause?.code === "ENOENT") {
      res.writeHead(404, { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "对象不存在" }));
      return;
    }
    sendJson(res, 500, { error: `对象删除失败：${cause.message}` });
  }
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/" || url.pathname === "/healthz") {
    sendJson(res, 200, {
      status: "ok",
      buckets: BUCKETS,
      dataDir: DATA_ROOT,
      mode: "local-object-store (S3/MinIO compatible path layout)",
    });
    return;
  }

  const resolved = resolveObjectPath(url.pathname);
  if (resolved.error) {
    sendJson(res, resolved.status ?? 400, { error: resolved.error });
    return;
  }

  const { target, key } = resolved;
  switch (req.method) {
    case "GET":
      await handleRead(req, res, target, key, false);
      break;
    case "HEAD":
      await handleRead(req, res, target, key, true);
      break;
    case "PUT":
      await handleWrite(req, res, target, key);
      break;
    case "DELETE":
      await handleDelete(res, target);
      break;
    default:
      sendJson(res, 405, { error: `不支持的方法：${req.method}` });
  }
});

// 播放器中途断开时，socket 层可能抛出 ECONNRESET 之类的事件；
// 这里兜住，避免单个坏连接把整个服务带走（服务挂了手机上什么都看不到）。
server.on("clientError", (err, socket) => {
  if (err?.code === "ECONNRESET" || err?.code === "EPIPE") {
    socket.destroy();
    return;
  }
  try {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  } catch {
    socket.destroy();
  }
});

process.on("uncaughtException", (err) => {
  console.error("[object-store] 已忽略未捕获异常:", err?.message ?? err);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[object-store] listening on http://0.0.0.0:${PORT}`);
  console.log(`[object-store] buckets: ${BUCKETS.join(", ")}`);
  console.log(`[object-store] data dir: ${DATA_ROOT}`);
});
