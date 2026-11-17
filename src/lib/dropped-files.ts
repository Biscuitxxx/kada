/**
 * 拖拽目录时的递归读取。
 *
 * 浏览器在 drop 事件里对「拖进来的目录」只在 `dataTransfer.items` 的 `webkitGetAsEntry()`
 * 上给出目录树，`dataTransfer.files` 是空的。所以拖文件夹必须先递归遍历 entry 树。
 *
 * 两个容易踩的点：
 * 1. entry 必须在 drop 事件的同步阶段取出来，事件结束后 DataTransfer 就失效了；
 * 2. `readEntries` 一次只返回一批（Chrome 每批最多 100 条），必须循环读到空数组为止。
 */

export interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file: (onFile: (file: File) => void, onError?: (error: unknown) => void) => void;
  createReader: () => {
    readEntries: (
      onEntries: (entries: FsEntry[]) => void,
      onError?: (error: unknown) => void,
    ) => void;
  };
}

type ItemWithEntry = { webkitGetAsEntry?: () => FsEntry | null };

/** 同步取出 drop 里的所有 entry；不支持该 API 时返回空数组，调用方回退到 files */
export function readDropEntries(dataTransfer: DataTransfer | null | undefined): FsEntry[] {
  if (!dataTransfer) return [];
  const entries: FsEntry[] = [];
  for (const item of Array.from(dataTransfer.items ?? [])) {
    const getEntry = (item as DataTransferItem & ItemWithEntry).webkitGetAsEntry;
    if (typeof getEntry !== "function") continue;
    const entry = getEntry.call(item);
    if (entry) entries.push(entry);
  }
  return entries;
}

/** 递归展开目录树，返回其中的文件；prefix 用于补出「所属文件夹」提示 */
export async function collectEntryFiles(entries: FsEntry[], prefix: string[] = []): Promise<File[]> {
  const files: File[] = [];
  for (const entry of entries) {
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) => {
        entry.file(
          (value) => resolve(value),
          () => resolve(null),
        );
      });
      if (!file) continue;
      if (prefix.length > 0) {
        // 拖进来的文件没有 webkitRelativePath，补一个，folderHintOf 才能认出所在目录
        try {
          Object.defineProperty(file, "webkitRelativePath", {
            value: [...prefix, file.name].join("/"),
            configurable: true,
          });
        } catch {
          /* 只影响「所属文件夹」提示，补不上无所谓 */
        }
      }
      files.push(file);
      continue;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      while (true) {
        const batch = await new Promise<FsEntry[]>((resolve) => {
          reader.readEntries(
            (list) => resolve(list),
            () => resolve([]),
          );
        });
        if (batch.length === 0) break;
        files.push(...(await collectEntryFiles(batch, [...prefix, entry.name])));
      }
    }
  }
  return files;
}
