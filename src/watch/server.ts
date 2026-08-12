// Localhost watch server: a read-only JSON API over the projector / query
// model plus static ES-module assets from watch/. Every API request opens a
// short-lived database connection (open + migrate + query + close) so WAL
// checkpoints never sit behind a long-lived reader.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type {
  IncomingMessage,
  Server as HttpServer,
  ServerResponse,
} from "node:http";
import { extname, join, resolve, sep } from "node:path";

import {
  TASKCRAFT_DATABASE_FILE,
  TASKCRAFT_DIRECTORY_NAME,
  migrationsDirectory,
} from "../commands/helpers.js";
import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import type { TaskcraftDatabase } from "../store/database.js";
import { openDatabase } from "../store/database.js";
import { applyMigrations, MigrationError } from "../store/migrations.js";
import {
  buildBoard,
  buildDiagnostics,
  buildRuntime,
  buildTaskDetail,
} from "./routes.js";

export interface WatchServerOptions {
  /** Port to bind; 0 (default) picks a random free port. */
  port?: number;
  /** Bind host; localhost-only by default. */
  host?: string;
  /** Directory that holds .taskcraft/ (used for DB path resolution). */
  projectDir: string;
  /** Directory with the static watch/ frontend assets. */
  staticDir: string;
  /** Open the browser after listening (macOS `open`). */
  openBrowser?: boolean;
  /** Hash-route path to open, e.g. "/#/task/T-1". */
  browserUrl?: string;
}

export interface WatchServer {
  server: HttpServer;
  port: number;
}

