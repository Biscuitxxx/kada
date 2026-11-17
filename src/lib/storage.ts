// 对象存储适配层：采用 S3 兼容的路径布局（MinIO 匿名桶 / 自建对象存储 / 本地对象服务通用）。
// 后端地址与桶名全部走环境变量，换存储只需改 .env，业务代码无需改动：
//   VITE_S3_ENDPOINT=http://127.0.0.1:9000
//   VITE_S3_BUCKET=video-library

interface StorageEnv {
  readonly VITE_S3_ENDPOINT?: string;
  readonly VITE_S3_BUCKET?: string;
}

const env = import.meta.env as unknown as StorageEnv;

export const STORAGE_BUCKET =
  (env.VITE_S3_BUCKET ?? "").trim() || "video-library";

export const STORAGE_ENDPOINT =
  ((env.VITE_S3_ENDPOINT ?? "").trim() || "http://127.0.0.1:9000").replace(/\/+$/, "");

export interface ObjectProgress {
  uploadedBytes: number;
  totalBytes: number;
  percentage: number;
}

function encodeObjectPath(objectPath: string): string {
  return objectPath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** 公开读对象的地址；对象存储按 <endpoint>/<bucket>/<key> 直接暴露。 */
export function objectUrl(objectPath: string, downloadName?: string): string {
  const base = `${STORAGE_ENDPOINT}/${encodeURIComponent(STORAGE_BUCKET)}/${encodeObjectPath(objectPath)}`;
  if (!downloadName) return base;
  const disposition = `attachment; filename="${downloadName.replace(/"/g, "")}"`;
  return `${base}?response-content-disposition=${encodeURIComponent(disposition)}`;
}

/** 上传对象（带进度）。失败一律抛错，由调用方决定是否标记「结果未知」。 */
export function putObject(
  objectPath: string,
  body: Blob | ArrayBuffer,
  contentType: string,
  onProgress?: (progress: ObjectProgress) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", objectUrl(objectPath), true);
    try {
      xhr.setRequestHeader("Content-Type", contentType || "application/octet-stream");
    } catch {
      reject(new Error("无法设置对象写入的 Content-Type。"));
      return;
    }
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const totalBytes = Math.max(1, event.total);
        onProgress({
          uploadedBytes: Math.min(event.loaded, totalBytes),
          totalBytes,
          percentage: Math.round((event.loaded / totalBytes) * 100),
        });
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      reject(new Error(`对象存储写入失败：HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("对象存储写入失败：网络错误"));
    xhr.onabort = () => reject(new Error("对象存储写入已取消"));
    xhr.send(body);
  });
}

/** 只读回读对象字节，用于上传结果核验（小文件场景）。 */
export async function getObjectBytes(objectPath: string): Promise<ArrayBuffer> {
  const response = await fetch(objectUrl(objectPath), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`对象存储读取失败：HTTP ${response.status}`);
  }
  return response.arrayBuffer();
}

/** 只读查询对象元信息（HEAD），不下载内容，大文件核验用它。 */
export async function getObjectSize(objectPath: string): Promise<number> {
  const response = await fetch(objectUrl(objectPath), { method: "HEAD", cache: "no-store" });
  if (response.status === 404) throw new Error("对象不存在");
  if (!response.ok) throw new Error(`对象存储读取失败：HTTP ${response.status}`);
  return Number(response.headers.get("Content-Length") ?? NaN);
}

/** 删除对象，返回删除失败的路径（成功的路径不返回）。 */
export async function removeObjects(paths: readonly string[]): Promise<string[]> {
  const failed: string[] = [];
  await Promise.all(
    paths.map(async (path) => {
      try {
        const response = await fetch(objectUrl(path), { method: "DELETE" });
        // 404 视作已不存在，不记为失败。
        if (!response.ok && response.status !== 404) failed.push(path);
      } catch {
        failed.push(path);
      }
    }),
  );
  return failed;
}
