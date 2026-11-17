// 详情页编辑弹窗：重命名 + 改分类
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { VideoEditDialogProps } from "@/types";

const UNCATEGORIZED = "__uncategorized__";

export function VideoEditDialog({
  open,
  onOpenChange,
  video,
  categories,
  onSave,
}: VideoEditDialogProps) {
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState<string>(UNCATEGORIZED);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && video) {
      setTitle(video.title);
      setCategoryId(video.category_id ?? UNCATEGORIZED);
    }
  }, [open, video]);

  const canSave = title.trim().length > 0 && !saving;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        categoryId: categoryId === UNCATEGORIZED ? null : categoryId,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle className="text-base font-bold tracking-tight">编辑视频信息</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <label htmlFor="video-title" className="text-xs font-semibold text-muted-foreground">
              标题
            </label>
            <Input
              id="video-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
              maxLength={120}
              placeholder="给这段视频起个名字"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">分类</label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="w-full" aria-label="分类">
                <SelectValue placeholder="选择分类" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" className="rounded-full" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            className="rounded-full bg-film px-6 text-primary-foreground hover:bg-film-deep"
            disabled={!canSave}
            onClick={() => void submit()}
          >
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
