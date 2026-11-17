// 首页：横幅统计 + 分类筛选（单行）+ 排序工具行 + 视频网格 + 多选批量设分类/打标签
// 标签不常驻首页：从「分类与标签」页点标签进来时用 ?tag=<id>，工具行显示一条可清除的提示
import { useState, useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Hero } from "@/components/Hero";
import { FilterBar } from "@/components/FilterBar";
import { VideoGrid } from "@/components/VideoGrid";
import { BatchTagBar } from "@/components/BatchTagBar";
import { useFilteredVideos } from "@/hooks/useVideoLibrary";
import { useLayoutContext } from "@/lib/layout-context";
import type { SortKeyLite, ViewMode, VideoView } from "@/types";

export const Route = createFileRoute("/_layout/")({
  validateSearch: (search: Record<string, unknown>): { tag?: string } => ({
    tag: typeof search.tag === "string" && search.tag ? search.tag : undefined,
  }),
  component: HomePage,
});

function HomePage() {
  const { library, search, setSearch, openUpload } = useLayoutContext();
  const { tag: tagParam } = Route.useSearch();
  const navigate = useNavigate();
  const [activeCategoryId, setActiveCategoryId] = useState<string | "all">("all");
  const [sort, setSort] = useState<SortKeyLite>("newest");
  const [view, setView] = useState<ViewMode>("grid");
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const activeTagId = tagParam && library.tags.some((t) => t.id === tagParam) ? tagParam : "all";
  const activeTag = activeTagId === "all" ? null : (library.tags.find((t) => t.id === activeTagId) ?? null);

  const { visible, keyword } = useFilteredVideos(
    library.videos,
    search,
    activeCategoryId,
    activeTagId,
    sort,
  );

  const selectedSet = new Set(selectedIds);
  const selectedVideos: VideoView[] = visible.filter((v) => selectedSet.has(v.id));

  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of library.videos) {
      const key = v.category_id ?? "__none__";
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [library.videos]);

  const toggleSelect = (video: VideoView) => {
    setSelecting(true);
    setSelectedIds((prev) =>
      prev.includes(video.id) ? prev.filter((id) => id !== video.id) : [...prev, video.id],
    );
  };

  const exitSelecting = () => {
    setSelecting(false);
    setSelectedIds([]);
  };

  return (
    <div className="space-y-6">
      <Hero
        totalVideos={library.videos.length}
        totalSize={library.totalSize}
        categoryCount={library.categories.length}
      />

      <FilterBar
        categories={library.categories}
        categoryCounts={categoryCounts}
        onCreateCategory={async (name) => {
          await library.addCategory(name);
        }}
        onDeleteCategory={async (id) => {
          await library.removeCategory(id);
          if (activeCategoryId === id) setActiveCategoryId("all");
        }}
        activeCategoryId={activeCategoryId}
        onSelectCategory={setActiveCategoryId}
        activeTag={activeTag}
        onClearTag={() => void navigate({ to: "/", search: { tag: undefined } })}
        sort={sort}
        onSortChange={setSort}
        view={view}
        onViewChange={setView}
        resultCount={visible.length}
        selecting={selecting}
        onToggleSelecting={() => (selecting ? exitSelecting() : setSelecting(true))}
        selectedCount={selectedIds.length}
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
        selecting={selecting}
        selectedIds={selectedSet}
        onToggleSelect={toggleSelect}
        onLongPress={(v) => {
          setSelecting(true);
          setSelectedIds((prev) => (prev.includes(v.id) ? prev : [...prev, v.id]));
        }}
      />

      {selecting && selectedVideos.length > 0 && (
        <BatchTagBar
          selectedVideos={selectedVideos}
          tags={library.tags}
          categories={library.categories}
          onSetCategory={async (categoryId) => {
            await library.setCategoryForVideos(
              selectedVideos.map((v) => v.id),
              categoryId,
            );
          }}
          onEnsureTag={library.ensureTag}
          onAddTag={async (tagIds) => {
            await library.addTagToVideos(
              selectedVideos.map((v) => v.id),
              tagIds,
            );
          }}
          onRemoveTag={async (tagIds) => {
            await library.removeTagFromVideos(
              selectedVideos.map((v) => v.id),
              tagIds,
            );
          }}
          onClearSelection={exitSelecting}
          allSelected={visible.length > 0 && selectedVideos.length === visible.length}
          onSelectAll={() => setSelectedIds(visible.map((v) => v.id))}
        />
      )}
    </div>
  );
}
