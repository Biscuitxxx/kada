// 分类管理：新建 / 重命名 / 删除（内置「未分类」不可删；删除后视频归入未分类）
import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { createCategory, deleteCategory, renameCategory } from "@/lib/site";
import type { CategoryManagerProps } from "@/types";

export function CategoryManager({
  open,
  onOpenChange,
  categories,
  videoCounts,
  onChanged,
}: CategoryManagerProps) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const target = categories.find((c) => c.id === pendingDelete) ?? null;
  const targetCount = target ? (videoCounts.get(target.id) ?? 0) : 0;

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const addCategory = () => {
    const name = newName.trim();
    if (!name) return;
    void guard(async () => {
      await renameGuardName(name);
      await createCategory(name);
      setNewName("");
      toast.success(`已新建分类「${name}」`);
      onChanged();
    });
  };

  const renameGuardName = async (name: string) => {
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`分类「${name}」已存在`);
    }
  };

  const doRename = (id: string) => {
    const name = editingName.trim();
    if (!name) return;
    void guard(async () => {
      await renameGuardName(name);
      await renameCategory(id, name);
      setEditingId(null);
      toast.success("分类已重命名");
      onChanged();
    });
  };

  const doDelete = () => {
    if (!target) return;
    void guard(async () => {
      await deleteCategory(target.id);
      toast.success(
        targetCount > 0
          ? `已删除「${target.name}」，其中 ${targetCount} 个视频归入未分类`
          : `已删除「${target.name}」`,
      );
      setPendingDelete(null);
      onChanged();
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
          <DialogHeader className="text-left">
            <DialogTitle className="text-base font-bold tracking-tight">管理分类</DialogTitle>
          </DialogHeader>

          {/* 新建 */}
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCategory()}
              placeholder="新分类名称…"
              maxLength={30}
              className="h-9"
            />
            <Button
              size="sm"
              className="h-9 shrink-0 rounded-full bg-film px-4 text-primary-foreground hover:bg-film-deep"
              onClick={addCategory}
              disabled={busy || !newName.trim()}
            >
              <Plus className="h-4 w-4" /> 新建
            </Button>
          </div>

          <ul className="max-h-[45vh] space-y-1 overflow-y-auto py-1">
            {categories.map((c) => {
              const count = videoCounts.get(c.id) ?? 0;
              const editing = editingId === c.id;
              return (
                <li
                  key={c.id}
                  className="group flex items-center gap-2 rounded-xl px-2.5 py-2 transition-colors hover:bg-secondary/70"
                >
                  {editing ? (
                    <>
                      <Input
                        autoFocus
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") doRename(c.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        maxLength={30}
                        className="h-8"
                      />
                      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-emerald-600" onClick={() => doRename(c.id)} aria-label="保存">
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setEditingId(null)} aria-label="取消">
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {c.name}
                        {c.is_default && (
                          <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground">内置</span>
                        )}
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">{count} 个视频</span>
                      <button
                        type="button"
                        aria-label={`重命名${c.name}`}
                        className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                        onClick={() => {
                          setEditingId(c.id);
                          setEditingName(c.name);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {!c.is_default && (
                        <button
                          type="button"
                          aria-label={`删除${c.name}`}
                          className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                          onClick={() => setPendingDelete(c.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          <p className="text-xs leading-relaxed text-muted-foreground">
            删除分类不会删除视频，其中的视频将归入「未分类」。
          </p>
        </DialogContent>
      </Dialog>

      {/* 删除二次确认 */}
      <AlertDialog open={!!target} onOpenChange={(v) => !v && setPendingDelete(null)}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-sm">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle>删除分类「{target?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              {targetCount > 0
                ? `该分类下有 ${targetCount} 个视频，删除后它们会归入「未分类」，视频文件本身不受影响。`
                : "该分类下没有视频，可安全删除。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">取消</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={doDelete}
            >
              删除分类
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
