#!/bin/bash
# 把手动跑的 pnpm local 换成 systemd 用户级服务
export XDG_RUNTIME_DIR=/run/user/$(id -u)
mkdir -p ~/.config/systemd/user
cp /tmp/kada.service ~/.config/systemd/user/kada.service
sed -i 's/\r$//' ~/.config/systemd/user/kada.service

echo "=== unit 文件"
cat ~/.config/systemd/user/kada.service

echo "=== 停掉手动进程"
pkill -f 'server/dev-all.mjs' || true
pkill -f 'server/api.mjs' || true
pkill -f 'server/object-store.mjs' || true
for i in 1 2 3 4 5 6; do
  if ss -ltn 2>/dev/null | grep -qE ':(3015|8787|9000) '; then sleep 1; else break; fi
done
echo "剩余监听："
ss -ltn 2>/dev/null | grep -E ':(3015|8787|9000) ' || echo "（端口已释放）"

echo "=== 启用服务"
systemctl --user daemon-reload
systemctl --user enable --now kada.service
sleep 4

echo "=== 状态"
systemctl --user is-enabled kada.service
systemctl --user is-active kada.service
systemctl --user status kada.service --no-pager 2>&1 | head -14

echo "=== 进程树"
ps -eo pid,ppid,etime,cmd | grep -E "dev-all|api.mjs|object-store|vite" | grep -v grep

echo "=== 端口"
ss -ltnp 2>/dev/null | grep -E ':(3015|8787|9000) '

echo "=== 健康检查"
curl -s -m 5 http://127.0.0.1:8787/api/health; echo
curl -s -o /dev/null -w "front 3015 -> %{http_code}\n" -m 5 http://127.0.0.1:3015/
curl -s -o /dev/null -w "store 9000 -> %{http_code}\n" -m 5 http://127.0.0.1:9000/video-library/
