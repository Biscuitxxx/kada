// 标签选择弹窗：勾选已有标签 + 现场新建（同名自动复用）
// 三种用法：加标签（add）、移除标签（remove）、整体设置（set，详情页用）
import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Tag as TagIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TagPillButton } from "@/components/TagPill";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { TagRow } from "@/lib/site";

export interface TagPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tags: TagRow[];
  mode: "add" | "remove" | "set";
  /** set 模式下的初始勾选；add/remove 一般留空 */
  initialSelected?: string[];
  title?: string;
  description?: string;
  onEnsureTag: (name: string) => Promise<TagRow>;
  onConfirm: (tagIds: string[]) => Promise<void>;
}

export function TagPickerDialog({
  open,
  onOpenChange,
  tags,
  mode,
  initialSelected,
  title,
  description,
  onEnsureTag,
  onConfirm,
}: TagPickerDialogProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setSelected(mode === "set" ? (initialSelected ?? []) : []);
      setNewName("");
      setBusy(false);
    }
  }, [open, mode, initialSelected]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const createAndSelect = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const tag = await onEnsureTag(name);
      setSelected((prev) => (prev.includes(tag.id) ? prev : [...prev, tag.id]));
      setNewName("");
      toast.success(`已加入「${tag.name}」`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "新建标签失败");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (selected.length === 0) {
      toast.info(mode === "remove" ? "请先选择要移除的标签" : "请先选择标签");
      return;
    }
    setBusy(true);
    try {
      await onConfirm(selected);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const defaultTitle =
    mode === "add" ? "添加标签" : mode === "remove" ? "移除标签" : "设置标签";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-md flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/60 px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-base font-bold tracking-tight">
            <TagIcon className="h-4 w-4 text-film" />
            {title ?? defaultTitle}
          </DialogTitle>
          {description && (
            <DialogDescription className="text-xs text-muted-foreground">{description}</DialogDescription>
          )}
        </DialogHeader>

        <div className="overflow-y-auto px-5 py-4">
          {/* 新建 */}
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createAndSelect();
              }}
              placeholder="新建标签，如「翻唱」「教程」…"
              maxLength={30}
              className="h-9"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-9 shrink-0 rounded-full"
              onClick={() => void createAndSelect()}
              disabled={busy || !newName.trim()}
            >
              <Plus className="h-4 w-4" /> 新建
            </Button>
          </div>

          {tags.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              还没有标签，直接在上面输入名称新建。
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {tags.map((t) => {
                const on = selectedSet.has(t.id);
                return (
                  <TagPillButton
                    key={t.id}
                    name={t.name}
                    count={t.video_count}
                    active={on}
                    aria-pressed={on}
                    leading={on ? <Check className="h-3.5 w-3.5 shrink-0" /> : undefined}
                    onClick={() => toggle(t.id)}
                  />
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border/60 px-5 py-3.5 sm:justify-between">
          <p className="text-xs tabular-nums text-muted-foreground">已选 {selected.length} 个标签</p>
          <div className="flex gap-2">
            <Button variant="ghost" className="rounded-full" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              className={cn(
                "rounded-full text-primary-foreground",
                mode === "remove" ? "bg-destructive hover:bg-destructive/90" : "bg-film hover:bg-film-deep",
              )}
              onClick={() => void confirm()}
              disabled={busy || selected.length === 0}
            >
              {mode === "add" ? "添加" : mode === "remove" ? "移除" : "保存"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
