// 跨组件共享的 Props 接口与视图类型（Swarms 子任务统一 import type 使用）
import type { CategoryRow, VideoView } from "@/lib/site";

export type { CategoryRow, VideoView };

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

/** 分类筛选条 + 排序/视图切换工具行 */
export interface FilterBarProps {
  categories: CategoryRow[];
  activeCategoryId: string | "all";
  onSelectCategory: (id: string | "all") => void;
  sort: SortKeyLite;
  onSortChange: (s: SortKeyLite) => void;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  onManageCategories: () => void;
  resultCount: number;
}

export type SortKeyLite = "newest" | "oldest" | "title";
export type ViewMode = "grid" | "list";

/** 单个视频卡片（网格/列表两种呈现） */
export interface VideoCardProps {
  video: VideoView;
  view: ViewMode;
  onDownload: (video: VideoView) => void;
  onDelete: (video: VideoView) => void;
}

/** 视频网格容器（含空态） */
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
}

/** 上传弹窗 */
export interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: CategoryRow[];
  /** 需要新建分类时（文件夹上传自动建类 / 手动新建），返回新分类 */
  onEnsureCategory: (name: string) => Promise<CategoryRow>;
  /** 全部上传结束后刷新列表 */
  onFinished: () => void;
}

/** 分类管理弹窗 */
export interface CategoryManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
