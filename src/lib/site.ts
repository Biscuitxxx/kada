// 视频库站点级共享契约：类型、格式化、数据访问层。无 JSX。
// 元数据走本机 SQLite API（/api，vite 代理到 127.0.0.1:8787），文件走本地对象存储。
import type { UploadedFile } from "@/features/file-upload";
import { putObject, objectUrl, removeObjects } from "@/lib/storage";

export const APP_NAME = "咔哒 · 我的视频库";
export const VIDEO_BUCKET_ID = "video-library";

// 单文件体积不再设限：本地对象存储只受磁盘剩余空间限制。
// 需要限流时，给 createObjectStoreUploadService 传 maxFileSizeBytes 即可。

export const VIDEO_EXTENSIONS = [
  "mp4", "mov", "webm", "m4v", "avi", "mkv", "mpeg", "mpg", "3gp",
];

export function isVideoFile(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTENSIONS.includes(ext);
}

export interface CategoryRow {
  id: string;
  name: string;
  sort_order: number;
  is_default: boolean;
}

export interface TagRow {
  id: string;
  name: string;
  created_at: string;
  video_count: number;
}

export interface VideoRow {
  id: string;
  title: string;
  original_name: string;
  category_id: string | null;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  duration_seconds: number | null;
  cover_path: string | null;
  folder_hint: string | null;
  created_at: string;
  /** 浏览器友好版（H.264）对象路径；HEVC 等放不了的编码由服务端转出来，为空表示没转/不需要 */
  proxy_path?: string | null;
  /** 网页版状态：pending / processing / ready / failed；null 表示原片浏览器就能播 */
  proxy_status?: "pending" | "processing" | "ready" | "failed" | null;
  /** 该视频身上的标签 id（标签名从 tags 表映射） */
  tag_ids: string[];
}

export interface VideoView extends VideoRow {
  categoryName: string;
  /** 已解析好的标签（id + 展示名），卡片与详情页直接用 */
  tags: TagRow[];
}

export type SortKey = "newest" | "oldest" | "title";

/* ── 格式化 ─────────────────────────────────────────────── */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "--:--";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

export function titleFromFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).trim() || name;
}

/** 从 webkitRelativePath 提取第一层目录名作为建议分类 */
export function folderHintOf(file: File): string | null {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
  if (!rel) return null;
  const parts = rel.split("/");
  return parts.length > 1 ? parts[parts.length - 2] : null;
}

/* ── 数据访问（本机 SQLite API） ───────────────────────── */

