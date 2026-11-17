# 咔哒 · 本地运行说明

这个工程已经**彻底脱离秒悟云（Meoo Cloud / Supabase）**，三块能力全部跑在本机：

| 能力 | 原来 | 现在 |
| --- | --- | --- |
| 元数据（分类 / 视频列表） | Supabase Postgres | 本机 SQLite（`server/api.mjs`，端口 8787） |
| 视频文件 + 封面 | Supabase Storage 公开桶 | 本机 S3 兼容对象存储（`server/object-store.mjs`，端口 9000） |
| 页面里的两张插图 | 秒悟 CDN（带票据链接） | 项目内 `public/hero-banner.png`、`public/empty-state-art.png` |

现在运行时**不需要任何云端账号、密钥或网络**，断网也能跑。

> **换机器、重装系统、交给 AI 部署**：先看同目录的 `DEPLOY.md`（系统依赖 ffmpeg、数据在哪、扩盘、自启、自检清单、已知坑）。这份文件记的是「每次改了什么、为什么」，那份记的是「怎么从零跑起来」。

## 启动

```powershell
cd C:\xxx\work\code\kada
pnpm local      # 同时拉起 对象存储(9000) + 数据 API(8787) + 前端(3015)
```

也可以分开起（三个终端）：

```powershell
pnpm storage    # 对象存储   127.0.0.1:9000
pnpm api        # 数据 API   127.0.0.1:8787
pnpm dev        # 前端       0.0.0.0:3015
```

启动后访问 <http://localhost:3015>，局域网内其它设备访问 `http://<本机IP>:3015`。

> 已经有一个实例在跑时，再执行 `pnpm local` 不会重复启动，只会提示「已经有咔哒的实例在运行」并退出（退出码 0）。
> 想换个终端来管，先按提示停掉旧实例：`foreach ($p in 3015,8787,9000) { Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force } }`

## 稳定性：进程守护与断连兜底

视频播放时浏览器拖进度条、关标签页、手机切后台，都会让 168MB 这种大文件的传输**中途断开**。早期版本这里会崩：

- 现象：整库突然打不开（手机上连接被拒），需要重新 `pnpm local`；
- 原因：断连时 socket 抛 `ECONNRESET`，没人接 → 进程直接退出。vite 自带的 `server.proxy` 就是这种不设防实现。

现在的两层兜底：

| 层 | 做法 |
| --- | --- |
| 转发层 | `/api`、`/storage` 改用自己实现的流式转发（`server/local-proxy.ts`），客户端与上游两端都挂 `error` / `close` 处理，任一端断开就互相销毁，只影响那一条连接 |
| 服务层 | `object-store.mjs` 读流、`api.mjs` 连接层都补了错误处理 + `clientError`；进程级 `uncaughtException` 记日志但不退出 |
| 进程层 | `server/dev-all.mjs` 守护三个子进程：意外退出会在 1–5 秒后自动重启；10 分钟内同一进程崩 8 次才放弃并报错 |

实测：对 `/storage` 做 40 次并发 **RST 硬断** + 25 次正常中断，三个服务全部存活、封面与页面仍 `200`；上传 60MB 中途掐断，临时文件自动清理、无残留；手动 kill 前端进程后 1 秒内自动重启并恢复访问。

## 数据放在哪

```
.data\library.db       SQLite 数据库（分类、视频记录）
.data\objects\<桶>\<对象键>   视频文件与封面，桶名 video-library
```

两个路径都可以用环境变量改掉：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `LIBRARY_API_PORT` | 8787 | 数据 API 端口 |
| `LIBRARY_DB` | `.data\library.db` | SQLite 文件位置 |
| `OBJECT_STORE_PORT` | 9000 | 对象存储端口 |
| `OBJECT_STORE_DATA` | `.data\objects` | 对象文件目录（**视频多的话建议挪到大盘**） |
| `OBJECT_STORE_BUCKETS` | `video-library` | 允许的桶，逗号分隔 |

前端侧的两个配置在 `.env.local`：

