# 咔哒 · 部署与换机手册

> 这份文件是给「换机器 / 重装系统 / 交给 AI 部署」用的。功能说明和每次改动的原因在
> `README-本地运行.md`，这里只讲**怎么从零跑起来**、**数据在哪**、**哪些坑必须提前知道**。
>
> 最后更新：2026-11-17（Ubuntu 22.04 家用台式实测）

---

## 0. 它到底是什么

三个进程、两个目录、无云依赖：

```
pnpm local  →  node server/dev-all.mjs
                 ├── server/object-store.mjs   :9000   本地对象存储（S3 风味，落盘 .data/objects）
                 ├── server/api.mjs             :8787   SQLite + REST（只监听 127.0.0.1，由 vite 代理 /api）
                 └── vite                       :3015   前端（0.0.0.0，手机可访问）
```

- **不需要** Docker、Postgres、MinIO、Supabase、任何账号。
- 数据只有两处：`.data/library.db`（元数据）+ `.data/objects/video-library/`（视频/封面/网页版）。
- **`.data` 整个拷走 = 全部数据搬完**（分类、标签、封面、原片、网页版都在里面）。

---

## 1. 一台全新机器，五步

```bash
# 1) Node ≥ 22.5（api.mjs 用内置 node:sqlite，不需要额外编译 SQLite）
#    实测 v22.23.2 直接 import 可用，无需 --experimental-sqlite
node -v

# 2) ffmpeg：抽封面、测编码、转网页版全靠它。ffprobe 是同一个包，不用单独装
sudo apt-get update && sudo apt-get install -y ffmpeg
ffmpeg -version | head -1                       # 期望 4.4.x 或更高
ffmpeg -encoders 2>/dev/null | grep -q libx264 && echo "libx264 ok"   # 转码必须要，Ubuntu 官方包自带

# 3) pnpm（有 corepack 就更省事）
corepack enable && corepack prepare pnpm@latest --activate

# 4) 代码 + 依赖（不带 .data 时是一个空库）
cd ~/kada && pnpm install

# 5) 起服务
nohup pnpm local > ~/kada-local.log 2>&1 &
```

访问 `http://<本机局域网IP>:3015`。手机连同一个 WiFi 就能用。

> Windows 本机（开发用）：代码和 `node_modules` 直接能跑，`pnpm local` 一样；只是 `ffmpeg.exe` 要自己下好放进 PATH（`winget install Gyan.FFmpeg` 或官网 zip 解压后加环境变量），否则封面/转码全失败。

**只需 3015 对外开放**；8787 和 9000 只在本机内部用（前端经 vite 代理 `/api` 和对象 URL 直连 9000，
所以 9000 也要能被浏览器访问到，见第 5 节）。

---

## 2. 三样东西不在代码里，换机必须自己补

| 依赖 | 为什么需要 | 缺了会怎样 |
| --- | --- | --- |
| **ffmpeg / ffprobe** | 补封面 `scripts/backfill-covers.mjs`、判编码、转网页版 | 转码一律 `failed`；新上传的 HEVC 永远等不到网页版；日志只有 `[transcode] 失败 …` 不带"没装 ffmpeg"字样 |
| **磁盘空间** | 网页版是**新增副本**，原片不删 | 空间满时转码失败、上传失败 |
| **Node ≥ 22.5** | `node:sqlite` | 直接启动报 `Cannot find module 'node:sqlite'` |

CPU 只是「转码时吃满一阵」，不算依赖。

---

## 3. 数据目录与迁移

```
~/kada/.data/
├── library.db                          SQLite：videos / video_categories / tags / video_tags
└── objects/video-library/uploads/
    ├── <hash>-<清洗后的文件名>.mp4      原片（永不覆盖、永不修改）
    ├── <同上>.mp4.cover.jpg              封面
    └── <同上>.mp4.web.mp4                网页版（H.264，浏览器能播的那份）
```

备份（不需要停服务，SQLite 单文件 + 文件级复制就够用；数据量小）：

```bash
tar -czf ~/kada-backup-$(date +%F).tar.gz -C ~/kada .data
```

恢复 / 换机：

```bash
# 新机装好代码和依赖后
tar -xzf kada-backup-2026-11-17.tar.gz -C ~/kada      # 覆盖 .data
nohup pnpm local > ~/kada-local.log 2>&1 &
```

