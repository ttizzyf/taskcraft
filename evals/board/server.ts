import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { loadBoardData } from "./data.ts";

const BOARD_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(BOARD_DIR, "public");

export interface BoardServerOptions {
  port?: number;
  host?: string;
  runDir?: string;
}

export interface BoardServerHandle {
  server: import("node:http").Server;
  port: number;
  host: string;
  url: string;
  close: () => Promise<void>;
}

export async function startBoardServer(
  options: BoardServerOptions = {},
): Promise<BoardServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3100;
  const runDir = options.runDir ?? join(BOARD_DIR, "..", "runs");

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // Only allow GET and HEAD methods
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, {
        "Content-Type": "text/plain; charset=utf-8",
        Allow: "GET, HEAD",
      });
      res.end("Method Not Allowed");
      return;
    }

    const parsedUrl = new URL(req.url ?? "/", `http://${host}:${port}`);
    const rawPath = parsedUrl.pathname;
    const cleanPath = normalize(rawPath);

    // Path traversal check
    if (cleanPath.includes("..")) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }

    // API: load board data
    if (cleanPath === "/api/data") {
      try {
        const data = loadBoardData(runDir);
        const body = JSON.stringify(data);
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "X-Content-Type-Options": "nosniff",
        });
        if (req.method === "HEAD") {
          res.end();
        } else {
          res.end(body);
        }
      } catch (error) {
        res.writeHead(500, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(
          JSON.stringify({
            error:
              error instanceof Error ? error.message : "Internal Server Error",
          }),
        );
      }
      return;
    }

    // Static assets strictly constrained to board files
    let filePath: string | null = null;
    let contentType = "text/plain; charset=utf-8";

    if (cleanPath === "/" || cleanPath === "/index.html") {
      filePath = join(PUBLIC_DIR, "index.html");
      contentType = "text/html; charset=utf-8";
    } else if (cleanPath === "/styles.css") {
      filePath = join(PUBLIC_DIR, "styles.css");
      contentType = "text/css; charset=utf-8";
    } else if (cleanPath === "/app.js" || cleanPath === "/guide.js") {
      filePath = join(PUBLIC_DIR, cleanPath.slice(1));
      contentType = "application/javascript; charset=utf-8";
    }

    if (filePath === null) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }

    try {
      const fileContent = readFileSync(filePath);
      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      });
      if (req.method === "HEAD") {
        res.end();
      } else {
        res.end(fileContent);
      }
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      const actualPort =
        typeof address === "object" && address !== null ? address.port : port;
      const url = `http://${host}:${actualPort}/`;

      resolve({
        server,
        port: actualPort,
        host,
        url,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((err) => {
              if (err) closeReject(err);
              else closeResolve();
            });
          }),
      });
    });
  });
}