```
VITE_S3_ENDPOINT=/storage
VITE_S3_BUCKET=video-library
```

`/storage` 是**相对地址**，由 vite 代理到本机 9000（`vite.config.ts` 里的 `/storage` → `http://127.0.0.1:9000`，转发时去掉前缀）。
这样电脑用 `localhost:3015`、手机用 `192.168.x.x:3015` 都是同一套地址，封面和视频都能正常加载。
如果写成 `http://127.0.0.1:9000`，手机上 `127.0.0.1` 指的是手机自己，封面和播放会全部失效。

## 手机 / 平板访问

1. 手机连**同一个 Wi-Fi**（同一网段）；
2. 手机浏览器打开 `http://<本机局域网IP>:3015`，例如 <http://192.168.5.148:3015>（示例里的 IP 会随网络变，以当前 `ipconfig` 为准）；
3. 本机 IP 可用 `ipconfig` 或 `Get-NetIPAddress -AddressFamily IPv4` 查，换网络（换 Wi-Fi / 热点）后会变，重新查一次即可；
4. 上传、播放、删除在手机上都是同一套接口（都走 3015 这一个端口，`/api` 与 `/storage` 由 vite 代理转发到本机的 8787 与 9000，这两个端口本身只监听 127.0.0.1，不对外暴露）。

注意：电脑上的 `pnpm local` 必须保持运行，手机才有服务可用；电脑睡眠/关机则链接失效。

## 以后换成 NAS 上的真 MinIO

对象存储的 URL 布局是 `/<桶名>/<对象键>`，与 MinIO 完全一致，所以换真 MinIO 只要：

1. 把 `.env.local` 的 `VITE_S3_ENDPOINT` 改成 `http://<NAS地址>:9000`，`VITE_S3_BUCKET` 保持 `video-library`；
2. 在 MinIO 控制台建一个名为 `video-library` 的桶，并允许匿名读写（或在前面加个反代做鉴权）；
3. 不再运行 `pnpm storage`。

代码不用改。

## 目录结构里新增的东西

```
server/
  api.mjs            本地数据服务：SQLite + REST（/api/categories、/api/videos）
  object-store.mjs   本地对象存储：PUT/GET/HEAD/DELETE + CORS + Range
  local-proxy.ts     前端 /api、/storage 的流式转发（自带断连兜底，替代 vite server.proxy）
  dev-all.mjs        一条命令起三个服务，并守护子进程（崩了自动重启）
src/lib/storage.ts                 对象存储适配层（上传/取回/删除/公共 URL）
src/features/file-upload/
  objectStoreUploadService.ts      与模板 FileUploadService 同接口的上传实现
public/
  hero-banner.png, empty-state-art.png   从秒悟 CDN 取下来的原图
_legacy-supabase/                  原 Supabase 相关代码（已移出编译范围，仅作备份）
```

## 数据模型（与原 SQL 一致）

`video_categories`: `id, name(唯一), sort_order, is_default, created_at`
`videos`: `id, title, original_name, category_id(删分类时置空), storage_path, mime_type, size_bytes, duration_seconds, cover_path, folder_hint, created_at`

删分类时会先把该分类下的视频 `category_id` 置空（等价原 `ON DELETE SET NULL`），视频落回「未分类」。

## 播放音量记忆

详情页播放器会记住你调过的音量（存在浏览器 `localStorage`，键名 `pianxia.player.volume`）：

- 第一次进（没存过音量）从 **60%** 开始，不再是满音量炸耳朵；想改这个默认值就改 `src/lib/player-volume.ts` 里的 `DEFAULT_VOLUME`；
- 之后每次拖动音量条都会写回本地，下次打开同一个浏览器保持上次的音量；
- 只记音量、不记静音状态（避免下次进来「没声音」以为是坏了）；
- 记忆是**按设备/浏览器分开**的：电脑上记住的是电脑上这个值，手机上记住的是手机上的，互不影响。

## 已知限制

