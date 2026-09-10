import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startBoardServer } from "../server.ts";
import type { BoardServerHandle } from "../server.ts";

describe("evals board server HTTP integration", () => {
  let serverHandle: BoardServerHandle;

  beforeAll(async () => {
    // Port 0 picks a free available port
    serverHandle = await startBoardServer({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await serverHandle.close();
  });

  it("serves the HTML board at / and /index.html", async () => {
    const resRoot = await fetch(serverHandle.url);
    expect(resRoot.status).toBe(200);
    expect(resRoot.headers.get("content-type")).toContain("text/html");
    const htmlRoot = await resRoot.text();
    expect(htmlRoot).toContain("Taskcraft Evals");

    const resIndex = await fetch(`${serverHandle.url}index.html`);
    expect(resIndex.status).toBe(200);
    const htmlIndex = await resIndex.text();
    expect(htmlIndex).toBe(htmlRoot);
  });

  it("serves CSS and JS static assets", async () => {
    const resCss = await fetch(`${serverHandle.url}styles.css`);
    expect(resCss.status).toBe(200);
    expect(resCss.headers.get("content-type")).toContain("text/css");

    const resJs = await fetch(`${serverHandle.url}app.js`);
    expect(resJs.status).toBe(200);
    expect(resJs.headers.get("content-type")).toContain(
      "application/javascript",
    );

    const resBatchesJs = await fetch(`${serverHandle.url}batches.js`);
    expect(resBatchesJs.status).toBe(200);
    expect(resBatchesJs.headers.get("content-type")).toContain(
      "application/javascript",
    );
  });

  it("serves JSON data at /api/data", async () => {
    const res = await fetch(`${serverHandle.url}api/data`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const data = await res.json();
    expect(data).toHaveProperty("overview");
    expect(data).toHaveProperty("scenarios");
    expect(data).toHaveProperty("reports");
    expect(data.overview.totalScenarios).toBe(5);
  });

  it("strictly rejects non-GET/HEAD methods with 405 Method Not Allowed", async () => {
    const resPost = await fetch(`${serverHandle.url}api/data`, {
      method: "POST",
      body: JSON.stringify({ test: 123 }),
    });
    expect(resPost.status).toBe(405);
    expect(resPost.headers.get("allow")).toContain("GET");

    const resDelete = await fetch(`${serverHandle.url}`, { method: "DELETE" });
    expect(resDelete.status).toBe(405);
  });

  it("rejects path traversal or unknown endpoints with 403 or 404", async () => {
    const resUnknown = await fetch(`${serverHandle.url}unknown-endpoint`);
    expect(resUnknown.status).toBe(404);

    const resTraversal = await fetch(`${serverHandle.url}../package.json`);
    expect([403, 404]).toContain(resTraversal.status);
  });
});
