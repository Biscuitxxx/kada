#!/usr/bin/env node
/**
 * 咔哒 · 历史重复视频清理（纯手动、一次性脚本）
 *
 * 规则：
 *   - 按 videos.original_name + size_bytes 分组，保留 created_at 最早的一条，其余为待删；
 *   - 默认 dry-run，只打印「保留哪条 / 删哪条」，一个字节都不动；
 *   - --md5 下载对象算 md5 做二次确认（--apply 时强制开启，字节不一致绝不删）；
 *   - 只有显式 --apply 才调用 DELETE /api/videos/:id 和 DELETE /storage/<bucket>/<key>；
 *   - 不碰 .data/ 文件本身、不改 server/*、不接入启动流程或任何定时任务。
 *
 * 用法：
 *   node scripts/find-duplicates.mjs                 # dry-run
 *   node scripts/find-duplicates.mjs --md5           # dry-run + md5
 *   node scripts/find-duplicates.mjs --apply         # 真正删除（自带 md5 确认）
 *
 * 环境变量（默认都指向本机）：
 *   KADA_BASE=http://127.0.0.1:3015   统一入口（/api 与 /storage 由 vite 转发）
 *   KADA_API_BASE / KADA_STORAGE_BASE 分开指定两个服务时用
 *   KADA_BUCKET=video-library          桶名
 *
 * 注意：当前 GET /api/videos 最多返回 1000 条；库超过 1000 时脚本会明确告警。
 */

import { createHash } from "node:crypto";

const args = new Set(process.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
  console.log("用法：node scripts/find-duplicates.mjs [--md5] [--apply]");
  process.exit(0);
}
const unknown = [...args].filter((flag) => flag !== "--md5" && flag !== "--apply");
if (unknown.length > 0) {
  console.error(`未知参数：${unknown.join(", ")}（只支持 --md5 / --apply）`);
  process.exit(2);
}

const apply = args.has("--apply");
const verifyMd5 = args.has("--md5") || apply; // 真删必须二次确认
const apiBase = (process.env.KADA_API_BASE || process.env.KADA_BASE || "http://127.0.0.1:3015").replace(/\/+$/, "");
const storageBase = (process.env.KADA_STORAGE_BASE || process.env.KADA_BASE || "http://127.0.0.1:3015").replace(/\/+$/, "");
const bucket = process.env.KADA_BUCKET || "video-library";

// 这个脚本会删数据：默认只准指向本机，避免误连到别的机器。
for (const [label, base] of [["API", apiBase], ["对象存储", storageBase]]) {
  const host = new URL(base).hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)
    && process.env.KADA_ALLOW_REMOTE !== "1") {
    console.error(`${label} 地址不是本机：${base}（如确需远程请显式设 KADA_ALLOW_REMOTE=1）`);
    process.exit(2);
  }
}

function encodeKey(key) {
  return String(key).split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

/** 与 src/lib/storage.ts objectUrl() 一致：/<bucket>/<key>，key 逐段转义 */
function objectUrl(key) {
  return `${storageBase}/storage/${encodeURIComponent(bucket)}/${encodeKey(key)}`;
}

async function getJson(url, timeoutMs = 20_000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`GET ${url} 失败：HTTP ${response.status}`);
  return response.json();
}

async function md5Of(key) {
  const response = await fetch(objectUrl(key), { signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const hash = createHash("md5");
  for await (const chunk of response.body) hash.update(chunk);
  return hash.digest("hex");
}

async function removeRecord(id) {
  const response = await fetch(`${apiBase}/api/videos/${encodeURIComponent(id)}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

async function removeObject(key) {
  const response = await fetch(objectUrl(key), {
    method: "DELETE",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);
}

function keepFirst(rows) {
  return [...rows].sort(
    (a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))
      || String(a.id).localeCompare(String(b.id)),
  );
}

async function main() {
  console.log(`目标：API ${apiBase} / 对象存储 ${storageBase} / 桶 ${bucket}`);
  console.log(apply ? "模式：APPLY（会删除）" : "模式：DRY RUN（只读，不删除）");

  const rows = await getJson(`${apiBase}/api/videos`);
  if (!Array.isArray(rows)) throw new Error("GET /api/videos 返回的不是数组");
  console.log(`扫描记录：${rows.length}`);
  if (rows.length >= 1000) {
    console.warn("警告：接口单页上限 1000 条，可能有更老的记录没扫到；本脚本不改 server，请先自行分批。");
  }

  const groups = new Map();
  for (const row of rows) {
    const key = `${row.original_name}|${row.size_bytes}`;
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { name: row.original_name, size: row.size_bytes, rows: [row] });
  }
  const duplicates = [...groups.values()].filter((group) => group.rows.length > 1);
  if (duplicates.length === 0) {
    console.log("\n没有发现同名同大小的重复记录。");
    return;
  }

  let planned = 0;
  let deleted = 0;
  for (const group of duplicates) {
    const ordered = keepFirst(group.rows);
    const [keep, ...drops] = ordered;
    console.log(`\n=== ${group.name} | ${group.size} B | ${ordered.length} 条 ===`);
    console.log(`保留 ${keep.id}  created=${keep.created_at}  key=${keep.storage_path}`);

    let keepMd5 = null;
    if (verifyMd5) {
      try {
        keepMd5 = await md5Of(keep.storage_path);
        console.log(`保留对象 md5=${keepMd5}`);
      } catch (cause) {
        console.warn(`保留对象 md5 读取失败：${cause.message}；本组不删任何记录。`);
        continue;
      }
    }

    for (const row of drops) {
      let md5 = "-";
      if (verifyMd5) {
        try {
          md5 = await md5Of(row.storage_path);
        } catch (cause) {
          console.warn(`跳过 ${row.id}：对象 md5 读取失败（${cause.message}）`);
          continue;
        }
        if (md5 !== keepMd5) {
          console.warn(`跳过 ${row.id}：md5=${md5} 与保留对象不同，判定为同名同大小但内容不同`);
          continue;
        }
      }
      planned += 1;
      console.log(`${apply ? "删除" : "将删除"} ${row.id}  created=${row.created_at}  key=${row.storage_path}  md5=${md5}`);
      if (!apply) continue;

      try {
        await removeRecord(row.id);
        const objects = [row.storage_path, row.cover_path].filter(Boolean);
        for (const key of objects) {
          try {
            await removeObject(key);
          } catch (cause) {
            console.warn(`  对象删除失败，请手动处理：${key}（${cause.message}）`);
          }
        }
        deleted += 1;
      } catch (cause) {
        console.warn(`  记录删除失败，对象未动：${row.id}（${cause.message}）`);
      }
    }
  }

  console.log(`\n汇总：重复组 ${duplicates.length}，${apply ? `已删除 ${deleted}` : `待删除 ${planned}`} 条记录。`);
  if (!apply) console.log("以上均为预演；确认无误后显式加 --apply 才会真正删除。");
}

main().catch((cause) => {
  console.error(`失败：${cause instanceof Error ? cause.message : String(cause)}`);
  process.exit(1);
});
