// 首页横幅：胶片蓝渐变 + 本地背景图，展示视频总数 / 总大小 / 分类数
import { Film, FolderTree, HardDrive } from "lucide-react";
import { formatBytes } from "@/lib/site";
import type { HeroProps } from "@/types";

// 图片已随项目落地到 public/，不再依赖秒悟 CDN
const HERO_BG = "/hero-banner.png";

export function Hero({ totalVideos, totalSize, categoryCount }: HeroProps) {
  return (
    <section className="hero-base relative overflow-hidden rounded-[1.75rem] shadow-lift reveal-zoom reveal">
      {/* 生成背景图（加载失败时渐变底优雅兜底） */}
      <img
        src={HERO_BG}
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover opacity-60 mix-blend-screen"
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-film-deep/85 via-film-deep/45 to-transparent" />

      <div className="relative px-6 py-8 sm:px-10 sm:py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-film-sky">
          Personal Video Library
        </p>
        <h1 className="mt-2 max-w-lg text-2xl font-bold leading-snug tracking-tight text-primary-foreground sm:text-[2rem]">
          你的每一段影像，
          <br className="sm:hidden" />
          都收进咔哒里
        </h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-primary-foreground/70">
          批量上传、随手分类、即点即播 —— 手机与电脑随时回看。
        </p>

        <dl className="mt-6 grid max-w-md grid-cols-3 gap-3">
          <Stat icon={<Film className="h-4 w-4" />} label="视频" value={String(totalVideos)} />
          <Stat icon={<HardDrive className="h-4 w-4" />} label="占用" value={formatBytes(totalSize)} />
          <Stat icon={<FolderTree className="h-4 w-4" />} label="分类" value={String(categoryCount)} />
        </dl>
      </div>
    </section>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-primary-foreground/15 bg-primary-foreground/10 px-3 py-2.5 backdrop-blur-sm">
      <dt className="flex items-center gap-1.5 text-[11px] font-medium text-primary-foreground/70">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 truncate text-lg font-bold tabular-nums text-primary-foreground">
        {value}
      </dd>
    </div>
  );
}
