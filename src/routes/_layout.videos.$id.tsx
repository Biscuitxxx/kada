// 视频详情页：在线播放 + 元信息 + 标签 + 下载/编辑/删除（独立页面，不嵌套列表）
import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  CalendarDays,
  Download,
  FileVideo,
  HardDrive,
  Pencil,
  Plus,
  Tag,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { attachVolumeMemory } from "@/lib/player-volume";
import { toast } from "sonner";
import {
  fetchVideoById,
  formatBytes,
  formatDate,
  formatDuration,
  publicUrl,
  updateVideo,
  type VideoRow,
} from "@/lib/site";
import { VideoEditDialog } from "@/components/VideoEditDialog";
import { TagPickerDialog } from "@/components/TagPickerDialog";
import { RemovableTagPill } from "@/components/TagPill";
import { useLayoutContext } from "@/lib/layout-context";

export const Route = createFileRoute("/_layout/videos/$id")({
  component: VideoDetailPage,
});

function VideoDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { library } = useLayoutContext();

  const [row, setRow] = useState<VideoRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [playError, setPlayError] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setPlayError(false);
    try {
      const r = await fetchVideoById(id);
      if (!r) setNotFound(true);
      else setRow(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "读取视频失败");
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // 音量记忆：进页面套用上次的音量，拖动音量条时写回本地
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    return attachVolumeMemory(el);
  }, [row?.id]);

  // 网页版还在转的时候轮询一下，转完自动换成可播的那份
  const proxyPending = row?.proxy_status === "pending" || row?.proxy_status === "processing";
  useEffect(() => {
    if (!proxyPending) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      fetchVideoById(id)
        .then((next) => {
          if (next && next.proxy_status !== row?.proxy_status) setRow(next);
        })
        .catch(() => {});
      if (tries >= 24) window.clearInterval(timer);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [proxyPending, id, row?.proxy_status]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="aspect-video w-full rounded-3xl" />
        <Skeleton className="h-10 w-2/3" />
      </div>
    );
  }

  if (notFound || !row) {
    return (
      <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-card/50 px-6 py-20 text-center">
        <FileVideo className="h-10 w-10 text-muted-foreground/50" />
        <h2 className="mt-4 text-lg font-bold">这个视频不存在或已被删除</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">它可能已被移除，回到视频库看看其他影片。</p>
        <Link
          to="/"
          className="mt-6 inline-flex h-10 items-center gap-2 rounded-full bg-film px-5 text-sm font-semibold text-primary-foreground transition-transform hover:bg-film-deep active:scale-95"
        >
          <ArrowLeft className="h-4 w-4" /> 返回视频库
        </Link>
      </div>
    );
  }

  const categoryName =
    (row.category_id && library.categories.find((c) => c.id === row.category_id)?.name) || "未分类";
  // 有网页版就播网页版（H.264），否则播原片；下载永远给原片
  const src = publicUrl(row.proxy_path || row.storage_path);
  const downloadSrc = publicUrl(row.storage_path);
  const proxyFailed = row.proxy_status === "failed";
  const tagIds = row.tag_ids ?? [];
  const rowTags = tagIds
    .map((tid) => library.tags.find((t) => t.id === tid))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

  const removeTag = async (tagId: string) => {
    try {
      await library.removeTagFromVideos([row.id], [tagId]);
      setRow((prev) =>
        prev ? { ...prev, tag_ids: (prev.tag_ids ?? []).filter((id) => id !== tagId) } : prev,
      );
      toast.success("已移除标签");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "移除失败");
    }
  };


  const doDownload = () => {
    try {
      const a = document.createElement("a");
      a.href = downloadSrc;
      a.download = row.original_name || row.title;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success(`开始下载「${row.title}」`);
    } catch {
      toast.error("下载失败，请稍后重试");
    }
  };

  const saveEdit = async (patch: { title: string; categoryId: string | null }) => {
    try {
      await updateVideo(row.id, { title: patch.title, category_id: patch.categoryId });
      setRow((prev) => (prev ? { ...prev, title: patch.title, category_id: patch.categoryId } : prev));
      library.reload();
      toast.success("已保存修改");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
      throw e;
    }
  };

  const confirmDelete = async () => {
    const view = { ...row, categoryName, tags: rowTags };
    setDeleteOpen(false);
    await library.remove(view);
    void navigate({ to: "/" });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <button
        type="button"
        onClick={() => void navigate({ to: "/" })}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-4 text-sm font-medium text-muted-foreground transition-colors hover:border-film/40 hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> 返回视频库
      </button>

      {/* 播放器 */}
      <div className="overflow-hidden rounded-3xl bg-black shadow-lift">
        {playError ? (
          <div className="flex aspect-video flex-col items-center justify-center gap-3 px-6 text-center">
            <FileVideo className="h-10 w-10 text-white/40" />
            <p className="text-sm font-medium text-white/80">此浏览器无法在线播放该编码格式</p>
            <Button variant="outline" size="sm" className="rounded-full" onClick={doDownload}>
              <Download className="h-4 w-4" /> 下载后观看
            </Button>
          </div>
        ) : (
          <video
            ref={videoRef}
            key={row.id}
            src={src}
            poster={row.cover_path ? publicUrl(row.cover_path) : undefined}
            controls
            playsInline
            autoPlay
            onError={() => setPlayError(true)}
            className="aspect-video w-full bg-black"
          />
        )}
      </div>

      {proxyPending && (
        <p className="rounded-2xl border border-film/30 bg-film/5 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          这支视频是浏览器解不了的编码（比如 HEVC），服务端正在生成网页能播的 H.264 版本，转好后这个页面会自动变成可播放。原片不会被替换，随时可以下载。
        </p>
      )}
      {proxyFailed && (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs leading-relaxed text-destructive">
          网页版没转成功，点「下载」用本地播放器观看即可。
        </p>
      )}

      {/* 标题与操作 */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-xl font-bold leading-snug tracking-tight sm:text-2xl">
            {row.title}
          </h1>
          <p className="mt-1 truncate text-xs text-muted-foreground">原始文件：{row.original_name}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            variant="outline"
            className="h-9 rounded-full"
            onClick={() => setEditOpen(true)}
          >
            <Pencil className="h-4 w-4" /> 编辑
          </Button>
          <Button
            className="h-9 rounded-full bg-film text-primary-foreground hover:bg-film-deep"
            onClick={doDownload}
          >
            <Download className="h-4 w-4" /> 下载
          </Button>
          <Button
            variant="ghost"
            className="h-9 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" /> 删除
          </Button>
        </div>
      </div>

      {/* 标签：展示 + 单条增删 */}
      <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-soft">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Tag className="h-4 w-4 text-film" /> 标签
            <span className="text-xs font-normal tabular-nums text-muted-foreground">
              {rowTags.length}
            </span>
          </h2>
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-full text-xs"
            onClick={() => setTagPickerOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" /> 添加标签
          </Button>
        </div>
        {rowTags.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            还没有标签。加几个标签后，首页可以用标签筛选，搜索框也能搜到它。
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {rowTags.map((t) => (
              <RemovableTagPill
                key={t.id}
                name={t.name}
                onRemove={() => void removeTag(t.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 元信息 */}
      <dl className="grid grid-cols-2 gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-soft sm:grid-cols-4">
        <Meta icon={<Tag className="h-4 w-4" />} label="分类" value={categoryName} />
        <Meta icon={<Timer className="h-4 w-4" />} label="时长" value={formatDuration(row.duration_seconds)} />
        <Meta icon={<HardDrive className="h-4 w-4" />} label="大小" value={formatBytes(row.size_bytes)} />
        <Meta icon={<CalendarDays className="h-4 w-4" />} label="上传于" value={formatDate(row.created_at)} />
      </dl>

      <TagPickerDialog
        open={tagPickerOpen}
        onOpenChange={setTagPickerOpen}
        tags={library.tags}
        mode="add"
        title="给这个视频加标签"
        onEnsureTag={library.ensureTag}
        onConfirm={async (ids) => {
          await library.addTagToVideos([row.id], ids);
          setRow((prev) =>
            prev ? { ...prev, tag_ids: [...new Set([...(prev.tag_ids ?? []), ...ids])] } : prev,
          );
          toast.success(`已添加 ${ids.length} 个标签`);
        }}
      />

      <VideoEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        video={{ ...row, categoryName, tags: rowTags }}
        categories={library.categories}
        onSave={saveEdit}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-sm">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle>删除「{row.title}」？</AlertDialogTitle>
            <AlertDialogDescription>
              视频文件将从云端视频库永久移除，此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">取消</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="text-film">{icon}</span>
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
