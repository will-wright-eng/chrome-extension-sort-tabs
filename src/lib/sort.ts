/**
 * Pure, dependency-free tab-ordering logic — the heart of the extension.
 *
 * Everything here is deterministic and browser-free so it can be unit-tested in
 * isolation (see tests/unit/sort.test.ts). The service worker (background.ts)
 * feeds it `chrome.tabs.Tab` objects, which structurally satisfy `TabLike`.
 */

export type Direction = "asc" | "desc";

/** The subset of `chrome.tabs.Tab` the ordering logic depends on. */
export interface TabLike {
  id?: number;
  index?: number;
  pinned?: boolean;
  url?: string;
  pendingUrl?: string;
  title?: string;
}

/**
 * A tab's position in the ordering.
 * - `bucket: 0` — normal http(s) web tabs.
 * - `bucket: 1` — everything else (chrome://, about:, file://, extensions…),
 *   forced to the end regardless of sort direction (FR-3).
 */
export interface SortKey {
  bucket: 0 | 1;
  key: string;
}

const WEB_SCHEMES = new Set(["http", "https"]);

/**
 * The URL to sort by. Tabs that are still loading may have an empty `url`, in
 * which case Chrome exposes the target in `pendingUrl` (edge case in §2).
 */
export function effectiveUrl(tab: TabLike): string {
  if (tab.url && tab.url.length > 0) return tab.url;
  if (tab.pendingUrl && tab.pendingUrl.length > 0) return tab.pendingUrl;
  return "";
}

/** Extract the leading URI scheme (lower-cased), or "" if there isn't one. */
export function schemeOf(rawUrl: string): string {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(rawUrl);
  return match ? match[1].toLowerCase() : "";
}

/**
 * Compute the sort key for a URL.
 *
 * Web tabs are keyed by their hostname with the labels reversed
 * ("mail.google.com" -> "com.google.mail"), which clusters every `*.google.com`
 * subdomain together and orders by TLD -> domain -> subdomain with no external
 * dependency. Non-web / unparseable URLs go in the trailing bucket, grouped by
 * scheme so all chrome:// tabs (etc.) stay adjacent.
 */
export function sortKey(rawUrl: string): SortKey {
  let parsed: URL | null;
  try {
    parsed = new URL(rawUrl);
  } catch {
    parsed = null;
  }

  if (parsed) {
    const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
    const host = parsed.hostname.toLowerCase();
    if (WEB_SCHEMES.has(scheme) && host.length > 0) {
      // Drop a fully-qualified trailing dot ("google.com." -> "google.com") so
      // it shares a key with its non-dotted sibling and stays adjacent (FR-1).
      const fqdn = host.endsWith(".") ? host.slice(0, -1) : host;
      return { bucket: 0, key: fqdn.split(".").reverse().join(".") };
    }
    return { bucket: 1, key: scheme };
  }

  // Unparseable URL — treat as a non-web tab (FR-3), grouped by any leading scheme.
  return { bucket: 1, key: schemeOf(rawUrl) };
}

interface Decorated<T> {
  tab: T;
  pos: number;
  key: SortKey;
  title: string;
}

function compare<T>(a: Decorated<T>, b: Decorated<T>, dir: 1 | -1): number {
  // Non-web tabs always sink to the end — bucket order ignores direction (FR-4).
  if (a.key.bucket !== b.key.bucket) return a.key.bucket - b.key.bucket;

  // Primary key honours the requested direction.
  if (a.key.key !== b.key.key) return (a.key.key < b.key.key ? -1 : 1) * dir;

  // Tie-breaks are always ascending so the sort stays stable (equal-host tabs
  // keep their original relative order rather than flipping under Z–A).
  if (a.title !== b.title) return a.title < b.title ? -1 : 1;
  return a.pos - b.pos;
}

/**
 * Order tabs so same-domain tabs are adjacent and domains are alphabetical.
 *
 * Pinned tabs are sorted among themselves and always precede unpinned tabs
 * (FR-2) — Chrome requires pinned tabs to occupy the lowest indices. The input
 * order is treated as the "original index" used for stable tie-breaking, so
 * callers should pass tabs already sorted by their current index.
 */
export function orderTabs<T extends TabLike>(
  tabs: readonly T[],
  direction: Direction = "asc",
): T[] {
  const dir: 1 | -1 = direction === "desc" ? -1 : 1;
  const decorate = (tab: T, pos: number): Decorated<T> => ({
    tab,
    pos,
    key: sortKey(effectiveUrl(tab)),
    title: (tab.title ?? "").toLowerCase(),
  });

  const pinned: Decorated<T>[] = [];
  const unpinned: Decorated<T>[] = [];
  tabs.forEach((tab, pos) => (tab.pinned ? pinned : unpinned).push(decorate(tab, pos)));

  const sortGroup = (group: Decorated<T>[]): T[] =>
    group.sort((a, b) => compare(a, b, dir)).map((d) => d.tab);

  return [...sortGroup(pinned), ...sortGroup(unpinned)];
}

/**
 * True when `ordered` already matches `current` (by tab id, falling back to
 * reference identity). Lets callers skip all `chrome.tabs.move` calls for an
 * already-sorted window (FR-8: no unnecessary moves).
 */
export function isAlreadyOrdered<T extends TabLike>(
  current: readonly T[],
  ordered: readonly T[],
): boolean {
  if (current.length !== ordered.length) return false;
  for (let i = 0; i < current.length; i++) {
    const a = current[i];
    const b = ordered[i];
    if (a === b) continue;
    if (a.id !== undefined && b.id !== undefined) {
      if (a.id !== b.id) return false;
    } else if (a !== b) {
      return false;
    }
  }
  return true;
}
