# AGENTS.md

## Dependencies
- `@tanstack/react-query`：视频库列表/分类数据加载暂未接入（当前用自管理 useState + site.ts 直查 supabase），如后续引入缓存层可复用。
- `sonner`：全局 toast（Toaster 挂在 `_layout.tsx`）。
- `lucide-react`：图标（平台默认已含，此处仅说明全站统一用它，无第二套图标库）。

## Architecture
- 后端是**本地自托管，无云依赖**（原来的 Meoo Cloud / Supabase 已下线）：`server/api.mjs` 用内置 `node:sqlite` 提供 REST（:8787，只监听 127.0.0.1，由 vite 代理 `/api`）；`server/object-store.mjs` 是 S3 风味的本地对象存储（:9000，落盘 `.data/objects`）；`node server/dev-all.mjs`（`pnpm local`）同时拉起三者并守护重启。
- 数据：`.data/library.db`（`videos` / `video_categories` / `tags` / `video_tags`，`videos` 另有 `proxy_path` / `proxy_status` 两个网页版字段，启动时自动 `ALTER TABLE` 补列）；对象 `uploads/<hash>-<清洗后文件名>.mp4`，封面同 key + `.cover.jpg`，网页版同 key + `.web.mp4`。
- **部署 / 换机 / 系统依赖（ffmpeg 必需）见 `DEPLOY.md`**，改环境之前先读它。
- 数据访问集中在 `src/lib/site.ts`（CRUD、公开 URL、时长探测 + canvas 截帧生成封面、文件夹分类推断）；业务 hook 在 `src/hooks/useVideoLibrary.ts`（列表加载/筛选排序防抖/下载/删除）。
- 上传走 `src/features/file-upload` 工程模板：`createSupabaseUploadService` + `useUploadQueue<MetaData>`；MetaData 必须平面（Record<string, string|number|boolean|null>），逐文件 `enqueue([file], meta)` 保证每文件独立快照，associate 阶段完成封面生成→自动建类→写 videos 记录。
- 路由：带路径布局 `_layout.tsx`（URL 前缀共享壳）+ `_layout.index.tsx`（`/`）+ `_layout.videos.$id.tsx`（`/videos/$id`）。布局向子页面下发 library/search/openUpload 通过 `src/lib/layout-context.tsx` 的标准 React Context（LayoutProvider 包住 Outlet）。
- 设计系统：`src/styles.css` 单套浅色 oklch token（胶片蓝 --film/--film-deep/--film-sky + amber-reel）+ @theme inline 映射 + 组件类（.chip/.clip-card/.duration-badge/.play-float/.progress-bar/.hero-base/.app-header/.float-bob）。滚动渐入用模板 reveal-engine（class="reveal" + data-reveal-delay）。

## What Didn't Work
- ❌ 用前端 `<video>` + canvas 抽封面/时长来判断编码 → HEVC 在 Chromium/Edge 里解不了，既抽不出封面也没有时长，卡片只能显示胶片图标 + `--:--`；正确做法是服务端 `ffprobe` 判 `codec_name`、`ffmpeg` 抽帧（`scripts/backfill-covers.mjs`）。
- ❌ Radix `Popover` 在本环境（截图/自动化验收）点开即关闭、截图里也不可见 → 改为自绘面板（`CategoryChipMenu.tsx`）。
- ❌ 服务端转码时直接替换 `storage_path` → 原片会被改坏且不可逆；只新增 `<file>.web.mp4` 副本，播放优先副本、下载永远原片。
- ❌ TanStack Router `<Outlet context={...}>` / `useOutletContext` → 本版本 v1.170.46 运行时 ESM 不导出 useOutletContext、Outlet 不接受 context prop → 改为标准 React Context（LayoutProvider）。
- ❌ 模块级单例 + useSyncExternalStore 在渲染期 setLayoutContext → StrictMode 双调用触发 "Cannot update a component while rendering" 告警；改到 effect 登记又导致子页面首帧读到 null 抛错白屏 → 最终用 React Context 彻底解决。
- ❌ `__layout.tsx`（无前缀布局声明 path "/"）与 `_layout.index.tsx` 冲突 "Conflicting configuration paths for '/'" → 删除前者，统一用带路径布局 `_layout.tsx`。
- ❌ UploadDialog 初版把 File 塞 WeakMap + `context.file`（队列合同无此字段）、整批共用 metas[0] 导致多文件编辑态错位 → 重写为 Map<string,EditState> + 逐文件 enqueue。

## Lessons
- file-upload 模板的 `enqueue(files, data)` 中 data 是**整批一份快照**；需要每文件独立元信息时必须逐文件入队。
- DropdownMenuItem 本 shadcn 版本不支持 `variant="destructive"`，用 className text-destructive 代替。
- html2canvas 预览截图对 mix-blend-screen 等合成模式会失真（横幅看似空白），真实渲染以 `--source browser` 截图为准。
