// 标签管理面板（「分类与标签」页用）：新建 / 重命名 / 删除；点标签名跳回首页按它筛选
// 标签是大范围（动漫 / 电影 / 音乐…），分类是细粒度；两者互不冲突
import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
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
import { createTag, deleteTag, renameTag, type TagRow } from "@/lib/site";

export interface TagManagerPanelProps {
  tags: TagRow[];
  onChanged: () => void;
}

export function TagManagerPanel({ tags, onChanged }: TagManagerPanelProps) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const target = tags.find((t) => t.id === pendingDelete) ?? null;

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

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    void guard(async () => {
      const created = await createTag(name);
      setNewName("");
      const existed = tags.some((t) => t.id === created.id);
      toast.success(existed ? `标签「${created.name}」已存在，已复用` : `已新建标签「${created.name}」`);
      onChanged();
    });
  };

  const doRename = (id: string) => {
    const name = editingName.trim();
    if (!name) return;
    void guard(async () => {
      await renameTag(id, name);
      setEditingId(null);
      toast.success("标签已重命名");
      onChanged();
    });
  };

  const doDelete = () => {
    if (!target) return;
    void guard(async () => {
      await deleteTag(target.id);
      toast.success(
        target.video_count > 0
          ? `已删除标签「${target.name}」，${target.video_count} 个视频不受影响`
          : `已删除标签「${target.name}」`,
      );
      setPendingDelete(null);
      onChanged();
    });
  };

  return (
    <>
      <div className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="新标签名称，如「动漫」「电影」「音乐」…"
            maxLength={30}
            className="h-10"
          />
          <Button
            className="h-10 shrink-0 rounded-full bg-film px-4 text-primary-foreground hover:bg-film-deep sm:px-5"
            onClick={add}
            disabled={busy || !newName.trim()}
          >
            <Plus className="h-4 w-4" /> 新建
          </Button>
        </div>

        {tags.length === 0 ? (
          <p className="rounded-2xl border border-border/60 bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            还没有标签。上面输入名称即可新建；同名（含全角 / 大小写差异）会自动合并成一个。
          </p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-2xl border border-border/60 bg-card">
            {tags.map((t) => {
              const editing = editingId === t.id;
              return (
                <li key={t.id} className="group flex items-center gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
                  {editing ? (
                    <>
                      <Input
                        autoFocus
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") doRename(t.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        maxLength={30}
                        className="h-9"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0 text-emerald-600"
                        onClick={() => doRename(t.id)}
                        aria-label="保存"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        onClick={() => setEditingId(null)}
                        aria-label="取消"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      {/* 点名字 = 回首页按这个标签筛选 */}
                      <Link
                        to="/"
                        search={{ tag: t.id }}
                        className="min-w-0 flex-1 truncate text-sm font-medium underline-offset-4 hover:underline"
                        aria-label={`按标签 ${t.name} 筛选视频`}
                      >
                        #{t.name}
                        <span className="ml-2 text-xs font-normal tabular-nums text-muted-foreground">
                          {t.video_count} 个视频
                        </span>
                      </Link>
                      <button
                        type="button"
                        aria-label={`重命名${t.name}`}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-opacity hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                        onClick={() => {
                          setEditingId(t.id);
                          setEditingName(t.name);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`删除${t.name}`}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-opacity hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                        onClick={() => setPendingDelete(t.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-xs leading-relaxed text-muted-foreground">
          删除标签只解除它与视频的关联，不会删除任何视频。首页不再显示标签条 —— 想按标签筛，就在上面点一下标签名。
        </p>
      </div>

      <AlertDialog open={!!target} onOpenChange={(v) => !v && setPendingDelete(null)}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-sm">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle>删除标签「{target?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              {target && target.video_count > 0
                ? `有 ${target.video_count} 个视频带着这个标签，删除后标签消失，视频本身不受影响。`
                : "该标签下没有视频，可安全删除。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">取消</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={doDelete}
            >
              删除标签
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