`.data` 里没有用户的绝对路径，换机器拷过去直接能用（对象 key 都是相对的）。
**如果新机换了端口/域名**，前端要改 `VITE_S3_ENDPOINT`（见第 5 节），否则封面和视频地址全错。

---

## 4. 磁盘：这台机器扩过盘，别被 `df` 骗了

2026-11-17 的状态：物理盘 931.5G，但 LVM 一开始只给了 100G，剩下 828G 空着没分配。
一条命令扩满（**只在确认 `/` 在 LVM 上时用**）：

```bash
sudo lvextend -l +100%FREE /dev/ubuntu-vg/ubuntu-lv
sudo resize2fs /dev/ubuntu-vg/ubuntu-lv
df -h /            # 期望 914G 总量
```

换机器时如果 `df` 显示的容量远小于物理盘，先查 `pvs / vgs / lvs`，九成是同样的情况。

---

## 5. 端口与网络（手机访问）

| 端口 | 绑定 | 用途 | 需要对外 |
| --- | --- | --- | --- |
| 3015 | 0.0.0.0 | 网页 | 是 |
| 8787 | 127.0.0.1 | REST / SQLite | 否（vite 代理 `/api` → 8787） |
| 9000 | 0.0.0.0 | 视频/封面文件 | 是（浏览器直接向它取文件，不走前端代理） |

前端地址由 `.env.local` 决定：

```bash
VITE_S3_ENDPOINT=http://<局域网IP>:9000     # 不能写 127.0.0.1，否则手机打开是一堆裂图
VITE_S3_BUCKET=video-library
```

对象 URL 规则：`${VITE_S3_ENDPOINT}/${VITE_S3_BUCKET}/<key>`（`src/lib/storage.ts` 的 `objectUrl`）。
**`/3015/storage/<key>` 是 404，别照那个拼。**

---

## 6. 部署自检（7 条，逐条对输出）

```bash
# 1 三个进程都在
ps -ef | grep -E 'object-store|server/api|vite' | grep -v grep

# 2 API 活着
curl -s http://127.0.0.1:8787/api/health          # {"status":"ok","db":"..."}

# 3 前端能拿到数据（条数应与 .data 里的一致）
curl -s http://127.0.0.1:3015/api/videos | python3 -c 'import json,sys;print(len(json.load(sys.stdin)))'

# 4 ffmpeg 可用（抽一帧出来，能出图就行）
ffmpeg -v error -ss 1.5 -i <任一派> -frames:v 1 -vf scale=320:-2 -f image2 /tmp/t.jpg && ls -l /tmp/t.jpg

# 5 封面有 200（路径必须是 9000 + bucket + key）
curl -sI "http://127.0.0.1:9000/video-library/uploads/<某条>.mp4.cover.jpg" | head -1

# 6 网页版队列干净（None=浏览器能播不用转，ready=已转好，pending/processing=正在跑，failed=要看日志）
curl -s http://127.0.0.1:3015/api/videos | python3 -c 'import json,sys,collections;d=json.load(sys.stdin);print(collections.Counter(str(v.get("proxy_status")) for v in d))'
# 实测输出：Counter({'None': 64, 'ready': 9})

# 7 页面能播（浏览器打开任意 HEVC 那条的详情页，不再是"此浏览器无法在线播放"）
```

---

