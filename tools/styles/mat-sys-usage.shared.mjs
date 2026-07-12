// Shared scanner for the --mat-sys-* usage guard.
//
// The Angular Material theme in apps/web/src/m3-theme.scss uses the older M3
// API (mat.define-theme + mat.all-component-themes), which emits component
// tokens but NEVER emits `--mat-sys-*` system tokens. Every
// `var(--mat-sys-*)` reference therefore fails at computed-value time and
// silently falls back to inherited/initial values. New styles must use the
// `--app-*` design tokens defined in m3-theme.scss instead.
//
// See docs/architecture/theme-design-tokens.md for the token mapping.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const SCAN_ROOTS = ['apps', 'libs'];
export const SCAN_EXTENSIONS = ['.scss', '.css', '.ts', '.html', '.js'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.nx', 'coverage']);
const USAGE_PATTERN = /var\(--mat-sys-/g;

function collectFiles(dir, results) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) {
                collectFiles(path.join(dir, entry.name), results);
            }
        } else if (SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
            results.push(path.join(dir, entry.name));
        }
    }
    return results;
}

/** Returns a sorted array of { file, count } for files with usages. */
export function scanMatSysUsages(workspaceRoot) {
    return SCAN_ROOTS.flatMap((root) =>
        collectFiles(path.join(workspaceRoot, root), [])
    )
        .map((filePath) => ({
            file: path
                .relative(workspaceRoot, filePath)
                .split(path.sep)
                .join('/'),
            count: (readFileSync(filePath, 'utf8').match(USAGE_PATTERN) || [])
                .length,
        }))
        .filter(({ count }) => count > 0)
        .sort((a, b) => a.file.localeCompare(b.file));
}
