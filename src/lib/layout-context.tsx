// 布局 -> 子页面共享 context：标准 React Context 方案
// 布局用 LayoutProvider 包住 Outlet；子页面 useLayoutContext 读取。
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { VideoLibrary } from "@/hooks/useVideoLibrary";

export interface LayoutContextValue {
  library: VideoLibrary;
  search: string;
  setSearch: (v: string) => void;
  openUpload: () => void;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

export function LayoutProvider({
  value,
  children,
}: {
  value: LayoutContextValue;
  children: ReactNode;
}) {
  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

/** 子页面读取布局 context */
export function useLayoutContext(): LayoutContextValue {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error("布局尚未初始化");
  return ctx;
}