- 单用户、无登录，接口对局域网内任何设备开放（本机 API 只监听 `127.0.0.1`，对外只有 3015 端口）。要多人用需要自己加鉴权。
- 单文件**不限体积**（只受磁盘剩余空间限制）。上传走浏览器流式发送，不会把整个视频读进内存；需要限流时给 `createObjectStoreUploadService` 传 `maxFileSizeBytes` 即可。
- 数据是「文件 + SQLite」两套，备份时两个都要拷（`.data` 整个目录即可）。
- `_legacy-supabase/` 里的文件不再参与编译，确认不需要了可以直接删。
- 前端 dev server 关了 HMR（`hmr: false`），改完代码要**手动刷新页面**才看得到效果。

## 在 Ubuntu 上跑（家里的台式，2026-11-16 落地）

那台机器的实际情况：`Ubuntu 22.04.5 LTS`、x86_64、7.8 GB 内存、`/` 剩 84 GB、原本**没有任何 Node 环境**。下面这套是实际验证过的步骤，全程不需要 sudo（只有最后的开机自启要）。

**1. 装 Node 22（解压到 `~/.local/node22`，Node 22 才自带 `node:sqlite`）**

```bash
mkdir -p ~/.local && cd ~/.local
curl -fsSL -o node.tar.xz https://npmmirror.com/mirrors/node/v22.23.2/node-v22.23.2-linux-x64.tar.xz
tar -xJf node.tar.xz && mv node-v22.23.2-linux-x64 node22 && rm node.tar.xz
echo 'export PATH=$HOME/.local/node22/bin:$HOME/.local/bin:$PATH' >> ~/.bashrc
```

新开终端（或 `source ~/.bashrc`）后 `node -v` 应是 `v22.23.2`。再装 pnpm：

```bash
npm i -g pnpm --registry=https://registry.npmmirror.com
```

**2. 把项目传过去**（在 Windows 上打包，排除 `node_modules`/`dist`/`_legacy-supabase`，`.data` 要留着）

```powershell
tar -czf "$env:TEMP\kada-deploy.tar.gz" -C C:\xxx\work\code --exclude=kada/node_modules --exclude=kada/dist --exclude=kada/_legacy-supabase kada
scp "$env:TEMP\kada-deploy.tar.gz" xxx@192.168.2.12:/home/xxx/
```

（实测 488 MB 走 WiFi 约 96 秒，5.1 MB/s。解压后 `~/.data` 484 MB。）

**3. 装依赖 + 构建 + 启动**

```bash
cd ~/kada && tar -xzf ~/kada-deploy.tar.gz -C ~ && rm ~/kada-deploy.tar.gz
cd ~/kada
pnpm install --registry=https://registry.npmmirror.com   # 实测 4.4 秒
pnpm build                                              # 实测 3.2 秒
pnpm local
```

访问 <http://192.168.2.12:3015>。

**4. 后台常驻（二选一）**

临时（关终端/退出登录就没了）：

```bash
cd ~/kada && nohup pnpm local > ~/kada-local.log 2>&1 &
```

开机自启（systemd 用户级服务，需要一次 sudo 让服务在你未登录时也能跑）：

```bash
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/kada.service <<'EOF'
[Unit]
Description=kada 私人视频库
After=network.target

[Service]
WorkingDirectory=/home/xxx/kada
Environment=PATH=/home/xxx/.local/node22/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/home/xxx/.local/node22/bin/node server/dev-all.mjs
Restart=always

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now kada
sudo loginctl enable-linger xxx
```

**Ubuntu 上的注意事项**

- 数据在 `/home/xxx/kada/.data`（`library.db` + `objects/`），和 Windows 那份是**各自独立的两套**，两边上传的视频不会同步。
- 端口与 Windows 一致：只对外暴露 3015，`8787` 只听 `127.0.0.1`。
- 手机访问用 `http://192.168.2.12:3015`（这台是**有线/固定 IP**，比笔记本的 WiFi IP 稳定得多，适合当长期服务器）。
- 这台机器 IP 段是 `192.168.2.x`，Windows 那台现在是 `192.168.2.5`。

