// 全站共享布局（无路径前缀 _layout）：固定顶栏 + 上传弹窗 + Toaster；context 经模块单例下发
import { useState } from "react";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { TopBar } from "@/components/TopBar";
import { UploadDialog } from "@/components/UploadDialog";
import { useVideoLibrary } from "@/hooks/useVideoLibrary";
import { LayoutProvider } from "@/lib/layout-context";

export const Route = createFileRoute("/_layout")({
  component: LayoutComponent,
});

function LayoutComponent() {
  const library = useVideoLibrary();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [search, setSearch] = useState("");

  // 标准 React Context 下发给子页面（useLayoutContext 读取）
  const ctxValue = {
    library,
    search,
    setSearch,
    openUpload: () => setUploadOpen(true),
  };

  return (
    <LayoutProvider value={ctxValue}>
      <div className="min-h-dvh bg-background">
        <TopBar search={search} onSearchChange={setSearch} onUploadClick={() => setUploadOpen(true)} />
        <main className="mx-auto max-w-7xl px-4 pb-16 pt-24 sm:px-6">
          <Outlet />
        </main>

        <UploadDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          categories={library.categories}
          tags={library.tags}
          onEnsureCategory={library.ensureCategory}
          onEnsureTag={library.ensureTag}
          onFinished={library.reload}
        />
        <Toaster position="top-center" richColors closeButton />
      </div>
    </LayoutProvider>
  );
}
