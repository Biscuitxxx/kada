// 对象存储上传实现：与 supabaseUploadService 同接口（FileUploadService），
// 底层换成 S3 兼容写入，不依赖任何云 SDK。
// 配置来源：src/lib/storage.ts（VITE_S3_ENDPOINT / VITE_S3_BUCKET）。

import {
  assertAllowedExtension,
  getFileExtension,
  normalizeAllowedExtensions,
  normalizeAllowedMimeTypes,
  sanitizeDownloadName,
  sanitizeObjectName,
} from "./filePolicy";
import { STORAGE_BUCKET, getObjectSize, objectUrl, putObject, removeObjects } from "@/lib/storage";
import {
  FileUploadError,
  type AccessUrlOptions,
  type FileUploadService,
  type UploadFile,
  type UploadOptions,
  type UploadedFile,
  type UploadVisibility,
} from "./types";

export interface ObjectStoreUploadServiceConfig {
  /** 覆盖默认桶名；不填则用 VITE_S3_BUCKET。 */
  bucket?: string;
  /** 对象路径前缀，默认 uploads。 */
  pathPrefix?: string;
  visibility?: UploadVisibility;
  /** 单文件上限；不填或传 Infinity 表示不限（只受磁盘空间限制）。 */
  maxFileSizeBytes?: number;
  allowedExtensions?: readonly string[];
  allowedMimeTypes?: readonly string[];
}

interface NormalizedConfig {
  bucket: string;
  pathPrefix: string;
  visibility: UploadVisibility;
  maxFileSizeBytes: number;
  allowedExtensions: readonly string[] | undefined;
  allowedMimeTypes: readonly string[] | undefined;
}

const EXTENSION_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

function invalid(message: string): FileUploadError {
  return new FileUploadError("INVALID_CONFIGURATION", message);
}

function normalizePathPrefix(value: string | undefined): string {
  const prefix = (value ?? "uploads").trim().replace(/^\/+|\/+$/g, "");
  if (
    !prefix
    || prefix.length > 128
    || prefix.includes("..")
    || prefix.split("/").some((segment) => !/^[A-Za-z0-9_-]{1,64}$/.test(segment))
  ) {
    throw invalid("对象路径前缀无效。");
  }
  return prefix;
}

function normalizeConfig(config: ObjectStoreUploadServiceConfig): NormalizedConfig {
  if (!config || typeof config !== "object") {
    throw invalid("文件上传配置无效。");
  }
  const bucket = (config.bucket ?? STORAGE_BUCKET).trim();
  const visibility = config.visibility ?? "public";
  // 默认不限体积：单文件上限只由磁盘空间决定（本地存储没有平台配额）。
  const maxFileSizeBytes = config.maxFileSizeBytes ?? Number.POSITIVE_INFINITY;
  if (
    !EXTENSION_PATTERN.test(bucket.replace(/\./g, ""))
    || bucket.length > 63
    || !["public", "private"].includes(visibility)
    || typeof maxFileSizeBytes !== "number"
    || Number.isNaN(maxFileSizeBytes)
    || maxFileSizeBytes <= 0
  ) {
    throw invalid("文件上传配置无效。");
  }
  if (bucket !== STORAGE_BUCKET) {
    throw invalid("上传桶名与对象存储配置不一致。");
  }
  return {
    bucket,
    pathPrefix: normalizePathPrefix(config.pathPrefix),
    visibility,
    maxFileSizeBytes,
    allowedExtensions: normalizeAllowedExtensions(config.allowedExtensions),
    allowedMimeTypes: normalizeAllowedMimeTypes(config.allowedMimeTypes),
  };
}

let fallbackSequence = 0;

function createUniqueSegment(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid.toLowerCase();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }
  const sequence = (fallbackSequence++).toString(36);
  return `${Date.now().toString(36)}-${sequence}-${Math.random().toString(36).slice(2)}`;
}

function createObjectPath(
  config: NormalizedConfig,
  originalName: string,
): string {
  return `${config.pathPrefix}/${createUniqueSegment()}-${sanitizeObjectName(originalName)}`;
}

function normalizeMimeType(file: UploadFile): string {
  const mimeType = (file.type ?? "").trim().toLowerCase() || "application/octet-stream";
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mimeType)) {
    throw new FileUploadError("INVALID_FILE_TYPE", "文件 MIME 类型无效。");
  }
  return mimeType;
}

function safeObjectPath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 1024
    && !value.startsWith("/")
    && !value.endsWith("/")
    && !value.includes("\\")
    && !value.includes("..")
    && !value.includes("//")
    && !/[\u0000-\u001f\u007f]/.test(value)
    && value.split("/").every((segment) => segment.length > 0);
}

function uploadFailed(cause: unknown, bucket: string, objectPath: string): FileUploadError {
  return new FileUploadError(
    "STORAGE_UPLOAD_FAILED",
    "文件对象写入结果未知；请保留对象引用并核验。",
    { recoverable: true, bucket, objectPath, resultUnknown: true, cause },
  );
}

/** 浏览器 File/Blob 可直接交给 XHR 流式发送，不必先读进 JS 堆（大文件关键）。 */
function isBlobLike(file: UploadFile): boolean {
  const candidate = file as unknown as Partial<Blob>;
  return typeof candidate.slice === "function" && typeof candidate.stream === "function";
}