## 上传文件夹（按钮 与 拖拽）

两条路都支持，实现方式不同：

| 方式 | 走什么 API | 说明 |
|---|---|---|
| 点虚线区中心，或点「上传整个文件夹」按钮 | `<input type="file" webkitdirectory>` | 浏览器给每个文件带 `webkitRelativePath`，子目录里的视频一起进来，并按目录名填「所属文件夹」 |
| 点「选择视频文件」按钮 | `<input type="file" multiple accept="video/*">` | 只挑单个或几个视频文件，不能选目录 |
| 直接把文件夹拖进虚线框 | `dataTransfer.items[i].webkitGetAsEntry()` 递归 | 浏览器对目录**只在 entry 里给**，`dataTransfer.files` 是空的，所以必须递归展开 entry 树 |

拖拽这条路的实现放在 `src/lib/dropped-files.ts`，两个必须注意的点：

1. entry 要在 `drop` 事件的**同步阶段**取出来，事件结束后 `DataTransfer` 就失效；
2. `readEntries` 一次只返回一批（Chrome 每批最多 100 条），必须循环读到空数组为止，否则大目录会漏文件。

递归出来的文件会补一个 `webkitRelativePath`，这样「所属文件夹」提示对拖拽进来的文件也成立。

自检（不需要浏览器，7 条断言覆盖递归、分批、相对路径、空目录）：

```bash
pnpm check:drop
```

行为细节：拖入后虚线框会显示「正在读取文件夹…」；一个视频都没有时会提示跳过数量，空目录/读不到内容时会提示「没读到任何文件」，不再像以前那样静默什么都不做。

已知边界：超大的目录（上千个文件）会因为分批读取慢一些，属浏览器限制，不是本地服务的问题。



## 重复上传会被跳过

同一个文件夹再选一次不会存两份。判定用的是库里每条记录的 `original_name`（原始文件名）+ `size_bytes`：

- 名字和字节数都与库里某条记录一致 → 跳过，提示「N 个文件库里已经有（同名同大小），已跳过」；
- 同一批选择里出现两次同名同大小 → 也只留一个；
- 名字相同但字节数不同 → 视为新文件，正常上传。

三条边界要知道：

1. 查重失败（数据服务连不上）时**不拦**，宁可多传一份，也不把没传过的文件误判成重复；
2. 把库里的视频**删掉之后再传**，会正常入库（查的是当前库）；
3. 极端情况「同名 + 同字节数但内容不同」会被误跳，此时把文件改个名就能传。

0 字节文件在选择阶段就被筛掉（提示「N 个空文件（0 字节）已跳过」），不会进队列、也不会占住进度条。

### 选文件夹时为什么会漏判（已修）

两个确切条件，不是玄学：

1. **名字被入库链路清洗过**。真正写进 `videos.original_name` 的是
   `objectStoreUploadService.upload()` 里的 `sanitizeDownloadName(file.name)`（去首尾空格、控制字符、
   BiDi 控制字符、`\` `/` 转 `_`、截断 255），服务端 `createVideo()` 还会再 `trim()`。
   之前 `handleFiles` 拿的是浏览器原始 `File.name` 做指纹，名字带上述字符或超长时两边永远不相等，
   选同一个文件夹会一遍遍入库。
2. **在途文件不在库里**。上传要先传对象、再在 `associate` 里 `insertVideoRecord()` 才写表。
   大视频传几分钟，期间再选一次文件夹，`fetchVideos()` 查不到刚选的那批，就会再入队一份；
   两次选择挨得太近时同理。

修法：`UploadDialog.tsx` 用与入库一致的清洗函数（并兼容旧记录的原始名 / NFC 变体）生成指纹，
同时把「本次弹窗已选中但还没入库」的指纹用 ref 同步记账，按钮清空/关弹窗时一并清掉。
查不到库时仍按原设计不拦截，只是本弹窗内的去重继续生效。前端 `hmr: false`，改完**手动刷新页面**。

### 清理历史重复（一次性脚本，默认只预演）

库里查重上线前传入的重复，用独立脚本清，不进任何启动流程或定时任务：

```bash
node scripts/find-duplicates.mjs            # dry-run：只打印保留哪条 / 将删哪条，什么都不动
node scripts/find-duplicates.mjs --md5      # dry-run + 下载对象算 md5 做二次确认
node scripts/find-duplicates.mjs --apply    # 真正删除（强制 md5 确认；字节不一致一律不删）
```

- 分组键是 `original_name + size_bytes`，每组按 `created_at` 最早的一条保留，其余为待删；
- `--apply` 调 `DELETE /api/videos/:id` 和 `DELETE /storage/video-library/<key>`（含封面对象），
  不直接读写 `.data/`、不改 server 的 URL 布局；
- 默认只连本机（`KADA_BASE` 默认 `http://127.0.0.1:3015`，可拆成 `KADA_API_BASE` / `KADA_STORAGE_BASE`，
  桶名 `KADA_BUCKET`），指向非本机地址会直接拒绝，除非显式 `KADA_ALLOW_REMOTE=1`；
