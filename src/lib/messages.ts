/**
 * Shared message + preference contracts used by both the popup and the
 * background service worker. Kept tiny and browser-free so both sides agree on
 * the exact shapes crossing the `chrome.runtime` message boundary.
 */

import type { Direction } from "./sort";

export type { Direction };

/** Which windows a sort applies to (FR-5). */
export type Scope = "current" | "all";

export interface Prefs {
  direction: Direction;
  scope: Scope;
}

export const DEFAULT_PREFS: Prefs = { direction: "asc", scope: "current" };

/** Storage key under `chrome.storage.sync` (FR-6). */
export const PREFS_KEY = "prefs";

/** Popup -> background: perform a sort. */
export interface SortRequest {
  type: "SORT";
  direction: Direction;
  scope: Scope;
}

/** Background -> popup: outcome of a sort. */
export interface SortResponse {
  ok: boolean;
  /** Number of tabs whose position changed. */
  moved?: number;
  /** Number of windows sorted. */
  windows?: number;
  error?: string;
}
