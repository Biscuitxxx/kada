// 顶部玻璃导航栏：Logo + 搜索框 + 上传按钮；移动端搜索框收缩为图标展开式
import { useEffect, useRef, useState } from "react";
import { Clapperboard, Search, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/site";
import type { TopBarProps } from "@/types";

export function TopBar({ search, onSearchChange, onUploadClick }: TopBarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mobileOpen) mobileInputRef.current?.focus();
  }, [mobileOpen]);

  return (
    <header className="app-header fixed inset-x-0 top-0 z-40 h-16">
      <div className="mx-auto flex h-full max-w-7xl items-center gap-3 px-4 sm:px-6">
        {/* Logo */}
        <a href="/" className="flex shrink-0 items-center gap-2" aria-label={APP_NAME}>
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-film text-primary-foreground shadow-[0_4px_12px_-3px_oklch(0.52_0.16_258/0.6)]">
            <Clapperboard className="h-5 w-5" strokeWidth={2.2} />
          </span>
          <span className="hidden text-[17px] font-bold tracking-tight sm:block">
            咔哒
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              我的视频库
            </span>
          </span>
        </a>

        {/* 桌面搜索框 */}
        <div className="relative mx-auto hidden w-full max-w-md md:block">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="按标题搜索视频…"
            className="h-10 rounded-full border-border/70 bg-card/80 pl-10 pr-9 shadow-soft focus-visible:ring-film/40"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="清除搜索"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex flex-1 items-center justify-end gap-2 md:flex-none">
          {/* 移动端搜索开关 */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="搜索"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
          </Button>

          <Button
            onClick={onUploadClick}
            className="h-10 rounded-full bg-film px-4 font-semibold text-primary-foreground shadow-[0_6px_18px_-6px_oklch(0.52_0.16_258/0.7)] transition-transform hover:bg-film-deep active:scale-95 sm:px-5"
          >
            <Upload className="h-4 w-4" />
            <span className="hidden sm:inline">上传</span>
            <span className="sm:hidden">上传视频</span>
          </Button>
        </div>
      </div>

      {/* 移动端展开搜索条 */}
      <div
        className={cn(
          "grid overflow-hidden border-t border-border/50 transition-all duration-300 md:hidden",
          mobileOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0">
          <div className="relative px-4 py-3">
            <Search className="pointer-events-none absolute left-7 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={mobileInputRef}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="按标题搜索视频…"
              className="h-10 rounded-full bg-card pl-10 pr-9"
            />
            {search && (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                className="absolute right-7 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-label="清除搜索"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