- md5 读不到或不一致时跳过该条并告警，不会误删；记录删除失败时对象不动；
- 当前 `GET /api/videos` 上限 1000 条，库超过 1000 时脚本会告警（本任务未改 server）。

### 本次改动的验收命令

```bash
pnpm typecheck
pnpm build
pnpm check:drop
```

## 首页只有分类一条 + 「分类与标签」页（2026-11-17）

首页筛选条之前会「挤成两行」：分类胶囊没有 `shrink-0`，分类一多就被压窄、文字换行，看着很乱。现在：

- 分类胶囊条**永远单行**：每个 chip 都 `shrink-0 whitespace-nowrap`，容器 `flex-nowrap + overflow-x-auto`，
  分类再多也只是横向滚动。
- 首页只有这一条筛选线，**没有标签条**（标签不再和分类并排抢位置，见下一节）。
- 独立页面 **`/categories`（分类与标签）**，顶栏入口「分类·标签」（手机上只显示图标）：
  上半「分类」新建 / 重命名（Enter 保存 / Esc 取消）/ 删除（二次确认，视频归入未分类），
  每行显示视频数，内置「未分类」不可删；下半「标签」新建 / 重命名 / 删除，点标签名直接回首页按它筛。
- 手机上编辑 / 删除按钮常显，桌面端 hover 才出现；两块上下单列，不并排挤压。
- **分类条末尾固定一个「+ 分类」按钮**（在滚动区外，不会被横向滚动带走）：点开就是一个就地小面板 —
  顶部输入框新建分类，下面每行是现有分类（视频数 + 垃圾桶），点名字直接按它筛，点垃圾桶删除（二次确认，
  提示视频归入未分类）。下方空间不够时面板自动向上展开。重命名仍去 `/categories`（面板底部有链接）。

改动文件：`src/components/FilterBar.tsx`、`CategoryChipMenu.tsx`（新增）、`TopBar.tsx`、`CategoryManager.tsx`、
`TagManagerPanel.tsx`（新增）、`src/hooks/useVideoLibrary.ts`（`addCategory` / `removeCategory`）、
`src/routes/_layout.categories.tsx`、`src/routes/_layout.index.tsx`、`src/types/index.ts`、`src/routeTree.gen.ts`（自动生成）。

新增路由必须先 build（vite 插件重新生成 `routeTree.gen.ts`）再 typecheck，否则报 `不在 FileRoutesByPath`。

## 分类与标签的分工（2026-11-17）

沿用一个判断：**标签是大范围（动漫 / 电影 / 音乐…），分类是细粒度的归类**。所以两者不是重复的两套体系，而是两个层级：

| | 在哪操作 | 在哪看 |
| --- | --- | --- |
| 分类 | 首页胶囊条只筛选；新建 / 改名 / 删在 `/categories` | 卡片标题下的分类徽章、详情页「分类」块 |
| 标签 | 批量加 / 减：首页多选条、上传弹窗；管理在 `/categories` 下半部 | 详情页「标签」块、上传队列条目；**卡片上不显示** |

