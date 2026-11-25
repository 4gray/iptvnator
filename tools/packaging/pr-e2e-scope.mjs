#!/usr/bin/env node
/**
 * Decides whether a pull request needs E2E tests and whether it requires the
 * full cross-platform Electron matrix (macOS + Windows + Windows hosted-server
 * smoke) or can run Ubuntu Electron + Web Chromium only.
 *
 * Reads the PR merge diff (`HEAD^1..HEAD`, matching GitHub's PR merge checkout)
 * and optional PR labels JSON array from `--labels-file <path>` (or stdin when
 * `--labels-stdin` is passed).
 *
 * Policy:
 * - Docs/plan/agent/website-only PRs skip E2E completely (`run=false`).
 * - Any PR with the `cross-platform-e2e` label or touching Electron main,
 *   SQLite/database, web-backend, native/embedded-mpv, root build/dependency
 *   config, E2E harness/workflow files, or unknown root inputs runs the full
 *   cross-platform matrix (`cross-platform=true`).
 * - Pure renderer/UI/portal/library/Web-E2E PRs run Ubuntu Electron E2E and
 *   sharded Web Chromium E2E (`cross-platform=false`); master pushes always
 *   run the full cross-platform matrix.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const CROSS_PLATFORM_LABEL = 'cross-platform-e2e';

const E2E_IGNORED_PATTERNS = [
    /\.md$/,
    /^(docs|\.plans|\.agents|\.codex|\.claude)\//,
    /^apps\/website\//,
];

const CROSS_PLATFORM_PATTERNS = [
    /[\r\n]/,
    /^apps\/electron-backend\//,
    /^apps\/web-backend\//,
    /^libs\/shared\/database\//,
    /^libs\/ui\/components\/src\/lib\/window-controls\//,
    /^tools\/(embedded-mpv|packaging|testing\/electron)\//,
    /^patches\//,
    /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.nvmrc|nx\.json|tsconfig\.base\.json|electron-builder\.json)$/,
    /^\.github\/workflows\/(e2e-tests\.yaml|ci\.yml)$/,
    /^apps\/electron-backend-e2e\/(playwright\.config\.ts|project\.json|src\/hosted-server\.e2e\.ts|src\/electron-test-fixtures\.ts|src\/performance\/electron-|src\/(window-controls|window-visibility|window-zoom-level|back-gestures|settings)\.e2e\.ts$)/,
];

const PLATFORM_TOKEN_PATTERN =
    /(^|[/._-])(electron|native|embedded-mpv|macos|darwin|win32|windows|traffic-lights|window-controls)([/._-]|$)/i;

const LINUX_ONLY_SAFE_PATTERNS = [
    ...E2E_IGNORED_PATTERNS,
    /^\.changes\//,
    /^\.github\/workflows\/(?!e2e-tests\.yaml$|ci\.yml$)/,
    /^apps\/(web|remote-control-web|tv|tv-setup|tv-e2e|web-e2e|stalker-mock-server|xtream-mock-server)\//,
    /^apps\/electron-backend-e2e\/src\//,
    /^libs\/.*\/src\//,
    /^libs\/.*\/(jest\.config\.[jt]s|tsconfig\.spec\.json)$/,
    /^tools\/(i18n|eslint|nx|performance|release|skills|coverage|typecheck|dependencies)\//,
];

export function isIgnoredForE2E(file) {
    if (/[\r\n]/.test(file)) return false;
    return E2E_IGNORED_PATTERNS.some((pattern) => pattern.test(file));
}

export function needsCrossPlatformE2E(file) {
    if (isIgnoredForE2E(file)) return false;
    if (CROSS_PLATFORM_PATTERNS.some((pattern) => pattern.test(file))) {
        return true;
    }
    const tokenTarget = file.startsWith('apps/electron-backend-e2e/')
        ? file.slice('apps/electron-backend-e2e/'.length)
        : file;
    if (PLATFORM_TOKEN_PATTERN.test(tokenTarget)) {
        return true;
    }
    return !LINUX_ONLY_SAFE_PATTERNS.some((pattern) => pattern.test(file));
}

export function evaluatePrE2EScope({ files, labels = [], diffFailed = false }) {
    if (diffFailed) {
        return {
            run: true,
            crossPlatform: true,
            reason: 'Could not compare the PR merge tree; running full cross-platform E2E.',
        };
    }

    const relevant = files.filter((file) => !isIgnoredForE2E(file));
    if (relevant.length === 0) {
        return {
            run: false,
            crossPlatform: false,
            reason: 'All changed files match E2E path exclusions.',
        };
    }

    if (labels.includes(CROSS_PLATFORM_LABEL)) {
        return {
            run: true,
            crossPlatform: true,
            reason: `Label \`${CROSS_PLATFORM_LABEL}\` present.`,
        };
    }

    const triggers = relevant.filter(needsCrossPlatformE2E);
    if (triggers.length > 0) {
        return {
            run: true,
            crossPlatform: true,
            reason: `Cross-platform inputs changed (${triggers.slice(0, 5).join(', ')}${triggers.length > 5 ? ', ...' : ''}).`,
        };
    }

    return {
        run: true,
        crossPlatform: false,
        reason: `Scoped to Ubuntu Electron + Web Chromium (add label \`${CROSS_PLATFORM_LABEL}\` for macOS/Windows).`,
    };
}

function readLabels(argv) {
    const fileFlagIndex = argv.indexOf('--labels-file');
    if (fileFlagIndex >= 0) {
        const labelsPath = argv[fileFlagIndex + 1];
        if (labelsPath && existsSync(labelsPath)) {
            const parsed = JSON.parse(readFileSync(labelsPath, 'utf8'));
            return Array.isArray(parsed) ? parsed : [];
        }
        return [];
    }
    if (argv.includes('--labels-stdin')) {
        const raw = readFileSync(0, 'utf8').trim();
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }
    return [];
}

function main() {
    const labels = readLabels(process.argv.slice(2));
    let files = [];
    let diffFailed = false;
    try {
        files = execFileSync(
            'git',
            [
                'diff',
                '--name-only',
                '-z',
                '--no-renames',
                '--ignore-submodules=none',
                'HEAD^1',
                'HEAD',
                '--',
            ],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
        )
            .split('\0')
            .filter(Boolean);
    } catch {
        diffFailed = true;
        console.warn(
            '::warning::Could not compare the PR merge tree; running full cross-platform E2E.'
        );
    }

    const result = evaluatePrE2EScope({ files, labels, diffFailed });
    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(
            process.env.GITHUB_OUTPUT,
            `run=${result.run}\ncross-platform=${result.crossPlatform}\n`
        );
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(
            process.env.GITHUB_STEP_SUMMARY,
            `PR E2E: **${result.run ? (result.crossPlatform ? 'cross-platform (Ubuntu + macOS + Windows)' : 'Ubuntu Electron + Web Chromium') : 'skipped'}** — ${result.reason}\n`
        );
    }
    console.log(
        `PR E2E scope: run=${result.run}, cross-platform=${result.crossPlatform} (${result.reason})`
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}
