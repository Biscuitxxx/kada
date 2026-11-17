// 首页：横幅统计 + 分类筛选/排序工具行 + 视频网格（搜索状态来自布局 context）
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Hero } from "@/components/Hero";
import { FilterBar } from "@/components/FilterBar";
import { VideoGrid } from "@/components/VideoGrid";
import { CategoryManager } from "@/components/CategoryManager";
import { useFilteredVideos } from "@/hooks/useVideoLibrary";
import { useLayoutContext } from "@/lib/layout-context";
import type { SortKeyLite, ViewMode } from "@/types";

export const Route = createFileRoute("/_layout/")({
  component: HomePage,
});

function HomePage() {
  const { library, search, setSearch, openUpload } = useLayoutContext();
  const [activeCategoryId, setActiveCategoryId] = useState<string | "all">("all");
  const [sort, setSort] = useState<SortKeyLite>("newest");
  const [view, setView] = useState<ViewMode>("grid");
  const [managerOpen, setManagerOpen] = useState(false);

  const { visible, keyword } = useFilteredVideos(library.videos, search, activeCategoryId, sort);

  const videoCounts = new Map<string, number>();
  for (const v of library.videos) {
    const key = v.category_id ?? "__none__";
    videoCounts.set(key, (videoCounts.get(key) ?? 0) + 1);
  }

  return (
    <div className="space-y-6">
      <Hero
        totalVideos={library.videos.length}
        totalSize={library.totalSize}
        categoryCount={library.categories.length}
      />

      <FilterBar
        categories={library.categories}
        activeCategoryId={activeCategoryId}
        onSelectCategory={setActiveCategoryId}
        sort={sort}
        onSortChange={setSort}
        view={view}
        onViewChange={setView}
        onManageCategories={() => setManagerOpen(true)}
        resultCount={visible.length}
      />

      <VideoGrid
        videos={visible}
        loading={library.loading}
        error={library.error}
        view={view}
        searchKeyword={keyword}
        onClearSearch={() => setSearch("")}
        onRetry={library.reload}
        onUploadClick={openUpload}
        onDownload={library.download}
        onDelete={(v) => {
          if (window.confirm(`确定删除「${v.title}」？该视频文件将从云端移除。`)) {
            void library.remove(v);
          }
        }}
      />

      <CategoryManager
        open={managerOpen}
        onOpenChange={setManagerOpen}
        categories={library.categories}
        videoCounts={videoCounts}
        onChanged={() => {
          void library.refreshCategories();
          library.reload();
        }}
      />
    </div>
  );
}
