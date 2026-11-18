// 上传弹窗：多文件 / 整个文件夹选择、拖拽入列、逐条标题与分类编辑、真实进度队列
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  FolderUp,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Tag,
  UploadCloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { TagPickerDialog } from "@/components/TagPickerDialog";
import { TagPill } from "@/components/TagPill";
import { collectEntryFiles, readDropEntries } from "@/lib/dropped-files";
import { createObjectStoreUploadService, useUploadQueue } from "@/features/file-upload";
import { sanitizeDownloadName } from "@/features/file-upload/filePolicy";
import {
  VIDEO_BUCKET_ID,
  fetchVideos,
  folderHintOf,
  insertVideoRecord,
  isVideoFile,
  prepareMediaMeta,
  setVideoTags,
  titleFromFileName,
} from "@/lib/site";
import type { CategoryRow, UploadDialogProps } from "@/types";

const CATEGORY_NONE = "__none__";

/**
 * 查重指纹必须和入库用的名字是同一套归一化：
 * 入库链路是 objectStoreUploadService.upload() 的 sanitizeDownloadName(file.name)
 * → site.ts 的 original_name → 服务端 createVideo() 再 trim 一次。
 * 原来直接拿 File.name 比较，带首尾空格 / 控制字符 / BiDi 字符 / 超长（>255）的名字
 * 在库里存的是清洗后的名字，永远命中不了，选同一个文件夹会重复入库。
 * 同时保留原始值和 NFC 变体，兼容查重上线前写入的旧记录。
 */
function nameVariants(name: string): string[] {
  const clean = sanitizeDownloadName(name);
  return Array.from(new Set([name, name.normalize("NFC"), clean, clean.normalize("NFC")]));
}

function fingerprintVariants(name: string, size: number): string[] {
  return nameVariants(name).map((variant) => `${variant}|${size}`);
}

/** 模块级共享 service：页面卸载不 dispose */
let sharedService: ReturnType<typeof createObjectStoreUploadService> | null = null;
function getUploadService() {
  if (!sharedService) {
    sharedService = createObjectStoreUploadService({
      bucket: VIDEO_BUCKET_ID,
      visibility: "public",
      // 不限单文件体积：只受磁盘空间限制
      maxFileSizeBytes: Number.POSITIVE_INFINITY,
    });
  }
  return sharedService;
}

/** enqueue 时随批次携带的平面元信息（每文件一条，按顺序对齐） */
interface MetaData extends Readonly<Record<string, string | number | boolean | null>> {
  key: string;
  title: string;
  categoryId: string | null;
  folderHint: string | null;
  /** 标签 id，逗号分隔（MetaData 只能放标量，数组放不下） */
  tagIdsCsv: string;
}

