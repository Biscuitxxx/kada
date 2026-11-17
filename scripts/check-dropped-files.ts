/**
 * 拖拽目录递归读取的可执行检查（不需要浏览器）。
 *
 * 跑法：node --experimental-strip-types scripts/check-dropped-files.ts
 * 或者 pnpm check:drop
 *
 * 用假的 entry 树覆盖三件事：
 * 1. 子目录能递归进去；
 * 2. readEntries 分批返回时能循环读干净；
 * 3. 递归出来的文件带上 webkitRelativePath（「所属文件夹」提示依赖它）。
 */
import { collectEntryFiles, type FsEntry } from "../src/lib/dropped-files.ts";

function fileEntry(name: string): FsEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file(onFile) {
      onFile(new File(["x"], name, { type: "text/plain" }));
    },
  };
}

/** 故意按 batchSize 分批返回，模拟 Chrome 每批最多 100 条的行为 */
function dirEntry(name: string, children: FsEntry[], batchSize = 2): FsEntry & { reads: () => number } {
  let reads = 0;
  const entry: FsEntry = {
    isFile: false,
    isDirectory: true,
    name,
    file(onFile, onError) {
      onError?.(new Error("目录不是文件"));
    },
    createReader() {
      let cursor = 0;
      return {
        readEntries(onEntries, onError) {
          reads += 1;
          if (cursor >= children.length) {
            onEntries([]);
            return;
          }
          const batch = children.slice(cursor, cursor + batchSize);
          cursor += batch.length;
          if (batch.length === 0) onError?.(new Error("分批读取失败"));
          onEntries(batch);
        },
      };
    },
  };
  return Object.assign(entry, { reads: () => reads });
}

function assert(condition: boolean, label: string): boolean {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
  return condition;
}

async function main() {
  const sub = dirEntry("子目录", [fileEntry("s1.txt"), fileEntry("s2.txt"), fileEntry("s3.txt")]);
  const root = dirEntry("测试文件夹", [fileEntry("r1.txt"), sub]);

  const files = await collectEntryFiles([root]);
  const names = files.map((f) => f.name).sort();
  let ok = true;

  ok = assert(files.length === 4, `递归拿到 4 个文件（实际 ${files.length}）`) && ok;
  ok =
    assert(
      JSON.stringify(names) === JSON.stringify(["r1.txt", "s1.txt", "s2.txt", "s3.txt"]),
      `文件名正确：${names.join(", ")}`,
    ) && ok;

  const rel = files.find((f) => f.name === "s2.txt") as File & { webkitRelativePath?: string };
  ok =
    assert(
      rel?.webkitRelativePath === "测试文件夹/子目录/s2.txt",
      `子目录文件带上了相对路径（实际 ${rel?.webkitRelativePath ?? "空"}）`,
    ) && ok;

  // 分批量：子目录 3 个文件、每批 2 条 → 必须读 3 次（2 + 1 + 空）才算读干净
  ok = assert(sub.reads() === 3, `readEntries 按批读到空（调用 ${sub.reads()} 次）`) && ok;

  // 5 个文件、每批 2 条 → 4 次（2 + 2 + 1 + 空）
  const flat = dirEntry("大批量", [1, 2, 3, 4, 5].map((i) => fileEntry(`f${i}.mp4`)));
  const flatFiles = await collectEntryFiles([flat]);
  ok = assert(flatFiles.length === 5, `一批 2 条时 5 个文件全部收集（实际 ${flatFiles.length}）`) && ok;
  ok = assert(flat.reads() === 4, `大批量 readEntries 调用 4 次（实际 ${flat.reads()}）`) && ok;

  // 空目录不应报错、也不应产出文件
  const empty = dirEntry("空目录", []);
  const emptyFiles = await collectEntryFiles([empty]);
  ok = assert(emptyFiles.length === 0, "空目录返回 0 个文件且不抛错") && ok;

  if (!ok) {
    console.error("\n有用例失败");
    process.exit(1);
  }
  console.log("\n全部通过");
}

void main();