export function createWatchServer(
  options: WatchServerOptions,
): Promise<WatchServer> {
  return new Promise((resolveServer, reject) => {
    const server = createServer((request, response) => {
      void handleRequest(request, response, options);
    });

    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;

      if (options.openBrowser === true) {
        openBrowser(port, options.host ?? "127.0.0.1", options.browserUrl);
      }

      resolveServer({ server, port });
    });
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: WatchServerOptions,
): Promise<void> {
  const method = request.method ?? "GET";
  const isHead = method === "HEAD";

  // HEAD is read-only and served like GET but without a body; every other
  // method (POST/PUT/DELETE/...) is rejected.
  if (method !== "GET" && !isHead) {
    response.setHeader("Allow", "GET");
    sendJson(
      response,
      405,
      {
        error: {
          code: "TC_WATCH_METHOD_NOT_ALLOWED",
          problem: `method ${method} is not allowed`,
        },
      },
      isHead,
    );
    return;
  }

  const pathname = parsePathname(request.url);

  if (pathname === null) {
    sendJson(
      response,
      404,
      apiError("TC_WATCH_BAD_PATH", "invalid request path"),
      isHead,
    );
    return;
  }

  try {
    if (pathname === "/api/board") {
      sendJson(
        response,
        200,
        withDatabase(options.projectDir, (database) => buildBoard(database)),
        isHead,
      );
      return;
    }

    if (pathname === "/api/runtime") {
      sendJson(
        response,
        200,
        withDatabase(options.projectDir, (database) => buildRuntime(database)),
        isHead,
      );
      return;
    }

    if (pathname === "/api/diagnostics") {
      sendJson(response, 200, buildDiagnostics(options.projectDir), isHead);
      return;
    }

    const taskMatch = /^\/api\/task\/([^/]+)$/.exec(pathname);

    if (taskMatch !== null) {
      const taskId = taskMatch[1] ?? "";
      const detail = withDatabase(options.projectDir, (database) =>
        buildTaskDetail(database, taskId),
      );

      if (detail === null) {
        sendJson(
          response,
          404,
          {
            error: {
              code: ERROR_CODES.TC_TASK_NOT_FOUND,
              problem: `Task ${taskId} does not exist`,
              impact:
                "The requested task cannot be shown because it is unknown",
              remediation: "List known tasks with: tc task list",
            },
          },
          isHead,
        );
        return;
      }

      sendJson(response, 200, detail, isHead);
      return;
    }

    if (pathname.startsWith("/api/")) {
      sendJson(
        response,
        404,
        apiError("TC_WATCH_API_NOT_FOUND", `unknown api path: ${pathname}`),
        isHead,
      );
      return;
    }

    serveStatic(response, options.staticDir, pathname, isHead);
  } catch (error) {
    if (error instanceof MigrationError) {
      sendJson(response, 500, apiError(error.code, error.message), isHead);
      return;
    }

    if (error instanceof TaskcraftError) {
      sendJson(
        response,
        404,
        {
          error: {
            code: error.code,
            problem: error.problem,
            impact: error.impact,
            remediation: error.remediation,
          },
        },
        isHead,
      );
      return;
    }

    sendJson(
      response,
      500,
      apiError("TC_WATCH_INTERNAL", "internal server error"),
      isHead,
    );
  }
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveStatic(
  response: ServerResponse,
  staticDir: string,
  pathname: string,
  isHead: boolean,
): void {
  const relative = pathname.replace(/^\/+/, "");
  const filePath =
    relative === ""
      ? join(staticDir, "index.html")
      : resolve(staticDir, relative);

  // Resolved paths that escape the static directory are rejected (traversal).
  if (!isInside(staticDir, filePath)) {
    sendJson(
      response,
      404,
      apiError("TC_WATCH_STATIC_NOT_FOUND", "not found"),
      isHead,
    );
    return;
  }

  try {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      sendJson(
        response,
        404,
        apiError("TC_WATCH_STATIC_NOT_FOUND", "not found"),
        isHead,
      );
      return;
    }

    const body = readFileSync(filePath);
    response.writeHead(200, {
      "Content-Type":
        MIME_TYPES[extname(filePath)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
      "Content-Length": body.length,
    });
    response.end(isHead ? undefined : body);
  } catch {
    sendJson(
      response,
      500,
      apiError("TC_WATCH_INTERNAL", "internal server error"),
      isHead,
    );
  }
}

function isInside(staticDir: string, filePath: string): boolean {
  return filePath === staticDir || filePath.startsWith(`${staticDir}${sep}`);
}

function parsePathname(rawUrl: string | undefined): string | null {
  let url: URL;

  try {
    url = new URL(rawUrl ?? "/", "http://localhost");
  } catch {
    return null;
  }

  try {
    return decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
}

/** Opens the store next to .taskcraft/; null when the store was never
 * initialized (an uninstrumented project serves empty groups). */
function openWatchDatabase(projectDir: string): TaskcraftDatabase | null {
  const databaseFile = join(
    projectDir,
    TASKCRAFT_DIRECTORY_NAME,
    TASKCRAFT_DATABASE_FILE,
  );

  if (!existsSync(databaseFile)) {
    return null;
  }

  const database = openDatabase(databaseFile);

  try {
    applyMigrations(database, migrationsDirectory());
    return database;
  } catch (cause) {
    database.close();
    throw cause;
  }
}

function withDatabase<T>(
  projectDir: string,
  callback: (database: TaskcraftDatabase | null) => T,
): T {
  const database = openWatchDatabase(projectDir);

  if (database === null) {
    return callback(null);
  }

  try {
    return callback(database);
  } finally {
    database.close();
  }
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  data: unknown,
  isHead: boolean,
): void {
  const body = JSON.stringify(data);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(isHead ? undefined : body);
}

function apiError(
  code: string,
  problem: string,
): { error: { code: string; problem: string } } {
  return { error: { code, problem } };
}

function openBrowser(
  port: number,
  host: string,
  browserUrl: string | undefined,
): void {
  if (process.platform !== "darwin") {
    return;
  }

  const child = spawn(
    "open",
    [`http://${host}:${port}${browserUrl ?? "/#/board"}`],
    { stdio: "ignore" },
  );
  child.on("error", () => {});
  child.unref();
}
