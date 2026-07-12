#!/usr/bin/env node

/**
 * Fails when new `var(--mat-sys-*)` references are added anywhere in
 * apps/ or libs/. The current Material theme (m3-theme.scss, older M3 API)
 * never emits `--mat-sys-*` system tokens, so such references are silent
 * no-ops: the declaration is invalid at computed-value time and falls back
 * to inherited/initial values. Use the `--app-*` design tokens from
 * apps/web/src/m3-theme.scss instead.
 *
 * Pre-existing usages are grandfathered in tools/styles/mat-sys-baseline.mjs
 * (regenerate with `node tools/styles/generate-mat-sys-baseline.mjs` after
 * migrating a file — the baseline should only shrink).
 *
 * Usage: node tools/styles/check-mat-sys-usage.mjs
 */

import process from 'node:process';

import { matSysBaseline } from './mat-sys-baseline.mjs';
import { scanMatSysUsages } from './mat-sys-usage.shared.mjs';

const usages = scanMatSysUsages(process.cwd());

const violations = usages.filter(
    ({ file, count }) => count > (matSysBaseline.get(file) ?? 0)
);

if (violations.length > 0) {
    console.error(
        'New var(--mat-sys-*) references detected. These tokens are never\n' +
            'emitted by the current Material theme setup and resolve to\n' +
            'nothing — use the --app-* design tokens from\n' +
            'apps/web/src/m3-theme.scss instead\n' +
            '(see docs/architecture/theme-design-tokens.md).\n'
    );
    for (const { file, count } of violations) {
        const baselined = matSysBaseline.get(file) ?? 0;
        console.error(`  ${file}: ${count} usages (baseline: ${baselined})`);
    }
    process.exit(1);
}

const stale = [...matSysBaseline.keys()].filter(
    (file) => !usages.some((usage) => usage.file === file)
);
const shrunk = usages.filter(
    ({ file, count }) => count < (matSysBaseline.get(file) ?? 0)
);
if (stale.length > 0 || shrunk.length > 0) {
    console.log(
        'Baseline is stale (files were migrated). Consider running\n' +
            '`node tools/styles/generate-mat-sys-baseline.mjs` to shrink it.'
    );
}

console.log('No new var(--mat-sys-*) references. OK.');