const parseTagIds = (csv: string | null | undefined): string[] =>
  (csv ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

interface EditState {
  file: File;
  meta: MetaData;
}

let keySeq = 0;


export function UploadDialog({
  open,
  onOpenChange,
  categories,
  tags,
  onEnsureCategory,
  onEnsureTag,
  onFinished,
}: UploadDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [scanning, setScanning] = useState(false);
  /** meta.key -> 原始 File 与可编辑元信息 */
  const [edits, setEdits] = useState<Map<string, EditState>>(new Map());
  /** 队列里勾选的条目，用于批量打标签 */
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  /** 标签弹窗这次是给「本批默认」用的，还是给「勾选的条目」用的 */
  const [tagPickerTarget, setTagPickerTarget] = useState<"batch" | "checked">("checked");
  /**
   * 本批默认：上传前就把这批的分类和标签定好，handleFiles 入队时直接写进每条 meta，
   * 于是每个文件入库时就自带分类和标签，不用传完再回头一个个设。
   */
  const [batchCategoryId, setBatchCategoryId] = useState<string | null>(null);
  const [batchTagIds, setBatchTagIds] = useState<string[]>([]);
  // 批量设分类的 Select 用 key 重置回占位态（Radix 不接受空字符串 value）
  const [catPickerKey, setCatPickerKey] = useState(0);
  const editsBridge = useRef(edits);
  editsBridge.current = edits;
  /**
   * 本次弹窗里「已选中但还没入库」的指纹。associate 要等上传完成才写 videos 表，
   * 只看 fetchVideos() 会漏掉仍在队列里的文件（大视频传几分钟，期间再选一次文件夹就会双份）。
   * 用 ref 同步记账，避免两次 handleFiles 在同一帧里都读到旧的 edits。
   */
  const claimedRef = useRef<Set<string>>(new Set());

  const defaultCategoryId = categories.find((c) => c.is_default)?.id ?? null;

  const queue = useUploadQueue<MetaData>({
    service: getUploadService(),
    // 队列协议要求 scope 非空（ownerId/parentId 都必须有值），否则 enqueue 直接返回 false
    scope: { ownerId: "kada", parentId: "upload-dialog" },
    associate: async (ref, context, flowScope) => {
      // 读取界面上的最新编辑值（context.data 是入队时快照）
      const entry = editsBridge.current.get(context.data.key);
      const edited = entry?.meta ?? context.data;
      const file = entry?.file ?? new File([], ref.originalName);

      // 1. 探测时长 + 生成并上传封面
      const { duration, coverPath } = await prepareMediaMeta(file, ref.objectPath).catch(
        () => ({ duration: null as number | null, coverPath: null as string | null }),
      );
      flowScope.assertCurrent();

      // 2. 文件夹建议分类：不存在则自动创建
      let categoryId = edited.categoryId;
      const hint = edited.folderHint;
      if (!categoryId && hint) {
        try {
          const created = await onEnsureCategory(hint);
          categoryId = created.id;
        } catch {
          categoryId = defaultCategoryId;
        }
      }
      if (!categoryId) categoryId = defaultCategoryId;

      // 3. 写入业务记录（精确回执）
      flowScope.assertCurrent();
      const row = await insertVideoRecord({
        ref,
        title: (edited.title || titleFromFileName(ref.originalName)).trim() || ref.originalName,
        categoryId,
        durationSeconds: duration,
        coverPath,
        folderHint: hint,
      });

      // 4. 上传前批量打上的标签，跟着这条记录一起落库
      const wantedTags = parseTagIds(edited.tagIdsCsv);
      if (wantedTags.length > 0) {
        // 标签失败不该让整条入库失败，转成「关联待重试」让用户看到
        await setVideoTags(row.id, wantedTags);
      }
    },
    onConfirmed: async (_ref, _context, flowScope) => {
      flowScope.assertCurrent();
      onFinished();
    },
  });

  useEffect(() => {
    if (!open) {
      setEdits(new Map());
      claimedRef.current.clear();
      setDragOver(false);
      setCheckedKeys(new Set());
      setTagPickerOpen(false);
      setTagPickerTarget("checked");
      setBatchCategoryId(null);
      setBatchTagIds([]);
    }
  }, [open]);

  const items = queue.items;
  const confirmedCount = items.filter((i) => i.state === "confirmed").length;
  const allDone = items.length > 0 && items.every((i) => i.state === "confirmed");

  /**
   * 上传失败（state=failed）的条目要从 claimedRef 里放回指纹：
   * 它永远不入库，指纹却一直占着，同一弹窗里再选这个文件会被误判成「库里已经有」而永久传不上去。
   * upload-unknown / association-pending 不放——对象可能已经落在存储里，重传会真的多一份。
   */
  useEffect(() => {
    for (const item of items) {
      if (item.state !== "failed") continue;
      const entry = edits.get(item.context.data.key);
      if (!entry) continue;
      for (const fp of fingerprintVariants(entry.file.name, entry.file.size)) claimedRef.current.delete(fp);
    }
  }, [items, edits]);

  /** 校验 + 查重 + 初始化编辑态 + 入队 */
  const handleFiles = async (fileList: File[] | FileList | null) => {
    if (!fileList) return;
    const files = Array.from(fileList);
    const valid: File[] = [];
    let badType = 0;
    let empty = 0;
    for (const f of files) {
      if (!isVideoFile(f)) {
        badType += 1;
        continue;
      }
      // 0 字节的文件服务端一定拒收（"不能上传空文件"），提前筛掉，别让它占住队列
      if (f.size === 0) {
        empty += 1;
        continue;
      }
      valid.push(f);
    }
    if (badType > 0) toast.warning(`${badType} 个文件不是视频格式，已跳过`);
    if (empty > 0) toast.warning(`${empty} 个空文件（0 字节）已跳过`);
    if (files.length === 0) {
      toast.info("没读到任何文件：这个文件夹可能是空的，或者浏览器没给出目录内容");
      return;
    }
    if (valid.length === 0) return;

    // 查重：库里已有 + 本弹窗已选中但还没入库的（associate 完成前库里查不到），都算重复
    const seen = new Set<string>(claimedRef.current);
    let libraryKnown = false;
    try {
      const rows = await fetchVideos();
      for (const row of rows) {
        for (const fp of fingerprintVariants(row.original_name, row.size_bytes)) seen.add(fp);
      }
      libraryKnown = true;
    } catch {
      // 查不到就不拦，宁可让用户多传一份，也不能把没传过的文件误判成重复；
      // 但本弹窗内部的去重仍然生效
    }
    let duplicate = 0;
    const picked: File[] = [];
    for (const f of valid) {
      const variants = fingerprintVariants(f.name, f.size);
      if (variants.some((fp) => seen.has(fp))) {
        duplicate += 1;
        continue;
      }
      // 同一批里同名同大小只留一个；同步记账，避免两次 handleFiles 并发时互相漏判
      for (const fp of variants) {
        seen.add(fp);
        claimedRef.current.add(fp);
      }
      picked.push(f);
    }
    if (duplicate > 0) {
      toast.warning(`${duplicate} 个文件库里已经有（同名同大小），已跳过`, { duration: 6000 });
    }
    if (picked.length === 0) {
      if (libraryKnown && duplicate > 0) toast.info("选中的文件库里都已经有了，没有新增");
      return;
    }

    const metas: MetaData[] = picked.map((f) => ({
      key: `v${++keySeq}`,
      title: titleFromFileName(f.name),
      // 上传前选的本批分类/标签优先；没选就走原来的默认分类 + 文件夹推断
      categoryId: batchCategoryId ?? defaultCategoryId,
      folderHint: folderHintOf(f),
      tagIdsCsv: batchTagIds.join(","),
    }));

    setEdits((prev) => {
      const next = new Map(prev);
      picked.forEach((f, i) => next.set(metas[i].key, { file: f, meta: metas[i] }));
      return next;
    });
    // 逐文件入队：每个 enqueue 携带各自的元信息快照，避免多文件共用同一份 data
    void (async () => {
      for (let i = 0; i < picked.length; i++) {
        try {
          const accepted = await queue.enqueue([picked[i]], metas[i]);
          // 队列未就绪时会静默返回 false，这里必须显式告诉用户，不能装作没发生
          if (!accepted) {
            toast.error("文件没能进入上传队列，请关闭弹窗重试");
            return;
          }
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "文件入队失败");
          return;
        }
      }
    })();
  };

  const updateMeta = (
    key: string,
    patch: Partial<Pick<MetaData, "title" | "categoryId" | "tagIdsCsv">>,
  ) => {
    setEdits((prev) => {
      const entry = prev.get(key);
      if (!entry) return prev;
      const next: MetaData = { ...entry.meta, ...patch };
      return new Map(prev).set(key, { ...entry, meta: next });
    });
  };

  const canClose = !queue.blocked;

  /** 队列里还没开始传的条目（能安全修改它们 meta 的就这些） */
  const editableKeys = items.filter((i) => i.state === "queued").map((i) => i.context.data.key);

  /** 本批分类：改了就同步给队列里还没开始传的条目，让清单上的下拉和实际入库保持一致 */
  const applyBatchCategory = (value: string) => {
    const target = value === CATEGORY_NONE ? null : value;
    setBatchCategoryId(target);
    if (editableKeys.length === 0) return;
    setEdits((prev) => {
      const next = new Map(prev);
      for (const key of editableKeys) {
        const entry = next.get(key);
        if (!entry) continue;
        next.set(key, { ...entry, meta: { ...entry.meta, categoryId: target } });
      }
      return next;
    });
  };

  /** 本批标签：整批替换（不是追加），并同步给还没开始传的条目 */
  const setBatchTags = (tagIds: string[]) => {
    const unique = Array.from(new Set(tagIds));
    setBatchTagIds(unique);
    if (editableKeys.length === 0) return;
    setEdits((prev) => {
      const next = new Map(prev);
      for (const key of editableKeys) {
        const entry = next.get(key);
        if (!entry) continue;
        next.set(key, { ...entry, meta: { ...entry.meta, tagIdsCsv: unique.join(",") } });
      }
      return next;
    });
  };

  /** 队列条目勾选（confirmed 的已入库，不再参与批量打标签） */
  const checkableItems = items.filter((i) => i.state !== "confirmed");
  const allChecked = checkableItems.length > 0 && checkableItems.every((i) => checkedKeys.has(i.context.data.key));

  const toggleChecked = (key: string) => {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /** 把标签打进选中条目的 meta，associate 时随入库一起写 */
  const applyTagsToChecked = (tagIds: string[]) => {
    let applied = 0;
    setEdits((prev) => {
      const next = new Map(prev);
      for (const key of checkedKeys) {
        const entry = next.get(key);
        if (!entry) continue;
        const merged = Array.from(new Set([...parseTagIds(entry.meta.tagIdsCsv), ...tagIds]));
        next.set(key, { ...entry, meta: { ...entry.meta, tagIdsCsv: merged.join(",") } });
        applied += 1;
      }
      return next;
    });
    toast.success(`已给 ${applied} 个待上传视频加上标签，上传完成后自动入库`);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !canClose) {
          toast.info("有文件正在处理，完成后即可关闭；上传会在后台继续");
          return;
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="flex max-h-[88vh] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border/60 px-5 py-4 text-left sm:px-6">
          <DialogTitle className="flex items-center gap-2 text-base font-bold tracking-tight">
            <UploadCloud className="h-5 w-5 text-film" />
            上传视频
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto px-5 py-4 sm:px-6">
          {/* 选择区：点击 / 拖拽 / 文件夹 */}
          <div
            role="button"
            tabIndex={0}
            aria-label="点击选择整个文件夹，或把视频、文件夹拖进来"
            onClick={() => folderInputRef.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && folderInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              // entry 必须同步取，之后才允许 await
              const dt = e.dataTransfer;
              const entries = dt ? readDropEntries(dt) : [];
              const plainFiles = dt ? Array.from(dt.files ?? []) : [];
              void (async () => {
                if (entries.length > 0) setScanning(true);
                try {
                  // 目录递归和 files 兜底都要，任一条拿不到文件时用另一条
                  const fromEntries = entries.length > 0 ? await collectEntryFiles(entries) : [];
                  await handleFiles(fromEntries.length > 0 ? fromEntries : plainFiles);
                } finally {
                  setScanning(false);
                }
              })();
            }}
            className={
              "flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-7 text-center transition-colors " +
              (dragOver
                ? "border-film bg-accent/60"
                : "border-border bg-secondary/40 hover:border-film/50")
            }
          >
            <UploadCloud className="h-8 w-8 text-film" />
            <p className="mt-2 text-sm font-semibold">
              {scanning ? "正在读取文件夹…" : "把视频或整个文件夹拖到这里"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              点这块虚线区 = 选整个文件夹（含子文件夹里的视频）
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              支持 mp4 / mov / webm / mkv 等，大小不限（受磁盘空间限制）
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                <UploadCloud className="h-4 w-4" /> 选择视频文件
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={(e) => {
                  e.stopPropagation();
                  folderInputRef.current?.click();
                }}
              >
                <FolderUp className="h-4 w-4" /> 上传整个文件夹
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="video/*"
              className="hidden"
              disabled={queue.busy || queue.blocked}
              onChange={(e) => {
                const files = Array.from(e.currentTarget.files ?? []);
                e.currentTarget.value = "";
                void handleFiles(files);
              }}
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              // @ts-expect-error 非标准但各现代浏览器支持的文件夹选择属性
              webkitdirectory=""
              directory=""
              className="hidden"
              disabled={queue.busy || queue.blocked}
              onChange={(e) => {
                const files = Array.from(e.currentTarget.files ?? []);
                e.currentTarget.value = "";
                void handleFiles(files);
              }}
            />
          </div>

          {/* 本批默认：上传前先定好分类和标签，后面的文件自动带上 */}
          <div className="mt-3 rounded-xl border border-film/25 bg-accent/40 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-film-deep">上传前先定好</span>
              <Select value={batchCategoryId ?? CATEGORY_NONE} onValueChange={applyBatchCategory}>
                <SelectTrigger
                  className="h-8 w-auto min-w-[7.5rem] rounded-full border-border bg-card px-2.5 text-xs"
                  aria-label="本批视频的分类"
                >
                  <SelectValue placeholder="选择分类" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CATEGORY_NONE}>不指定分类</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-full bg-card text-xs"
                onClick={() => {
                  setTagPickerTarget("batch");
                  setTagPickerOpen(true);
                }}
              >
                <Tag className="h-3.5 w-3.5" />
                {batchTagIds.length > 0 ? `再加标签（已选 ${batchTagIds.length}）` : "选择标签"}
              </Button>
              {batchTagIds.map((id) => {
                const name = tags.find((t) => t.id === id)?.name;
                if (!name) return null;
                return (
                  <button
                    type="button"
                    key={id}
                    onClick={() => setBatchTags(batchTagIds.filter((x) => x !== id))}
                    className="rounded-full transition-opacity hover:opacity-70"
                    aria-label={`去掉标签 ${name}`}
                    title="点一下去掉这个标签"
                  >
                    <TagPill name={name} />
                  </button>
                );
              })}
              {batchTagIds.length > 0 && (
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground underline transition-colors hover:text-foreground"
                  onClick={() => setBatchTags([])}
                >
                  清空标签
                </button>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              选好后，这批每个视频入库时就带上这些分类和标签；上传完成后也能逐条改。
            </p>
          </div>

          {/* 上传队列 */}
          {items.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-secondary/40 px-3 py-2">
              <span className="text-xs text-muted-foreground">已入库的想微调：勾选条目后批量改</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 rounded-full text-xs"
                onClick={() =>
                  setCheckedKeys(
                    allChecked ? new Set() : new Set(checkableItems.map((i) => i.context.data.key)),
                  )
                }
                disabled={checkableItems.length === 0}
              >
                {allChecked ? "取消全选" : "全选"}
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                已选 {checkedKeys.size}
              </span>
              {/* 勾选的队列条目批量设分类（分类单选，整批改成同一个）；选完 remount 回到占位态 */}
              <Select
                key={catPickerKey}
                onValueChange={(v) => {
                  const target = v === CATEGORY_NONE ? null : v;
                  const n = checkedKeys.size;
                  for (const key of checkedKeys) updateMeta(key, { categoryId: target });
                  setCatPickerKey((k) => k + 1);
                  toast.success(
                    `已把 ${n} 条队列项设为「${categories.find((c) => c.id === target)?.name ?? "未分类"}」`,
                  );
                }}
                disabled={checkedKeys.size === 0}
              >
                <SelectTrigger
                  className="h-7 w-auto min-w-[7rem] rounded-full border-border bg-card px-2.5 text-xs"
                  aria-label="给勾选的条目设置分类"
                >
                  <SelectValue placeholder="批量设分类" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CATEGORY_NONE}>未分类</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                className="h-7 rounded-full text-xs"
                onClick={() => {
                  setTagPickerTarget("checked");
                  setTagPickerOpen(true);
                }}
                disabled={checkedKeys.size === 0}
              >
                <Tag className="h-3.5 w-3.5" /> 给选中项打标签
              </Button>
            </div>
          )}
          {items.length > 0 && (
            <ul className="mt-2.5 space-y-2.5">
              {items.map((item) => {
                const entry = edits.get(item.context.data.key);
                const meta = entry?.meta;
                const displayName = entry?.file.name ?? item.file.name;
                const editable = item.state === "queued";
                const busy = item.state === "uploading" || item.state === "associating";
                return (
                  <li
                    key={item.id}
                    className="rounded-xl border border-border/70 bg-card p-3 shadow-soft"
                  >
                    <div className="flex items-start gap-2.5">
                      {item.state !== "confirmed" && (
                        <button
                          type="button"
                          aria-label={`选择 ${displayName} 进行批量打标签`}
                          aria-pressed={checkedKeys.has(item.context.data.key)}
                          onClick={() => toggleChecked(item.context.data.key)}
                          className={
                            "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors " +
                            (checkedKeys.has(item.context.data.key)
                              ? "border-film bg-film text-primary-foreground"
                              : "border-border text-transparent hover:border-film/60")
                          }
                        >
                          <Check className="h-3 w-3" />
                        </button>
                      )}
                      <StateIcon state={item.state} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <Input
                            value={meta?.title ?? titleFromFileName(displayName)}
                            disabled={!editable}
                            onChange={(e) => updateMeta(item.context.data.key, { title: e.target.value })}
                            className="h-9 min-w-0 flex-1 text-sm"
                            aria-label="视频标题"
                          />
                          <Select
                            value={meta?.categoryId ?? defaultCategoryId ?? CATEGORY_NONE}
                            disabled={!editable}
                            onValueChange={(v) =>
                              updateMeta(item.context.data.key, {
                                categoryId: v === CATEGORY_NONE ? null : v,
                              })
                            }
                          >
                            <SelectTrigger className="h-9 w-full text-sm sm:w-36" aria-label="分类">
                              <SelectValue placeholder="选择分类" />
                            </SelectTrigger>
                            <SelectContent>
                              {categories.map((c) => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <p className="mt-1.5 truncate text-xs text-muted-foreground">
                          {displayName}
                          {meta?.folderHint && (
                            <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-accent-foreground">
                              来自「{meta.folderHint}」
                            </span>
                          )}
                        </p>

                        {(() => {
                          const ids = parseTagIds(meta?.tagIdsCsv);
                          if (ids.length === 0) return null;
                          const names = ids
                            .map((id) => tags.find((t) => t.id === id)?.name)
                            .filter((n): n is string => Boolean(n));
                          if (names.length === 0) return null;
                          return (
                            <p className="mt-1.5 flex flex-wrap items-center gap-1">
                              {names.map((n) => (
                                <TagPill key={n} name={n} />
                              ))}
                            </p>
                          );
                        })()}

                        {(busy || item.state === "queued") && (
                          <div className="mt-2">
                            <Progress
                              value={item.progress?.percentage ?? 0}
                              className="h-1.5 overflow-hidden rounded-full bg-secondary [&>div]:!bg-transparent [&>div]:progress-bar"
                            />
                            <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                              {item.state === "queued"
                                ? "排队中…"
                                : item.state === "associating"
                                  ? "生成封面并入库…"
                                  : `${Math.round(item.progress?.percentage ?? 0)}%`}
                            </p>
                          </div>
                        )}

                        {item.state === "upload-unknown" && (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="text-xs text-destructive">上传结果未知</span>
                            <Button size="sm" variant="outline" className="h-7 rounded-full text-xs" onClick={() => void queue.verify(item.id)}>
                              <ShieldAlert className="h-3.5 w-3.5" /> 核验上传
                            </Button>
                            {item.message && (
                              <span className="text-xs text-destructive">{item.message}</span>
                            )}
                          </div>
                        )}
                        {item.state === "association-pending" && (
                          <div className="mt-2 flex items-center gap-2">
                            <span className="text-xs text-destructive">{item.message ?? "入库失败"}</span>
                            <Button size="sm" variant="outline" className="h-7 rounded-full text-xs" onClick={() => void queue.retryAssociation(item.id)}>
                              <RefreshCw className="h-3.5 w-3.5" /> 重试关联
                            </Button>
                          </div>
                        )}
                        {item.state === "failed" && (
                          <p className="mt-1 text-xs text-destructive">{item.message ?? "上传失败"}</p>
                        )}
                        {item.refreshError && (
                          <p className="mt-1 text-xs text-destructive">列表刷新失败，请手动刷新查看</p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border/60 px-5 py-3.5 sm:px-6">
          <p className="text-xs tabular-nums text-muted-foreground">
            {items.length > 0 ? `已完成 ${confirmedCount}/${items.length}` : "尚未选择文件"}
          </p>
          <div className="flex gap-2">
            {items.some((i) => i.state === "failed") && (
              <Button
                variant="ghost"
                className="rounded-full text-muted-foreground"
                onClick={() => {
                  // clear 只会清掉已完成/上传前的失败项，正在传输或结果未知的项会被保留
                  const cleared = queue.clear();
                  if (cleared) {
                    setEdits(new Map());
                    claimedRef.current.clear();
                  } else toast.info("有上传结果未知的任务，先核验或重试后再清空");
                }}
                disabled={queue.busy}
              >
                清空列表
              </Button>
            )}
            {allDone ? (
              <Button variant="outline" className="rounded-full" onClick={() => onOpenChange(false)}>
                完成
              </Button>
            ) : (
              <Button
                className="rounded-full bg-film text-primary-foreground hover:bg-film-deep"
                onClick={() => onOpenChange(false)}
                disabled={!canClose}
              >
                {queue.busy ? "上传进行中…稍后可关闭" : "关闭"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>

      <TagPickerDialog
        open={tagPickerOpen}
        onOpenChange={setTagPickerOpen}
        tags={tags}
        mode="add"
        title={tagPickerTarget === "batch" ? "给这批视频选标签" : "给选中的待上传视频打标签"}
        description={
          tagPickerTarget === "batch"
            ? "选中的标签会跟着这批每个视频一起入库；之后新选的视频也会自动带上"
            : `将对 ${checkedKeys.size} 个视频生效，上传完成入库时自动写入`
        }
        onEnsureTag={onEnsureTag}
        onConfirm={async (tagIds) => {
          if (tagPickerTarget === "batch") {
            // mode="add" 只回传这次勾的，所以是"并到已有"而不是覆盖
            setBatchTags([...batchTagIds, ...tagIds]);
          } else {
            applyTagsToChecked(tagIds);
          }
        }}
      />
    </Dialog>
  );
}

function StateIcon({ state }: { state: string }) {
  if (state === "confirmed") return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />;
  if (state === "failed" || state === "upload-unknown" || state === "association-pending")
    return <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />;
  if (state === "uploading" || state === "associating")
    return <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-film" />;
  return <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40" />;
}

