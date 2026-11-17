// 视频库共享数据层：分类 + 视频列表加载、搜索/筛选/排序、下载、删除确认、上传完成刷新
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  createCategory,
  deleteVideo,
  fetchCategories,
  fetchVideos,
  publicUrl,
  type CategoryRow,
  type SortKey,
  type VideoRow,
  type VideoView,
} from "@/lib/site";

export interface VideoLibrary {
  categories: CategoryRow[];
  videos: VideoView[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** 新建分类（已存在则直接返回），供文件夹自动建类使用 */
  ensureCategory: (name: string) => Promise<CategoryRow>;
  refreshCategories: () => Promise<void>;
  setCategoriesLocal: (next: CategoryRow[]) => void;
  download: (video: VideoView) => void;
  remove: (video: VideoView) => Promise<void>;
  totalSize: number;
}

export function useVideoLibrary(): VideoLibrary {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [rows, setRows] = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cats, vids] = await Promise.all([fetchCategories(), fetchVideos()]);
      if (!mounted.current) return;
      setCategories(cats);
      setRows(vids);
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categoryMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.name);
    return m;
  }, [categories]);

  const videos = useMemo<VideoView[]>(
    () =>
      rows.map((r) => ({
        ...r,
        categoryName: (r.category_id && categoryMap.get(r.category_id)) || "未分类",
      })),
    [rows, categoryMap],
  );

  const ensureCategory = useCallback(
    async (rawName: string): Promise<CategoryRow> => {
      const name = rawName.trim().slice(0, 30);
      if (!name) throw new Error("分类名不能为空");
      const existing = categories.find(
        (c) => c.name.toLowerCase() === name.toLowerCase(),
      );
      if (existing) return existing;
      const created = await createCategory(name);
      if (mounted.current)
        setCategories((prev) =>
          prev.some((c) => c.id === created.id) ? prev : [...prev, created],
        );
      return created;
    },
    [categories],
  );

  const download = useCallback((video: VideoView) => {
    try {
      const url = publicUrl(video.storage_path);
      const a = document.createElement("a");
      a.href = url;
      a.download = video.original_name || video.title;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success(`开始下载「${video.title}」`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "下载失败");
    }
  }, []);

  const remove = useCallback(async (video: VideoView) => {
    try {
      await deleteVideo(video);
      if (mounted.current)
        setRows((prev) => prev.filter((r) => r.id !== video.id));
      toast.success(`已删除「${video.title}」`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    }
  }, []);

  const totalSize = useMemo(() => rows.reduce((s, r) => s + (r.size_bytes || 0), 0), [rows]);

  return {
    categories,
    videos,
    loading,
    error,
    reload: () => void load(),
    ensureCategory,
    refreshCategories: async () => {
      try {
        const cats = await fetchCategories();
        if (mounted.current) setCategories(cats);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "分类刷新失败");
      }
    },
    setCategoriesLocal: setCategories,
    download,
    remove,
    totalSize,
  };
}

/* ── 首页派生视图：搜索防抖 + 分类筛选 + 排序 ───────────── */

export function useFilteredVideos(
  videos: VideoView[],
  search: string,
  activeCategoryId: string | "all",
  sort: SortKey,
): { visible: VideoView[]; keyword: string } {
  const [debounced, setDebounced] = useState(search);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  const visible = useMemo(() => {
    const kw = debounced.trim().toLowerCase();
    let list = videos;
    if (activeCategoryId !== "all") {
      list = list.filter((v) => v.category_id === activeCategoryId);
    }
    if (kw) {
      list = list.filter((v) => v.title.toLowerCase().includes(kw));
    }
    const sorted = [...list];
    if (sort === "newest") sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    else if (sort === "oldest") sorted.sort((a, b) => a.created_at.localeCompare(b.created_at));
    else sorted.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    return sorted;
  }, [videos, debounced, activeCategoryId, sort]);

  return { visible, keyword: debounced };
}