- **卡片不显示标签**：之前标题下多一行标签会把卡片容器拉长、整页显得松散，现在卡片回到「封面 + 标题 + 分类/大小/日期」。
- **首页不显示标签条**：想按标签筛，去 `/categories` 点标签名 → 跳 `/?tag=<id>`，首页工具行显示一条
  「标签：#闪闪 ×」提示（`FilterBar` 的 `activeTag`），点 × 或改地址即清掉。搜索框仍然命中标签名。

## 批量设分类（2026-11-17）

分类是单选，所以批量的语义是「整批改成这个分类」：

- 首页点「多选」→ 勾选若干卡片（长按 / 右键也能进多选）→ 底部批量条的「分类：xxx」按钮展开分类胶囊，
  点一个立刻生效（`POST /api/videos/bulk-category`，`{video_ids, category_id}`，`category_id: null` = 未分类）。
- 上传弹窗里勾选队列条目后，用「批量设分类」下拉一次性改这些条目待入库的分类。
- 选中项分类不一致时按钮显示「设为分类」，一致时显示当前分类名。

```js
POST /api/videos/bulk-category
{ "video_ids": ["..."], "category_id": "..." }   // category_id 传 null 即未分类
→ { ok: true, updated: 2 }
```

## 标签外观统一（TagPill，2026-11-17）

标签只在少数几个地方出现，为了不让人以为是几套东西，外观只由 `src/components/TagPill.tsx` 定义：

| 变体 | 用在哪 | 样子 |
| --- | --- | --- |
| `TagPill` | 上传队列条目 | 淡蓝底 + 蓝字 `#名字` |
| `TagPillButton` | 加 / 移除标签弹窗 | 同上；可点，选中后填成实心蓝 |
| `RemovableTagPill` | 详情页标签区 | 同上，右侧带 × 可单独移除 |

三者共用 `tagPillClass()`：`border-film/25 bg-film/10 text-film`，选中态 `border-film bg-film text-primary-foreground`；
尺寸只有 `sm`（11px）和 `md`（12px）两档。

## 标签（批量打标签，2026-11-17）

分类是「一个视频一个分类」，标签是「一个视频多个标签」，两者互不冲突，可以同时存在。

### 数据表

```sql
tags        (id, name, name_key UNIQUE, created_at)
video_tags  (video_id, tag_id, created_at, PK(video_id, tag_id))  -- 两个 FK 都是 ON DELETE CASCADE
```

- `name` 保留你输入的原样；`name_key` 是去重键：`NFKC`（全角→半角）→ 折叠空白 → `trim` → 小写。
  所以「ＶＩＰ」「vip」「 VIP 」进库时都指向同一个标签，只留一条；展示名用第一次创建的那个。
- 标签名最长 30 字，空名直接拒绝。
- 删标签只删 `video_tags` 里的关联行，视频和文件都不动；删视频则连带清掉它的关联行。