const API_BASE = "/api";

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (cause) {
    throw new Error(`本地数据服务不可用：${cause instanceof Error ? cause.message : "网络错误"}`);
  }
  if (!response.ok) {
    let message = `请求失败：HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) message = payload.error;
    } catch {
      // 保留默认信息
    }
    throw new Error(message);
  }
  if (response.status === 204) return null as T;
  return (await response.json()) as T;
}

export async function fetchCategories(): Promise<CategoryRow[]> {
  return apiRequest<CategoryRow[]>("/categories");
}

export async function createCategory(name: string): Promise<CategoryRow> {
  return apiRequest<CategoryRow>("/categories", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function renameCategory(id: string, name: string): Promise<void> {
  await apiRequest<CategoryRow>(`/categories/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

/** 删除分类：后端把该分类下的视频设为未分类（等价原 ON DELETE SET NULL） */
export async function deleteCategory(id: string): Promise<void> {
  await apiRequest<{ ok: boolean }>(`/categories/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* ── 标签 ───────────────────────────────────────────────── */

export async function fetchTags(): Promise<TagRow[]> {
  return apiRequest<TagRow[]>("/tags");
}

/** 新建标签：同名（归一化后）后端直接复用已有标签，不报错 */
export async function createTag(name: string): Promise<TagRow> {
  return apiRequest<TagRow>("/tags", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function renameTag(id: string, name: string): Promise<TagRow> {
  return apiRequest<TagRow>(`/tags/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

/** 删除标签：只解除它与视频的关联，视频本身保留 */
export async function deleteTag(id: string): Promise<void> {
  await apiRequest<{ ok: boolean }>(`/tags/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** 直接设置某个视频的标签集合（详情页单条增删用） */
export async function setVideoTags(videoId: string, tagIds: string[]): Promise<void> {
  await apiRequest<VideoRow>(`/videos/${encodeURIComponent(videoId)}/tags`, {
    method: "PUT",
    body: JSON.stringify({ tag_ids: tagIds }),
  });
}

/** 批量加/减标签（上传弹窗统一打标签、首页多选用） */
export async function bulkTagVideos(
  videoIds: string[],
  tagIds: string[],
  mode: "add" | "remove",
): Promise<void> {
  await apiRequest<{ ok: boolean }>("/tags/bulk", {
    method: "POST",
    body: JSON.stringify({ video_ids: videoIds, tag_ids: tagIds, mode }),
  });
}

/** 批量把一批视频设为同一个分类（null = 未分类）；分类是单选，所以语义是「整批改成」 */
export async function bulkSetCategory(videoIds: string[], categoryId: string | null): Promise<void> {
  await apiRequest<{ ok: boolean }>("/videos/bulk-category", {
    method: "POST",
    body: JSON.stringify({ video_ids: videoIds, category_id: categoryId }),
  });
}

export async function fetchVideos(): Promise<VideoRow[]> {
  return apiRequest<VideoRow[]>("/videos");
}

export async function fetchVideoById(id: string): Promise<VideoRow | null> {
  try {
    return await apiRequest<VideoRow>(`/videos/${encodeURIComponent(id)}`);
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes("404")) return null;
    throw new Error(`读取视频失败：${cause instanceof Error ? cause.message : "未知错误"}`);
  }
}

/** 上传成功后写入业务记录；返回精确回执行 */
export async function insertVideoRecord(params: {
  ref: UploadedFile;
  title: string;
  categoryId: string | null;
  durationSeconds: number | null;
  coverPath: string | null;
  folderHint: string | null;
}): Promise<VideoRow> {
  const { ref } = params;
  const row = await apiRequest<VideoRow>("/videos", {
    method: "POST",
    body: JSON.stringify({
      title: params.title,
      original_name: ref.originalName,
      category_id: params.categoryId,
      storage_path: ref.objectPath,
      mime_type: ref.mimeType || "video/mp4",
      size_bytes: ref.size,
      duration_seconds: params.durationSeconds,
      cover_path: params.coverPath,
      folder_hint: params.folderHint,
    }),
  });
  if (!row) throw new Error("视频记录写入未确认，请重试关联");
  return row;
}

export async function updateVideo(
  id: string,
  patch: Partial<Pick<VideoRow, "title" | "category_id">>,
): Promise<void> {
  await apiRequest<VideoRow>(`/videos/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** 删除业务行 + 对象存储里的视频文件与封面 */
export async function deleteVideo(row: VideoRow): Promise<void> {
  await apiRequest<{ ok: boolean }>(`/videos/${encodeURIComponent(row.id)}`, { method: "DELETE" });
  const paths = [row.storage_path, row.cover_path].filter(Boolean) as string[];
  if (paths.length > 0) {
    const failed = await removeObjects(paths);
    if (failed.length > 0) console.warn("对象存储清理待重试:", failed.join(", "));
  }
}

/* ── 对象存储地址（公开桶，直接构造公共 URL） ───────────── */

export function publicUrl(path: string): string {
  return objectUrl(path);
}

/* ── 客户端媒体探测：时长 + 封面截帧 ────────────────────── */

interface ProbeResult {
  duration: number | null;
  coverBlob: Blob | null;
}

function probeVideo(file: File): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    let settled = false;
    const finish = (r: ProbeResult) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(r);
    };
    const grab = () => {
      try {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 640 / (video.videoWidth || 640));
        canvas.width = Math.max(1, Math.round((video.videoWidth || 640) * scale));
        canvas.height = Math.max(1, Math.round((video.videoHeight || 360) * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return finish({ duration: finiteOrNull(video.duration), coverBlob: null });
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => finish({ duration: finiteOrNull(video.duration), coverBlob: blob }),
          "image/jpeg",
          0.72,
        );
      } catch {
        finish({ duration: finiteOrNull(video.duration), coverBlob: null });
      }
    };
    video.addEventListener("loadeddata", () => {
      const d = video.duration;
      const target = Number.isFinite(d) && d > 2 ? Math.min(1.5, d * 0.1) : 0.1;
      video.currentTime = target;
    });
    video.addEventListener("seeked", grab, { once: true });
    video.addEventListener("loadeddata", () => {
      // 无法 seek 的编码：直接用当前帧
      window.setTimeout(grab, 1200);
    });
    video.addEventListener("error", () => finish({ duration: null, coverBlob: null }));
    // 15s → 6s：HEVC 这类浏览器解不了的编码会一直挂着，等下去没意义，
    // 封面和时长交给服务端的 ffmpeg 兜底（server/api.mjs 的 ensureCover）
    window.setTimeout(() => finish({ duration: null, coverBlob: null }), 6000);
    video.src = url;
  });
}

function finiteOrNull(n: number): number | null {
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : null;
}

/** 探测 + 上传封面，返回可入库字段 */
export async function prepareMediaMeta(
  file: File,
  objectPathOfVideo: string,
): Promise<{ duration: number | null; coverPath: string | null }> {
  const { duration, coverBlob } = await probeVideo(file);
  if (!coverBlob) return { duration, coverPath: null };
  const coverPath = `${objectPathOfVideo}.cover.jpg`;
  try {
    await putObject(coverPath, coverBlob, "image/jpeg");
  } catch {
    return { duration, coverPath: null };
  }
  return { duration, coverPath };
}
