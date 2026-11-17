// 分类筛选条（永远单行，超出横向滚动）+ 排序/视图/多选工具行
// 标签筛选不再常驻首页：从「分类与标签」页点标签进来时，只在工具行显示一条可清除的提示
import { CheckSquare, LayoutGrid, List, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CategoryChipMenu } from "@/components/CategoryChipMenu";
import type { FilterBarProps } from "@/types";

const SORT_LABELS: Record<FilterBarProps["sort"], string> = {
  newest: "最新上传",
  oldest: "最早上传",
  title: "标题 A→Z",
};

const SORT_CYCLE = ["newest", "oldest", "title"] as const;

export function FilterBar({
  categories,
  categoryCounts,
  onCreateCategory,
  onDeleteCategory,
  activeCategoryId,
  onSelectCategory,
  activeTag,
  onClearTag,
  sort,
  onSortChange,
  view,
  onViewChange,
  resultCount,
  selecting,
  onToggleSelecting,
  selectedCount,
}: FilterBarProps) {
  return (
    <div className="space-y-3">
      {/* 分类胶囊条：始终单行，分类再多也只是横向滚动；末尾固定的「+」用来新建 / 删除分类 */}
      <div className="flex items-center gap-1.5 pb-1">
        <div className="no-scrollbar -mx-4 flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <button
            type="button"
            className="chip shrink-0 whitespace-nowrap"
            data-active={activeCategoryId === "all"}
            onClick={() => onSelectCategory("all")}
          >
            全部
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className="chip shrink-0 whitespace-nowrap"
              data-active={activeCategoryId === c.id}
              onClick={() => onSelectCategory(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
        {onCreateCategory && onDeleteCategory && (
          <CategoryChipMenu
            categories={categories}
            counts={categoryCounts}
            onCreate={onCreateCategory}
            onDelete={onDeleteCategory}
            onSelect={onSelectCategory}
          />
        )}
      </div>

      {/* 工具行 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="text-sm text-muted-foreground">
            共{" "}
            <span className="font-semibold tabular-nums text-foreground">{resultCount}</span> 个视频
            {selecting && <span className="ml-2 text-film">已选 {selectedCount} 个</span>}
          </p>
          {activeTag && (
            <span className="inline-flex items-center gap-1 rounded-full border border-film/25 bg-film/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-film">
              标签：#{activeTag.name}
              <button
                type="button"
                aria-label={`清除标签筛选 ${activeTag.name}`}
                className="grid h-5 w-5 place-items-center rounded-full text-film/70 transition-colors hover:bg-film/15 hover:text-film"
                onClick={onClearTag}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleSelecting}
            aria-pressed={selecting}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors",
              selecting
                ? "border-film bg-film text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:border-film/40 hover:text-foreground",
            )}
          >
            <CheckSquare className="h-3.5 w-3.5" />
            {selecting ? "退出多选" : "多选"}
          </button>
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
