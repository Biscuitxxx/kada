// 分类横向滚动胶囊 + 排序/视图切换工具行
import { LayoutGrid, List, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FilterBarProps } from "@/types";

const SORT_LABELS: Record<FilterBarProps["sort"], string> = {
  newest: "最新上传",
  oldest: "最早上传",
  title: "标题 A→Z",
};

const SORT_CYCLE = ["newest", "oldest", "title"] as const;

export function FilterBar({
  categories,
  activeCategoryId,
  onSelectCategory,
  sort,
  onSortChange,
  view,
  onViewChange,
  onManageCategories,
  resultCount,
}: FilterBarProps) {
  return (
    <div className="space-y-3">
      {/* 分类胶囊条：移动端横向滚动 */}
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <button
          type="button"
          className="chip"
          data-active={activeCategoryId === "all"}
          onClick={() => onSelectCategory("all")}
        >
          全部
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className="chip"
            data-active={activeCategoryId === c.id}
            onClick={() => onSelectCategory(c.id)}
          >
            {c.name}
          </button>
        ))}
        <button
          type="button"
          onClick={onManageCategories}
          className="chip !border-dashed text-muted-foreground"
          aria-label="管理分类"
        >
          <Settings2 className="h-3.5 w-3.5" />
          管理
        </button>
      </div>

      {/* 工具行 */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          共 <span className="font-semibold tabular-nums text-foreground">{resultCount}</span> 个视频
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              const i = SORT_CYCLE.indexOf(sort);
              onSortChange(SORT_CYCLE[(i + 1) % SORT_CYCLE.length]);
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-film/40 hover:text-foreground"
          >
            {SORT_LABELS[sort]}
          </button>
          <div className="flex h-8 items-center rounded-lg border border-border bg-card p-0.5">
            <ViewBtn active={view === "grid"} onClick={() => onViewChange("grid")} label="网格视图">
              <LayoutGrid className="h-4 w-4" />
            </ViewBtn>
            <ViewBtn active={view === "list"} onClick={() => onViewChange("list")} label="列表视图">
              <List className="h-4 w-4" />
            </ViewBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

function ViewBtn({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "grid h-7 w-7 place-items-center rounded-md transition-colors",
        active
          ? "bg-film text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
