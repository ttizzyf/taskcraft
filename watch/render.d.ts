// Type declarations for the browser ES modules under watch/. The server-side
// response types from src/watch/routes.ts are the single source of truth for
// the payload shapes; the browser modules stay plain JS (no build step).
// This file is only read by tsc for the tests; it is never served.

import type {
  WatchBoard,
  WatchDiagnostics,
  WatchRuntime,
} from "../src/watch/routes.js";

export function escapeHtml(value: unknown): string;
export function formatTime(iso: string | null | undefined): string;
export function renderError(status: number, body: unknown): string;
export function renderBoard(data: WatchBoard): string;
export function renderRuntime(data: WatchRuntime): string;
export function renderDiagnostics(data: WatchDiagnostics): string;