## 7. 已知坑（都踩过，照这个躲）

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 换了封面，页面还是旧图 | 对象存储发 `Cache-Control: public, max-age=300` | 等 5 分钟，或 Ctrl+F5；核对时给 URL 加 `?v=<时间戳>` |
| HEVC 视频上传后没封面、时长 `--:--` | 封面是**浏览器 canvas** 抽的，浏览器解不了 HEVC | 服务端转码只补「能播」，不补封面；跑 `node scripts/backfill-covers.mjs --apply` |
| 抽出来的封面是纯黑 | 片头淡入/黑场，1.5s 处还没亮 | 多时间点取最亮帧（`fix_dark_covers.py` 的思路） |
| 转码一直 `failed` | 没装 ffmpeg / 空间满 / 源文件丢了 | 看 `~/kada-local.log` 里 `[transcode] 失败 <id>: …` |
| 转码后体积反而变大 | H.264 比 HEVC 低效，CRF 26 仍可能大于低码率原片 | 正常；网页版是「能播副本」，原片是存档。想压小就调 `-crf 28` 或加 `-maxrate 3M -bufsize 6M` |
| 改代码不生效 | `vite.config.ts` 里 `hmr:false` | 手动刷新页面 |
| 新加路由后类型报错 | 路由树由 `@tanstack/router-plugin` 生成 | 先 `pnpm build`，再 `pnpm typecheck` |
| 端口被占，终端刷 `Port 3015 is already in use` | 已有实例在跑 | `dev-all.mjs` 会自己检测并退出；要接管就先停旧实例 |
| 删视频把文件也删了 | `DELETE /api/videos/:id` 会连带删原片和 `.web.mp4` | 这是**现有行为**，误删只能从备份恢复 |
| 远程执行复杂 shell 报 `unexpected EOF` | `$()` + 多层引号 | 本地写好 `.sh` 再 `scp` 上去执行，别嵌套 |

---

## 8. 转码链路（换机后要点一遍的地方）

- 判定：入库时后台 `ffprobe` 读视频轨 `codec_name`；`h264/vp9/av01/theora/mpeg4` → `proxy_status=null`（不动），其它 → 排队。
- 队列串行，一次一个 ffmpeg，避免几路同时吃满 CPU。
- 参数：`libx264 -preset veryfast -crf 26 -pix_fmt yuv420p`、`aac 128k -ac 2`、`+faststart`；
  源高度 > 1080 先 `scale=-2:1080`。
- 产物 `<原文件名>.web.mp4`，**原片一个字节都不动**；已经存在就秒标 `ready`，不重跑。
- 字段：`proxy_path` / `proxy_status`（`NULL / pending / processing / ready / failed`），启动时自动 `ALTER TABLE` 补列。
- 接口：`POST /api/videos/:id/web-version`（单条）、`POST /api/videos/web-version-all`（存量扫描）。

**强制重转某条**（比如调了 CRF 想重新压）：

```bash
# 1) 删掉旧产物
rm ~/kada/.data/objects/video-library/<proxy_path>
# 2) 重新排队（会自动发现文件不存在 → 真转一遍）
curl -s -X POST http://127.0.0.1:3015/api/videos/<id>/web-version
# 3) 看状态
curl -s http://127.0.0.1:3015/api/videos/<id>
```

手工验证单条能不能播（不经过前端，直接用 ffmpeg）：

```bash
ffmpeg -i <源>.mp4 -c:v libx264 -preset veryfast -crf 26 -pix_fmt yuv420p \
  -vf scale=-2:1080 -c:a aac -b:a 128k -ac 2 -movflags +faststart /tmp/out.mp4
```

---

## 9. 开机自启（本机尚未启用，可选）

当前是靠手动 `nohup pnpm local &` 起的，**重启后会停**。要开机自启：

```bash
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/kada.service <<'EOF'
[Unit]
Description=kada local video library
After=network.target

[Service]
WorkingDirectory=%h/kada
Environment=PATH=%h/.local/node22/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/bin/bash -lc 'pnpm local'
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now kada.service
loginctl enable-linger $USER      # 不登录也能起
```

`systemctl --user status kada` 看状态，日志 `journalctl --user -u kada -f`。

---

## 10. 换机速查（一张表）

| 步骤 | 旧机 | 新机 |
| --- | --- | --- |
| 备份 | `tar -czf ~/kada-backup-$(date +%F).tar.gz -C ~/kada .data` | — |
| 环境 | — | Node ≥ 22.5、ffmpeg（带 libx264）、pnpm |
| 代码 | — | `pnpm install` |
| 数据 | — | 解压 `.data` 到项目根 |
| 配置 | 记下 `.env.local` 的 `VITE_S3_ENDPOINT` | 按新机 IP 重写，**不能是 127.0.0.1** |
| 启动 | `pkill -f dev-all` | `nohup pnpm local &` |
| 验证 | — | 第 6 节 7 条自检 |
| 存量补转 | — | `curl -X POST .../api/videos/web-version-all`（新机若 `.data` 里已有 `.web.mp4`，会秒标 ready，不会重跑） |
| 封面缺失 | — | `node scripts/backfill-covers.mjs --apply` |
