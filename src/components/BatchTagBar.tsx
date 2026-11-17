// 首页多选后的底部批量操作条：设置分类 / 加标签 / 移除标签 / 全选 / 取消
// 分类是单选，所以批量语义是「整批改成这个分类」；标签可多选增删
import { useEffect, useState } from "react";
import { CheckSquare, FolderTree, Tag, Tags, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { TagPickerDialog } from "@/components/TagPickerDialog";
import type { BatchTagBarProps } from "@/types";

export function BatchTagBar({
  selectedVideos,
  tags,
  onEnsureTag,
  onAddTag,
  onRemoveTag,
  categories,
  onSetCategory,
  onClearSelection,
  allSelected,
  onSelectAll,
}: BatchTagBarProps) {
  const [picker, setPicker] = useState<"add" | "remove" | null>(null);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const count = selectedVideos.length;

  // 选中项分类一致时显示那个分类，混合时显示「设为分类」
  const currentCategory = useCategorySummary(selectedVideos);
  const currentName =
    currentCategory === "mixed"
      ? null
      : (categories.find((c) => c.id === currentCategory)?.name ?? "未分类");

  const applyCategory = async (categoryId: string | null) => {
    setCategoryOpen(false);
    setBusy(true);
    try {
      await onSetCategory(categoryId);
      const name = categories.find((c) => c.id === categoryId)?.name ?? "未分类";
      toast.success(`已把 ${count} 个视频设为「${name}」`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "设置分类失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        className="sticky bottom-3 z-30 mt-4 animate-in fade-in slide-in-from-bottom-2 rounded-2xl border border-border/70 bg-card/95 px-3 py-2.5 shadow-[0_-6px_24px_-8px_rgba(0,0,0,0.25)] backdrop-blur supports-[backdrop-filter]:bg-card/80"
        role="toolbar"
        aria-label="批量操作"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-film px-2.5 py-1 text-xs font-semibold text-primary-foreground">
            已选 {count}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-full text-xs"
            onClick={() => setCategoryOpen((v) => !v)}
            aria-expanded={categoryOpen}
            disabled={busy}
          >
            <FolderTree className="h-3.5 w-3.5" />
            {currentName ? `分类：${currentName}` : "设为分类"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-full text-xs"
            onClick={() => setPicker("add")}
          >
            <Tag className="h-3.5 w-3.5" /> 加标签
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-full text-xs"
            onClick={() => setPicker("remove")}
          >
            <Tags className="h-3.5 w-3.5" /> 移除标签
          </Button>
          {!allSelected && (
            <Button size="sm" variant="ghost" className="h-8 rounded-full text-xs" onClick={onSelectAll}>
              <CheckSquare className="h-3.5 w-3.5" /> 全选本页
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-8 rounded-full text-xs text-muted-foreground"
            onClick={onClearSelection}
          >
            <X className="h-3.5 w-3.5" /> 取消选择
          </Button>
        </div>

        {/* 分类选择：点一下直接生效，不再多一层确认框 */}
        {categoryOpen && (
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border/60 pt-2">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={busy}
                onClick={() => void applyCategory(c.id)}
                className="chip shrink-0 whitespace-nowrap text-xs"
                data-active={currentCategory === c.id}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <TagPickerDialog
        open={picker !== null}
        onOpenChange={(open) => !open && setPicker(null)}
        tags={tags}
        mode={picker ?? "add"}
        title={picker === "remove" ? "从选中的视频移除标签" : "给选中的视频加标签"}
        description={`将对 ${count} 个视频生效`}
        onEnsureTag={onEnsureTag}
        onConfirm={async (tagIds) => {
          if (picker === "remove") {
            await onRemoveTag(tagIds);
            toast.success(`已从 ${count} 个视频移除 ${tagIds.length} 个标签`);
          } else {
            await onAddTag(tagIds);
            toast.success(`已给 ${count} 个视频加上 ${tagIds.length} 个标签`);
          }
        }}
      />
    </>
  );
}

/** 选中项分类是否一致：一致返回分类 id（null 表示都未分类），否则 "mixed" */
function useCategorySummary(selectedVideos: BatchTagBarProps["selectedVideos"]) {
  const [summary, setSummary] = useState<string | null | "mixed">(
    selectedVideos[0]?.category_id ?? null,
  );
  useEffect(() => {
    const first = selectedVideos[0]?.category_id ?? null;
    const same = selectedVideos.every((v) => (v.category_id ?? null) === first);
    setSummary(same ? first : "mixed");
  }, [selectedVideos]);
  return summary;
}
