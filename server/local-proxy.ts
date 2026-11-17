// 本地转发中间件：把 /api 与 /storage 转发到本机的 8787 / 9000。
//
// 为什么不用 vite 自带的 server.proxy：
// 它下游用的是 http-proxy，视频播放时浏览器拖进度条、关标签页、手机切后台都会让连接突然中断，
// 这时 socket 抛出的 ECONNRESET 没人接，会把整个 vite 进程带走（服务直接挂掉，手机上就 502/无法访问）。
// 这里自己实现一个流式转发，两端都挂好错误处理：任一端口断掉就干净地销毁，不抛未捕获异常。

import http from "node:http";
import type { Connect, Plugin, ViteDevServer } from "vite";

interface ProxyTarget {
  /** 前端侧路径前缀，例如 /storage */
  readonly prefix: string;
  /** 目标端口，例如 9000 */
  readonly port: number;
  /** 环境变量名，可覆盖端口，例如 OBJECT_STORE_TARGET=http://nas:9000 */
  readonly envKey: string;
  /** 默认目标（含协议），例如 http://127.0.0.1:9000 */
  readonly fallback: string;
  /** 转发时是否去掉前缀（对象存储要去，API 不去） */
  readonly stripPrefix: boolean;
}

function resolveTarget(spec: ProxyTarget): { host: string; port: number } {
  const raw = (process.env[spec.envKey] ?? "").trim() || spec.fallback;
  try {
    const url = new URL(raw.includes("://") ? raw : `http://${raw}`);
    return {
      host: url.hostname || "127.0.0.1",
      port: Number(url.port || spec.port),
    };
  } catch {
    return { host: "127.0.0.1", port: spec.port };
  }
}

function createProxyMiddleware(spec: ProxyTarget): Connect.NextHandleFunction {
  const target = resolveTarget(spec);

  return (req, res, next) => {
    const rawUrl = req.url ?? "/";
    if (!rawUrl.startsWith(spec.prefix)) {
      next();
      return;
    }
    const forwardedPath = spec.stripPrefix
      ? rawUrl.slice(spec.prefix.length) || "/"
      : rawUrl;

    const headers: http.OutgoingHttpHeaders = { ...req.headers, host: `${target.host}:${target.port}` };
    delete headers["connection"];
    delete headers["keep-alive"];
    delete headers["transfer-encoding"];

    const upstream = http.request(
      {
        host: target.host,
        port: target.port,
        method: req.method,
        path: forwardedPath,
        headers,
        agent: false, // 每个请求新建连接，不复用可能已经僵死的 socket
      },
      (upstreamRes) => {
        if (res.writableEnded || res.destroyed) {
          upstreamRes.destroy();
          return;
        }
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.on("error", () => {
          // 读对象/写响应出错：连接已废，安静收尾
          res.destroy();
        });
        res.on("close", () => {
          if (!res.writableEnded) upstreamRes.destroy();
        });
        upstreamRes.pipe(res);
      },
    );

    upstream.on("error", () => {
      // 目标服务没起来或者中途断开：能给响应就给，给不了就销毁（不要抛出）
      if (!res.headersSent && !res.writableEnded) {
        try {
          res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: `本地服务不可用（${target.host}:${target.port}）` }));
        } catch {
          res.destroy();
        }
      } else {
        res.destroy();
      }
    });

    // 客户端（浏览器/手机）中途断开：把上游连接一起掐掉
    req.on("error", () => upstream.destroy());
    res.on("close", () => {
      if (!res.writableEnded) upstream.destroy();
    });

    if (req.method === "GET" || req.method === "HEAD") {
      req.resume();
      upstream.end();
      return;
    }
    req.pipe(upstream);
    req.on("aborted", () => upstream.destroy());
  };
}

/**
 * 挂在 vite dev server 上的本地转发插件。
 * 顺带给 http server 补一个 clientError 兜底，避免畸形/重置的连接把进程带走。
 */
export function localProxyPlugin(targets: ProxyTarget[]): Plugin {
  return {
    name: "local-stream-proxy",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      const httpServer = server.httpServer;
      if (httpServer) {
        httpServer.on("clientError", (err, socket) => {
          if (err?.code === "ECONNRESET" || err?.code === "EPIPE") {
            socket.destroy();
            return;
          }
          try {
            socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
          } catch {
            socket.destroy();
          }
        });
        httpServer.on("connection", (socket) => {
          // 单条连接出错时不要冒泡成未捕获事件
          socket.on("error", () => {
            socket.destroy();
          });
        });
      }

      for (const spec of targets) {
        server.middlewares.use(createProxyMiddleware(spec));
      }
    },
  };
}