### 接口

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/tags` | 全部标签 + `video_count` |
| POST | `/api/tags` | `{name}` 新建；同名（归一化后）直接返回已有那条，不报错 |
| PATCH | `/api/tags/:id` | `{name}` 改名；撞名返回 400 |
| DELETE | `/api/tags/:id` | 删标签（只解绑） |
| PUT | `/api/videos/:id/tags` | `{tag_ids}` 直接设置某视频的标签集合 |
| POST | `/api/tags/bulk` | `{video_ids, tag_ids, mode:"add"\|"remove"}` 批量加/减 |

`GET /api/videos` 每条记录多一个 `tag_ids`（全部关联一次查出，没有 N+1）。

### 界面上的入口

- **上传弹窗**：队列里每条左侧有勾选圈（已入库的不再参与），上方有「全选 / 已选 N / 批量设分类 / 给选中项打标签」。
  标签先存在队列条目的 `MetaData.tagIdsCsv` 里，`associate` 写完记录后紧跟一次 `setVideoTags`，
  所以「上传完才入库」的那条也能带着标签进来。传输中也能勾选和打标签（associate 读的是最新编辑值）。
- **首页多选**：工具行的「多选」开关进入勾选模式；卡片长按（触屏 450ms）或右键也能直接进多选。
  选中后底部出现批量条：设置分类 / 加标签 / 移除标签 / 全选本页 / 取消选择。多选模式下点卡片是勾选，不再跳详情。
- **详情页**：标签区展示全部胶囊，每个带 × 可单独移除，右上「添加标签」打开选择弹窗。
- **按标签筛**：首页没有标签条（见上一节），入口在 `/categories` 下半部点标签名 → `/?tag=<id>`。
- **搜索框**：除了标题，也匹配标签名（`v.title` 或任一 `v.tags.some(t => t.name)` 命中）。
- **管理标签**：`/categories` 下半部「标签」区，可新建 / 改名 / 删除，删除前有二次确认并提示「视频不受影响」。

### 验收命令

```bash
pnpm typecheck
pnpm build
pnpm api   # 另开一个窗口，直接验证接口
curl -s http://127.0.0.1:8787/api/tags
curl -s -X POST http://127.0.0.1:8787/api/tags -H 'Content-Type: application/json' -d '{"name":"翻唱"}'
```

浏览器侧：刷新页面（`hmr` 已关，必须手动刷新）→ 首页多选两条 → 设置分类 / 加标签 →
`/categories` 点标签名回首页能按它过滤 → 搜索框输入标签名能命中 → 详情页可单独增删。

## 没封面 + 播放不了：同一个原因（2026-11-17）

现象：个别卡片是灰底胶片图标、时长 `--:--`；点进详情页播放器全黑，提示「此浏览器无法在线播放该编码格式」。

原因是**视频轨编码**，两件事同源：

1. 封面和时长不是服务端生成的，是上传时**浏览器**做的：`src/lib/site.ts` 的 `probeVideo(file)` 把文件挂到
   `<video>`，`loadeddata` 之后 seek 到约 1.5s，`seeked` 时 `drawImage` 到 canvas 导出 640 宽 JPEG。
   编码解不了 → 触发 `error` → `duration: null, coverBlob: null`，于是既没封面也没时长。
2. Chromium 系（Chrome / Edge）不带 H.265 软解，只有装了系统 HEVC 扩展的机器才可能硬解。
   所以 HEVC(H.265，MP4 box 名 `hvc1` / `hev1`) 的文件，浏览器既抽不了帧也放不了。

判别（不用装任何工具就能看）：

```bash
# 看视频轨的四字符 box 名：avc1=H.264 能播，hvc1/hev1=HEVC 放不了
python3 - <<'EOF'
import sys
for p in sys.argv[1:]:
    with open(p,'rb') as f: head=f.read(3_000_000)
    print(p.split('/')[-1][:40], 'HEVC' if (b'hvc1' in head or b'hev1' in head) else 'H.264' if b'avc1' in head else '?')
EOF
```

本次实测：73 条里 9 条是 `hvc1`，其余是 `avc1`。

### 补封面 / 补时长（一次性脚本，已跑过）

```bash
sudo apt-get install -y ffmpeg          # 服务端第一次需要（本次装的 4.4.2）
node scripts/backfill-covers.mjs         # dry-run：只探测，不写
node scripts/backfill-covers.mjs --apply # 抽帧写 <原文件>.cover.jpg，并写回 duration_seconds / cover_path
```

- 直接打开 `.data/library.db`（`node:sqlite`，带 `busy_timeout`），只改 `cover_path`、`duration_seconds` 两个字段，
  **不动视频文件**，也不改对象存储布局；封面就和原来一样落在 `<storage_path>.cover.jpg`。
- 只处理 `cover_path` 或 `duration_seconds` 为空的记录，跑一次就够，不进启动流程、不做定时任务。

### 还差的一步：在线播放

补封面只让卡片好看，**播放仍然是黑的**，因为浏览器就是解不了 HEVC。要能在网页/手机上直接看，
得把视频轨转成 H.264(AAC)，这也顺带让封面能自动生成：

```bash
ffmpeg -i in.mp4 -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p \
       -c:a aac -b:a 128k -movflags +faststart out.mp4
