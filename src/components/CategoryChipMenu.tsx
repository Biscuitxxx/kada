// 首页分类条末尾的「+」按钮：就地新建 / 删除分类，不用再跳到分类页
// 删除前二次确认，提示其视频会归入「未分类」；重命名等完整管理仍在 /categories
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Plus, Trash2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type { CategoryRow } from "@/types";

interface CategoryChipMenuProps {
  categories: CategoryRow[];
  counts?: Map<string, number>;
  onCreate: (name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** 点分类名直接按它筛（列表行本身也是筛选项） */
  onSelect?: (id: string) => void;
}

export function CategoryChipMenu({ categories, counts, onCreate, onDelete, onSelect }: CategoryChipMenuProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<CategoryRow | null>(null);
  const [placement, setPlacement] = useState<"down" | "up">("down");
  const rootRef = useRef<HTMLDivElement | null>(null);

  const pendingCount = pending ? (counts?.get(pending.id) ?? 0) : 0;

  // 下方空间不够时改成向上展开，避免面板被屏幕底边裁掉
  useEffect(() => {
    if (!open || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    setPlacement(window.innerHeight - rect.bottom < 320 ? "up" : "down");
  }, [open]);

  // 点面板外面 / 按 Esc 收起
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const submit = () => {
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true);
    void (async () => {
      try {
        await onCreate(value);
        setName("");
        toast.success(`已新建分类「${value}」`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "新建分类失败");
      } finally {
        setBusy(false);
      }
    })();
  };

  const confirmDelete = () => {
    const target = pending;
    if (!target) return;
    setBusy(true);
    void (async () => {
      try {
        await onDelete(target.id);
        toast.success(
          pendingCount > 0
            ? `已删除「${target.name}」，其中 ${pendingCount} 个视频归入未分类`
            : `已删除「${target.name}」`,
        );
        setPending(null);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "删除分类失败");
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <>
      <div ref={rootRef} className="relative shrink-0">
        <button
          type="button"
          aria-label="新建或删除分类"
          aria-expanded={open}
          title="新建 / 删除分类"
          onClick={() => setOpen((v) => !v)}
          className="chip shrink-0 gap-1 whitespace-nowrap pl-2.5 pr-2 text-xs"
          data-active={open}
        >
          <Plus className="h-3.5 w-3.5" />
          分类
        </button>

        {open && (
          <div
            className={cn(
              "absolute right-0 z-30 w-[17rem] overflow-hidden rounded-2xl border border-border bg-card shadow-lg",
              placement === "down" ? "top-[calc(100%+0.4rem)]" : "bottom-[calc(100%+0.4rem)]",
            )}
          >
            <div className="flex items-center gap-1.5 border-b border-border/60 p-2">
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="新分类名称…"
                maxLength={30}
                className="h-8 text-sm"
              />
              <button
                type="button"
                onClick={submit}
                disabled={busy || !name.trim()}
                aria-label="新建分类"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-film text-primary-foreground transition-opacity disabled:opacity-40"
              >
                <Check className="h-4 w-4" />
              </button>
            </div>

            <ul className="max-h-64 overflow-y-auto py-1">
              {categories.map((c) => {
                const count = counts?.get(c.id) ?? 0;
                return (
                  <li
                    key={c.id}
                    className="flex items-center gap-2 px-2.5 py-1.5 text-sm hover:bg-accent/60"
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => {
                        setOpen(false);
                        onSelect?.(c.id);
                      }}
                      aria-label={`筛选分类 ${c.name}`}
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {c.name}
                        {c.is_default && (
                          <span className="ml-1.5 rounded bg-accent px-1 py-0.5 align-middle text-[10px] font-normal text-accent-foreground">
                            内置
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {count}
                      </span>
                    </button>
                    {!c.is_default && (
                      <button
                        type="button"
                        aria-label={`删除分类 ${c.name}`}
                        disabled={busy}
                        onClick={() => {
                          setOpen(false);
                          setPending(c);
                        }}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="flex items-center justify-between gap-2 border-t border-border/60 px-2.5 py-2">
              <span className="text-[11px] leading-tight text-muted-foreground">
                删除不删视频，归入未分类
              </span>
              <Link
                to="/categories"
                onClick={() => setOpen(false)}
                className="shrink-0 text-[11px] font-medium text-film hover:underline"
              >
                重命名 / 更多 →
              </Link>
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={!!pending} onOpenChange={(v) => !v && setPending(null)}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-sm">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle>删除分类「{pending?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingCount > 0
                ? `该分类下有 ${pendingCount} 个视频，删除后它们会归入「未分类」，视频文件本身不受影响。`
                : "该分类下没有视频，可安全删除。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">取消</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              删除分类
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
