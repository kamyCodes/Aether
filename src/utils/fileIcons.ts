/**
 * File-tree icon resolver built on vscode-icons-js (the mapping library)
 * paired with the vscode-icons SVG asset set (served from /icons/vscode,
 * obtained from the vscode-icons extension — the mapping package does NOT
 * bundle the SVGs itself, they are distributed separately).
 *
 * Pure functions only — no store state. Results are memoized per key because
 * getIconForFile walks several lookup tables on every call; large trees
 * re-render rows often and the name→icon result never changes at runtime.
 *
 * Lazy directory listing: on first fallback, the module fetches the served
 * directory listing (GET /api/icons/list) so SVGs dropped into the icons
 * folder after build time — custom brand icons, pack updates — become
 * resolvable at runtime without a rebuild. See maybeRefreshIconDir().
 */
import {
  getIconForFile,
  getIconForFolder,
  getIconForOpenFolder,
  DEFAULT_FILE,
  DEFAULT_FOLDER,
  DEFAULT_FOLDER_OPENED,
} from 'vscode-icons-js';

/** Base path where the vscode-icons SVG assets are served from. */
const BASE = '/icons/vscode';

/** name → svg filename caches (bounded by the number of distinct names). */
const fileCache = new Map<string, string>();
const folderCache = new Map<string, { closed: string; open: string }>();

// ---------- Lazy directory listing ----------

/** SVG filenames actually present in the served icons directory. */
let availableIcons: Set<string> | null = null;
/** In-flight fetch guard so a burst of fallbacks triggers one listing call. */
let listingPromise: Promise<void> | null = null;
/** Components wanting a re-render once newly-discovered icons land. */
const listeners = new Set<() => void>();

/**
 * Subscribe to directory-listing discoveries. Returns an unsubscribe —
 * intended for React effects (useSyncExternalStore-compatible signature).
 */
export function subscribeToIconDir(cb: () => void): () => void {
  listeners.add(cb);
  void maybeRefreshIconDir();
  return () => listeners.delete(cb);
}

/**
 * Fetch the served icon listing once. Called lazily on the first fallback
 * resolution (or first subscribe), never during module init, so it costs
 * nothing when the icon set already covers every file in the tree.
 */
export function maybeRefreshIconDir(): Promise<void> {
  if (listingPromise) return listingPromise;
  listingPromise = fetch('/api/icons/list')
    .then((r) => (r.ok ? r.json() : { icons: [] }))
    .then((d: { icons: string[] }) => {
      const fresh = new Set<string>(d.icons ?? []);
      const added = availableIcons
        ? [...fresh].filter((n) => !availableIcons!.has(n))
        : [];
      availableIcons = fresh;
      // New SVGs landed (or first load): invalidate fallback entries so they
      // can re-resolve against the now-known set, and notify subscribers.
      if (added.length || !d.icons) {
        for (const [name, svg] of fileCache) if (isFallbackIcon(svg)) fileCache.delete(name);
        for (const [name, svg] of folderCache) if (isFallbackIcon(svg.closed)) folderCache.delete(name);
      }
      for (const cb of listeners) cb();
    })
    .catch(() => {
      // Endpoint unavailable (dev server without backend, etc.) — degrade to
      // the static mapping and don't retry until the next session.
      availableIcons = availableIcons ?? new Set();
    });
  return listingPromise;
}

/** True if the icon resolved to the generic fallback (used by tests/UI hints). */
export function isFallbackIcon(svgName: string): boolean {
  return svgName === DEFAULT_FILE || svgName === DEFAULT_FOLDER || svgName === DEFAULT_FOLDER_OPENED;
}

/**
 * Icon for a file row. Never returns undefined — unmatched names resolve to
 * the generic file icon.
 */
export function getFileIconSvg(fileName: string): string {
  let hit = fileCache.get(fileName);
  if (!hit) {
    hit = getIconForFile(fileName) ?? DEFAULT_FILE;
    fileCache.set(fileName, hit);
  }
  return hit;
}

/**
 * Icons for a folder row (closed + open states). vscode-icons provides
 * distinct SVGs for named folders (e.g. src, docs) in both states; unknown
 * folder names fall back to the generic folder icons.
 */
export function getFolderIconSvg(folderName: string): { closed: string; open: string } {
  let hit = folderCache.get(folderName);
  if (!hit) {
    hit = {
      closed: getIconForFolder(folderName) ?? DEFAULT_FOLDER,
      open: getIconForOpenFolder(folderName) ?? DEFAULT_FOLDER_OPENED,
    };
    folderCache.set(folderName, hit);
  }
  return hit;
}

/**
 * Resolver matching the requested signature. Returns the SVG asset URL for a
 * file or folder row. `isOpen` only affects folders (vscode-icons ships
 * distinct opened-state icons); it is ignored for files.
 *
 * If the static mapping falls back and the served directory contains a
 * plausibly-matching custom SVG (`<stem>.svg` for the exact name, or a
 * `<ext>.svg` for the extension), that runtime-added asset wins over the
 * generic default. First fallback also kicks off the lazy listing fetch.
 */
export function getFileIcon(fileName: string, isFolder: boolean, isOpen?: boolean): string {
  if (isFolder) {
    const { closed, open } = getFolderIconSvg(fileName);
    return `${BASE}/${isOpen ? open : closed}`;
  }
  const svg = getFileIconSvg(fileName);
  if (isFallbackIcon(svg)) {
    void maybeRefreshIconDir();
    const custom = resolveCustomIcon(fileName);
    if (custom) return `${BASE}/${custom}`;
  }
  return `${BASE}/${svg}`;
}

/**
 * Runtime-added icon lookup against the fetched directory listing:
 * exact-name match first (`my-tool.svg` for `my-tool.config`), then
 * extension match (`ts.svg` covers any `.ts` file the static set missed).
 */
function resolveCustomIcon(fileName: string): string | null {
  if (!availableIcons || availableIcons.size === 0) return null;
  const lower = fileName.toLowerCase();
  const stem = lower.replace(/\.[^.]+$/, '');
  if (stem && availableIcons.has(`${stem}.svg`)) return `${stem}.svg`;
  const ext = lower.includes('.') ? lower.split('.').pop()! : '';
  if (ext && availableIcons.has(`${ext}.svg`)) return `${ext}.svg`;
  return null;
}