```

替换对象文件并改 DB 的 `storage_path / size_bytes / mime_type / duration_seconds / cover_path` 属有副作用改动，
未做；要做建议保留原文件，确认能播再删。

## 网页版转码（自动，2026-11-17）

上面那步只补了封面，**播放仍然黑屏**。现在服务端会给浏览器放不了的编码自动转一份 H.264 的「网页版」：

### 判定与队列

- 入库时（`POST /api/videos`）后台 `ffprobe` 读视频轨 `codec_name`，不阻塞创建接口；
- `h264 / vp9 / av01 / theora / mpeg4` → 浏览器能解，**什么都不做**（`proxy_status = null`）；
- 其它（`hevc` 等）→ 排队转码，`proxy_status` 依次 `pending → processing → ready`，失败置 `failed`；
- 队列**串行**跑（同时只一个 ffmpeg），避免几路转码把 CPU 吃满；
- 产物是**新文件** `<storage_path>.web.mp4`（和封面同目录同规则），**原片一个字节都不动**；
- 已经存在 `.web.mp4` 的直接标 `ready`，不重复转。

转码参数：`libx264 -preset veryfast -crf 26 -pix_fmt yuv420p` + `aac 128k` + `+faststart`；
源高度超过 1080 先缩到 1080（4K 源不会原尺寸转，省空间也省 CPU）。

### 数据字段

```sql
videos.proxy_path    -- 网页版对象 key，如 uploads/xxx.mp4.web.mp4；NULL = 没有
videos.proxy_status  -- NULL（不需要） / pending / processing / ready / failed
```

启动时自动补列（`PRAGMA table_info` 判断后 `ALTER TABLE`），老库直接兼容。

### 接口

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/videos`、`/api/videos/:id` | 每条多 `proxy_path` / `proxy_status` |
| POST | `/api/videos/:id/web-version` | 手动把某条排进队列，返回 202 |
| POST | `/api/videos/web-version-all` | 存量扫描：逐条探测，只给放不了的编码排队，返回 202 立即返回 |

### 前端行为（`src/routes/_layout.videos.$id.tsx`）

- 播放器 `src = publicUrl(proxy_path || storage_path)`：有网页版播网页版，没有播原片；
- `proxy_status` 是 `pending/processing` 时，播放器下方显示「正在生成网页版」，并每 5 秒重新拉一次记录（最多 24 次），
  转完自动切换成可播的那份，不用手动刷新；
- 失败时提示改用下载；
- **「下载」按钮永远给原片**（`publicUrl(storage_path)`），画质不受影响。

### 验收

```bash
# 1. 存量补转（会在后台逐条探测，只排 HEVC 那几条）
curl -s -X POST http://127.0.0.1:3015/api/videos/web-version-all

# 2. 看进度（status 数一下就够）
curl -s http://127.0.0.1:3015/api/videos | grep -o '"proxy_status":"[^"]*"' | sort | uniq -c

# 3. 产物与体积
ls -lh ~/kada/.data/objects/video-library/uploads/*.web.mp4
```

实测（i9 机器，软件编码）：一条 192 秒的 1080p HEVC（16MB）转完约 80 秒、产物 26MB；9 条约 10 分钟。
注意 4K HEVC 转 1080p 会久一些，队列是串行的，可以先传着不用等。

体积规律要知道：H.264 比 HEVC 低效，**同一分辨率、同画质下网页版一般比原片大**。本次 9 条原片合计 190MB，
网页版（CRF 24）354MB。所以网页版只是「能在线播」的副本，原片才是存档；数量上去了要留空间，
或者把 `-crf` 调到 28、或在 `-vf` 后面加 `-maxrate 3M -bufsize 6M` 把码率封顶。
