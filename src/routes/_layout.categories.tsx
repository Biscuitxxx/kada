// 分类与标签页（/categories）：分类在上（细粒度归类）、标签在下（大范围）
// 两块都在同一页，手机上单列往下排；点标签名直接回首页按它筛选
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, FolderTree, Tag as TagIcon } from "lucide-react";
import { CategoryManager } from "@/components/CategoryManager";
import { TagManagerPanel } from "@/components/TagManagerPanel";
import { useLayoutContext } from "@/lib/layout-context";

export const Route = createFileRoute("/_layout/categories")({
  component: TaxonomyPage,
});

function TaxonomyPage() {
  const { library } = useLayoutContext();

  const videoCounts = new Map<string, number>();
  for (const v of library.videos) {
    const key = v.category_id ?? "__none__";
    videoCounts.set(key, (videoCounts.get(key) ?? 0) + 1);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Link
          to="/"
          aria-label="返回首页"
          className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:border-film/40 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <FolderTree className="h-5 w-5 text-film" />
            分类与标签
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            分类是细粒度的归类（一个视频一个分类），标签是大范围（一个视频可以有多个）。首页只显示分类，按标签筛就在下面点一下标签名。
          </p>
        </div>
      </div>

      {library.error && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          数据加载失败：{library.error}
        </p>
      )}

      <section className="space-y-3" aria-label="分类">
        <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight">
          <FolderTree className="h-4 w-4 text-film" />
          分类
          <span className="text-xs font-normal tabular-nums text-muted-foreground">
            {library.categories.length} 个
          </span>
        </h2>
        <CategoryManager
          categories={library.categories}
          videoCounts={videoCounts}
          onChanged={() => {
            void library.refreshCategories();
            library.reload();
          }}
        />
      </section>

      <section className="space-y-3 border-t border-border/60 pt-5" aria-label="标签">
        <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight">
          <TagIcon className="h-4 w-4 text-film" />
          标签
          <span className="text-xs font-normal tabular-nums text-muted-foreground">
            {library.tags.length} 个
          </span>
        </h2>
        <TagManagerPanel tags={library.tags} onChanged={() => library.reload()} />
      </section>
    </div>
  );
}
