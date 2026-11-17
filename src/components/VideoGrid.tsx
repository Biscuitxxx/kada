// 视频网格容器 + 卡片（紧耦合父子同文件）：封面、时长角标、更多菜单、空态/加载/错误
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Download,
  FilmIcon,
  MoreVertical,
  PlayCircle,
  RefreshCw,
  SearchX,
  Trash2,
  UploadCloud,
  WifiOff,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatBytes, formatDate, formatDuration, publicUrl } from "@/lib/site";
import type { VideoCardProps, VideoGridProps } from "@/types";

// 空状态插画随项目落地到 public/，不再依赖秒悟 CDN
const EMPTY_ART = "/empty-state-art.png";

export function VideoGrid({
  videos,
  loading,
  error,
  view,
  searchKeyword,
  onClearSearch,
  onRetry,
  onUploadClick,
  onDownload,
  onDelete,
}: VideoGridProps) {
  if (loading) {
    return (
      <div className={GRID_CLS[view]}>
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[4/3] w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <EmptyShell
        icon={<WifiOff className="h-7 w-7" />}
        title="视频库暂时打不开"
        desc={error}
        action={
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-film px-5 text-sm font-semibold text-primary-foreground transition-transform hover:bg-film-deep active:scale-95"
          >
            <RefreshCw className="h-4 w-4" /> 重新加载
          </button>
        }
      />
    );
  }

  if (videos.length === 0) {
    if (searchKeyword.trim()) {
      return (
        <EmptyShell
          icon={<SearchX className="h-7 w-7" />}
          title={`没有找到包含「${searchKeyword.trim()}」的视频`}
          desc="换个关键词试试，或清除搜索查看全部影片。"
          action={
            <button
              type="button"
              onClick={onClearSearch}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-5 text-sm font-semibold transition-colors hover:border-film/50 hover:text-film"
            >
              清除搜索
            </button>
          }
        />
      );
    }
    return (
      <EmptyShell
        icon={<img src={EMPTY_ART} alt="" className="float-bob h-12 w-12 object-contain" />}
        title="咔哒还空着"
        desc="上传单个视频或整个文件夹，开始收藏你的影像。"
        action={
          <button
            type="button"
            onClick={onUploadClick}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-film px-5 text-sm font-semibold text-primary-foreground shadow-[0_6px_18px_-6px_oklch(0.52_0.16_258/0.7)] transition-transform hover:bg-film-deep active:scale-95"
          >
            <UploadCloud className="h-4 w-4" /> 上传第一个视频
          </button>
        }
      />
    );
  }

  return (
    <div className={GRID_CLS[view]}>
      {videos.map((v, i) => (
        <div key={v.id} className="reveal" data-reveal-delay={String(Math.min(i, 7) * 60)}>
          <VideoCard video={v} view={view} onDownload={onDownload} onDelete={onDelete} />
        </div>
      ))}
    </div>
  );
}

const GRID_CLS: Record<VideoGridProps["view"], string> = {
  grid: "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4",
  list: "flex flex-col gap-3",
};

/* ── 卡片（子组件内联） ─────────────────────────────────── */

function VideoCard({ video, view, onDownload, onDelete }: VideoCardProps) {
  const [coverFailed, setCoverFailed] = useState(false);
  const coverSrc = video.cover_path && !coverFailed ? publicUrl(video.cover_path) : null;

  const thumb = (
    <div
      className={cn(
        "relative overflow-hidden bg-gradient-to-br from-secondary to-muted",
        view === "grid" ? "rounded-t-none" : "aspect-video w-32 shrink-0 sm:w-44",
        view === "grid" && "aspect-[4/3]",
      )}
    >
      {coverSrc ? (
        <img
          src={coverSrc}
          alt=""
          loading="lazy"
          onError={() => setCoverFailed(true)}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
        />
      ) : (
        <div className="grid h-full w-full place-items-center text-muted-foreground/50">
          <FilmIcon className="h-8 w-8" />
        </div>
      )}
      <span className="duration-badge">{formatDuration(video.duration_seconds)}</span>
      {view === "grid" && (
        <span className="play-float">
          <span>
            <PlayCircle className="h-6 w-6" />
          </span>
        </span>
      )}
    </div>
  );

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${video.title} 更多操作`}
          onClick={(e) => e.stopPropagation() /* 不触发整卡导航 */}
          onPointerDown={(e) => e.stopPropagation()}
          className="pointer-events-auto absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full bg-popover/85 text-muted-foreground opacity-0 backdrop-blur-sm transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuItem onSelect={() => onDownload(video)}>
          <Download className="h-4 w-4" /> 下载
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => onDelete(video)}
        >
          <Trash2 className="h-4 w-4" /> 删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const meta = (
    <div className={cn("min-w-0 flex-1", view === "grid" ? "p-3" : "py-1 pr-8")}>
      <h3 className="line-clamp-2 text-sm font-semibold leading-snug tracking-tight">
        {video.title}
      </h3>
      <p className="mt-1.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
        <span className="inline-flex max-w-[7rem] truncate rounded-md bg-accent px-1.5 py-0.5 font-medium text-accent-foreground">
          {video.categoryName}
        </span>
        <span className="tabular-nums">{formatBytes(video.size_bytes)}</span>
        <span className="hidden tabular-nums sm:inline">{formatDate(video.created_at)}</span>
      </p>
    </div>
  );

  return (
    <Link
      to="/videos/$id"
      params={{ id: video.id }}
      className={cn(
        "clip-card group relative block overflow-hidden rounded-2xl border border-border/60 bg-card outline-none",
        view === "list" && "flex items-center gap-3 p-2 sm:p-2",
      )}
    >
      {thumb}
      {meta}
      {menu}
    </Link>
  );
}

/* ── 空态外壳 ───────────────────────────────────────────── */

function EmptyShell({
  icon,
  title,
  desc,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-secondary text-film">
        {icon}
      </div>
      <h3 className="mt-4 text-base font-bold tracking-tight">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">{desc}</p>
      <div className="mt-6">{action}</div>
    </div>
  );
}
