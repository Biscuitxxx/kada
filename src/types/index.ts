// 跨组件共享的 Props 接口与视图类型（Swarms 子任务统一 import type 使用）
import type { CategoryRow, TagRow, VideoView } from "@/lib/site";

export type { CategoryRow, TagRow, VideoView };

/** 顶部导航栏 */
export interface TopBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  onUploadClick: () => void;
}

/** 首页横幅统计区 */
export interface HeroProps {
  totalVideos: number;
  totalSize: number;
  categoryCount: number;
}

/** 分类筛选条（单行）+ 排序/视图切换工具行；标签筛选只在拉过来时显示一条提示 */
export interface FilterBarProps {
  categories: CategoryRow[];
  /** 每个分类下的视频数（给分类条的「+」面板显示 / 删除提示用） */
  categoryCounts?: Map<string, number>;
  /** 分类条末尾「+」：就地新建分类（同名冲突时抛错） */
  onCreateCategory?: (name: string) => Promise<void>;
  /** 分类条末尾「+」：就地删除分类（视频归入未分类） */
  onDeleteCategory?: (id: string) => Promise<void>;
  activeCategoryId: string | "all";
  onSelectCategory: (id: string | "all") => void;
  /** 从标签页点进来时带过来的标签，可为空；由工具行显示「标签：#x」并支持清除 */
  activeTag?: { id: string; name: string } | null;
  onClearTag?: () => void;
  sort: SortKeyLite;
  onSortChange: (s: SortKeyLite) => void;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  resultCount: number;
  /** 多选模式开关 */
  selecting: boolean;
  onToggleSelecting: () => void;
  selectedCount: number;
}

export type SortKeyLite = "newest" | "oldest" | "title";
export type ViewMode = "grid" | "list";

/** 单个视频卡片（网格/列表两种呈现；多选模式下显示勾选圈） */
export interface VideoCardProps {
  video: VideoView;
  view: ViewMode;
  onDownload: (video: VideoView) => void;
  onDelete: (video: VideoView) => void;
  selecting: boolean;
  selected: boolean;
  onToggleSelect: (video: VideoView) => void;
  onLongPress: (video: VideoView) => void;
}

/** 视频网格容器（含空态与多选） */
export interface VideoGridProps {
  videos: VideoView[];
  loading: boolean;
  error: string | null;
  view: ViewMode;
  searchKeyword: string;
  onClearSearch: () => void;
  onRetry: () => void;
  onUploadClick: () => void;
  onDownload: (video: VideoView) => void;
  onDelete: (video: VideoView) => void;
  selecting: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (video: VideoView) => void;
  onLongPress: (video: VideoView) => void;
}

/** 首页多选后的批量操作条 */
export interface BatchTagBarProps {
  selectedVideos: VideoView[];
  tags: TagRow[];
  onEnsureTag: (name: string) => Promise<TagRow>;
  onAddTag: (tagIds: string[]) => Promise<void>;
  onRemoveTag: (tagIds: string[]) => Promise<void>;
  /** 分类是单选，批量即「整批改成这个分类」 */
  categories: CategoryRow[];
  onSetCategory: (categoryId: string | null) => Promise<void>;
  onClearSelection: () => void;
  /** 当前筛选结果是否已全选 */
  allSelected: boolean;
  onSelectAll: () => void;
}

/** 上传弹窗 */
export interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: CategoryRow[];
  /** 已有标签，用于上传前批量打标签 */
  tags: TagRow[];
  /** 需要新建分类时（文件夹上传自动建类 / 手动新建），返回新分类 */
  onEnsureCategory: (name: string) => Promise<CategoryRow>;
  /** 新建标签（同名复用） */
  onEnsureTag: (name: string) => Promise<TagRow>;
  /** 全部上传结束后刷新列表 */
  onFinished: () => void;
}

/** 分类管理弹窗 */
export interface CategoryManagerProps {
  categories: CategoryRow[];
  videoCounts: Map<string, number>;
  onChanged: () => void;
}

/** 详情页编辑弹窗 */
export interface VideoEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  video: VideoView | null;
  categories: CategoryRow[];
  onSave: (patch: { title: string; categoryId: string | null }) => Promise<void>;
}
