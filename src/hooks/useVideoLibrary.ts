// 视频库共享数据层：分类 + 视频列表加载、搜索/筛选/排序、下载、删除确认、上传完成刷新
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  bulkSetCategory,
  bulkTagVideos,
  createCategory,
  createTag,
  deleteCategory,
  deleteVideo,
  fetchCategories,
  fetchTags,
  fetchVideos,
  publicUrl,
  setVideoTags,
  type CategoryRow,
  type SortKey,
  type TagRow,
  type VideoRow,
  type VideoView,
} from "@/lib/site";

export interface VideoLibrary {
  categories: CategoryRow[];
  tags: TagRow[];
  videos: VideoView[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** 新建分类（已存在则直接返回），供文件夹自动建类使用 */
  ensureCategory: (name: string) => Promise<CategoryRow>;
  /** 首页分类条「+」新建分类（同名抛错） */
  addCategory: (name: string) => Promise<CategoryRow>;
  /** 首页分类条「+」删除分类（视频归入未分类，随后重新拉数据） */
  removeCategory: (id: string) => Promise<void>;
  /** 新建标签（同名复用），返回标签本身 */
  ensureTag: (name: string) => Promise<TagRow>;
  /** 批量给视频加标签（首页多选 / 详情页） */
  addTagToVideos: (videoIds: string[], tagIds: string[]) => Promise<void>;
  /** 批量移除标签 */
  removeTagFromVideos: (videoIds: string[], tagIds: string[]) => Promise<void>;
  /** 详情页：整体替换某个视频的标签 */
  setVideoTagIds: (videoId: string, tagIds: string[]) => Promise<void>;
  /** 批量把选中视频改成同一个分类（null = 未分类） */
  setCategoryForVideos: (videoIds: string[], categoryId: string | null) => Promise<void>;
  refreshCategories: () => Promise<void>;
  setCategoriesLocal: (next: CategoryRow[]) => void;
  download: (video: VideoView) => void;
  remove: (video: VideoView) => Promise<void>;
  totalSize: number;
}

export function useVideoLibrary(): VideoLibrary {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);
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
      const [cats, vids, tagRows] = await Promise.all([fetchCategories(), fetchVideos(), fetchTags()]);
      if (!mounted.current) return;
      setCategories(cats);
      setTags(tagRows);
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

  const tagMap = useMemo(() => {
    const m = new Map<string, TagRow>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);

  const videos = useMemo<VideoView[]>(
    () =>
      rows.map((r) => ({
        ...r,
        categoryName: (r.category_id && categoryMap.get(r.category_id)) || "未分类",
        tags: (r.tag_ids ?? [])
          .map((id) => tagMap.get(id))
          .filter((t): t is TagRow => Boolean(t)),
      })),
    [rows, categoryMap, tagMap],
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

  const ensureTag = useCallback(
    async (rawName: string): Promise<TagRow> => {
      const name = rawName.replace(/\s+/g, " ").trim().slice(0, 30);
      if (!name) throw new Error("标签名不能为空");
      const key = name.normalize("NFKC").toLowerCase();
      const existing = tags.find((t) => t.name.normalize("NFKC").toLowerCase() === key);
      if (existing) return existing;
      const created = await createTag(name);
      if (mounted.current)
        setTags((prev) => (prev.some((t) => t.id === created.id) ? prev : [...prev, created]));
      return created;
    },
    [tags],
  );

  const addTagToVideos = useCallback(async (videoIds: string[], tagIds: string[]) => {
    if (videoIds.length === 0 || tagIds.length === 0) return;
    await bulkTagVideos(videoIds, tagIds, "add");
    if (!mounted.current) return;
    // 本地先合并，避免等 reload 才有反馈
    setRows((prev) =>
      prev.map((r) =>
        videoIds.includes(r.id)
          ? { ...r, tag_ids: [...new Set([...(r.tag_ids ?? []), ...tagIds])] }
          : r,
      ),
    );
    setTags((prev) =>
      prev.map((t) =>
        tagIds.includes(t.id)
          ? { ...t, video_count: t.video_count + videoIds.length }
          : t,
      ),
    );
  }, []);

  const removeTagFromVideos = useCallback(async (videoIds: string[], tagIds: string[]) => {
    if (videoIds.length === 0 || tagIds.length === 0) return;
    await bulkTagVideos(videoIds, tagIds, "remove");
    if (!mounted.current) return;
    setRows((prev) =>
      prev.map((r) =>
        videoIds.includes(r.id)
          ? { ...r, tag_ids: (r.tag_ids ?? []).filter((id) => !tagIds.includes(id)) }
          : r,
      ),
    );
    setTags((prev) =>
      prev.map((t) =>
        tagIds.includes(t.id)
          ? { ...t, video_count: Math.max(0, t.video_count - videoIds.length) }
          : t,
      ),
    );
  }, []);

  const setVideoTagIds = useCallback(async (videoId: string, tagIds: string[]) => {
    await setVideoTags(videoId, tagIds);
    if (!mounted.current) return;
    setRows((prev) => prev.map((r) => (r.id === videoId ? { ...r, tag_ids: tagIds } : r)));
  }, []);

  const setCategoryForVideos = useCallback(
    async (videoIds: string[], categoryId: string | null) => {
      if (videoIds.length === 0) return;
      await bulkSetCategory(videoIds, categoryId);
      if (!mounted.current) return;
      setRows((prev) =>
        prev.map((r) => (videoIds.includes(r.id) ? { ...r, category_id: categoryId } : r)),
      );
    },
    [],
  );

  const addCategory = useCallback(
    async (rawName: string) => {
      const name = rawName.replace(/\s+/g, " ").trim().slice(0, 30);
      if (!name) throw new Error("分类名不能为空");
      if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase()))
        throw new Error(`分类「${name}」已存在`);
      const created = await createCategory(name);
      if (mounted.current)
        setCategories((prev) =>
          prev.some((c) => c.id === created.id) ? prev : [...prev, created],
        );
      return created;
    },
    [categories],
  );

  const removeCategory = useCallback(async (id: string) => {
    await deleteCategory(id);
    if (!mounted.current) return;
    setCategories((prev) => prev.filter((c) => c.id !== id));
    // 被删分类下的视频已归入「未分类」，重新拉一遍让卡片上的分类徽章跟着变
    void load();
  }, []);

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
    tags,
    videos,
    loading,
    error,
    reload: () => void load(),
    ensureCategory,
    addCategory,
    removeCategory,
    ensureTag,
    addTagToVideos,
    removeTagFromVideos,
    setVideoTagIds,
    setCategoryForVideos,
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

/* ── 首页派生视图：搜索防抖 + 分类/标签筛选 + 排序 ─────── */

export function useFilteredVideos(
  videos: VideoView[],
  search: string,
  activeCategoryId: string | "all",
  activeTagId: string | "all",
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
    if (activeTagId !== "all") {
      list = list.filter((v) => (v.tag_ids ?? []).includes(activeTagId));
    }
    if (kw) {
      // 标题命中，或任一标签名命中
      list = list.filter(
        (v) =>
          v.title.toLowerCase().includes(kw) ||
          v.tags.some((t) => t.name.toLowerCase().includes(kw)),
      );
    }
    const sorted = [...list];
    if (sort === "newest") sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    else if (sort === "oldest") sorted.sort((a, b) => a.created_at.localeCompare(b.created_at));
    else sorted.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    return sorted;
  }, [videos, debounced, activeCategoryId, activeTagId, sort]);

  return { visible, keyword: debounced };
}