function clampProgress(uploadedBytes: number, totalBytes: number) {  const total = Math.max(1, totalBytes);
  const uploaded = Math.min(Math.max(0, uploadedBytes), total);
  return {
    uploadedBytes: uploaded,
    totalBytes: total,
    percentage: Math.round((uploaded / total) * 100),
  };
}

export function createObjectStoreUploadService(
  rawConfig: ObjectStoreUploadServiceConfig = {},
): FileUploadService {
  const config = normalizeConfig(rawConfig);
  let disposed = false;
  let unknownUploads = new WeakMap<FileUploadError, {
    size: number;
    reference: UploadedFile;
  }>();

  const notify = (
    callback: UploadOptions["onProgress"],
    uploadedBytes: number,
    totalBytes: number,
  ): void => {
    if (!callback) return;
    callback(clampProgress(uploadedBytes, totalBytes));
  };

  return {
    async upload(file: UploadFile, options: UploadOptions = {}): Promise<UploadedFile> {
      if (disposed) throw new FileUploadError("AUTH_CHANGED", "上传服务已释放。");
      if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function") {
        throw new FileUploadError("INVALID_FILE", "文件对象无效。");
      }
      if (!Number.isSafeInteger(file.size) || file.size <= 0) {
        throw new FileUploadError("INVALID_FILE", "不能上传空文件。");
      }
      if (Number.isFinite(config.maxFileSizeBytes) && file.size > config.maxFileSizeBytes) {
        throw new FileUploadError("FILE_TOO_LARGE", "文件超过允许的大小上限。");
      }
      const originalName = sanitizeDownloadName(typeof file.name === "string" ? file.name : "upload");
      const extension = getFileExtension(originalName);
      assertAllowedExtension(extension, config.allowedExtensions);
      const mimeType = normalizeMimeType(file);
      if (config.allowedMimeTypes && !config.allowedMimeTypes.includes(mimeType)) {
        throw new FileUploadError("INVALID_FILE_TYPE", "当前文件 MIME 类型不在允许范围内。");
      }

      const objectPath = createObjectPath(config, originalName);
      const reference: UploadedFile = Object.freeze({
        bucket: config.bucket,
        objectPath,
        originalName,
        size: file.size,
        mimeType,
        visibility: config.visibility,
      });

      // 大文件不读进内存：浏览器 File/Blob 交给 XHR 直接流式发送（仍能拿到进度）。
      // 只有当调用方传的是纯 UploadFile（不具备 Blob 能力）时才退化为 arrayBuffer。
      notify(options.onProgress, 0, file.size);
      let body: Blob | ArrayBuffer;
      try {
        body = isBlobLike(file) ? (file as unknown as Blob) : await file.arrayBuffer();
      } catch (cause) {
        throw new FileUploadError("INVALID_FILE", "读取文件内容失败。", { cause });
      }
      try {
        await putObject(objectPath, body, mimeType, (progress) => {
          notify(options.onProgress, progress.uploadedBytes, progress.totalBytes);
        });
      } catch (cause) {
        const failure = uploadFailed(cause, config.bucket, objectPath);
        unknownUploads.set(failure, { size: file.size, reference });
        throw failure;
      }
      notify(options.onProgress, file.size, file.size);
      return reference;
    },

    async verifyUpload(error: FileUploadError): Promise<UploadedFile> {
      if (disposed) throw new FileUploadError("AUTH_CHANGED", "上传服务已释放。");
      const retained = unknownUploads.get(error);
      if (!retained) {
        throw new FileUploadError("UPLOAD_VERIFICATION_FAILED", "缺少本次上传核验现场，请保持未确认状态。");
      }
      try {
        // 只核验对象是否存在且长度一致，不把文件内容下载回来（大文件才扛得住）。
        const actualSize = await getObjectSize(retained.reference.objectPath);
        if (!Number.isFinite(actualSize) || actualSize !== retained.size) {
          throw new Error("Stored object size differs from the original upload");
        }
        return retained.reference;
      } catch (cause) {
        throw new FileUploadError(
          "UPLOAD_VERIFICATION_FAILED",
          "上传尚未确认；保留原现场，只读核验失败。",
          {
            bucket: config.bucket,
            objectPath: retained.reference.objectPath,
            resultUnknown: true,
            recoverable: true,
            cause,
          },
        );
      }
    },

    async getAccessUrl(reference: UploadedFile, options: AccessUrlOptions = {}): Promise<string> {
      if (disposed) throw new FileUploadError("AUTH_CHANGED", "上传服务已释放。");
      if (
        !reference
        || reference.bucket !== config.bucket
        || !safeObjectPath(reference.objectPath)
      ) {
        throw new FileUploadError("ACCESS_URL_FAILED", "文件引用不属于当前上传配置。");
      }
      return objectUrl(
        reference.objectPath,
        options.download ? sanitizeDownloadName(reference.originalName) : undefined,
      );
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      unknownUploads = new WeakMap();
    },
  };
}

/** 供业务层清理对象用；对象存储删除失败不抛错，返回失败路径。 */
export async function removeVideoObjects(paths: readonly string[]): Promise<string[]> {
  return removeObjects(paths);
}
