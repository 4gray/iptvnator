/**
 * Decides whether a pull request needs the Tier A unit coverage suite.
 *
 * The suite runs every Tier A project and merges one report, so it cannot run
 * a subset (the merged ratchet and Codecov baseline need every project). What
 * it can do is not run at all when a change cannot reach any Tier A test.
 *
 * `nx affected` is not used for this decision: Tier A tests also depend on
 * files no project owns (`jest.preset.js`, `jest.web-esm.workspace.ts`,
 * `tsconfig.base.json`, `tools/testing/`, `patches/`), and a change to an
 * unowned file affects no project, which would skip tests it does break.
 * The rule here is the reverse: skip only when every changed file matches an
 * allowlist of paths no Tier A test reads. Anything unknown runs the suite.
 *
 * Usage:
 *   git diff --name-only <base>...HEAD |
 *       node tools/coverage/unit-coverage-scope.mjs [--base <base>] [--github-output]
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Paths that no Tier A test imports or reads. Tier A specs only read files
 * inside their own project (checked 2026-09-26), so this list is about
 * whole areas, not individual files.
 */
export const SKIPPABLE_PATTERNS = [
    // Documentation, notes, plans and agent guidance.
    /\.md$/,
    /^docs\//,
    /^\.changes\//,
    /^\.plans\//,
    /^\.codex\//,
    /^\.claude\//,
    // Workflows other than this one; ci.yml itself always runs everything.
    /^\.github\/(?!workflows\/ci\.yml$)/,
    // Apps outside Tier A with their own validation.
    /^apps\/website\//,
    /^apps\/web-e2e\//,
    /^apps\/electron-backend-e2e\//,
    /^apps\/xtream-mock-server\//,
    /^apps\/stalker-mock-server\//,
    // Tooling with its own Tier B tests or checks that run in every job.
    /^tools\/(release|packaging|embedded-mpv|skills|performance|i18n|eslint|dependencies|nx)\//,
    // Website tests and the packaged-app smoke launcher; run-web-esm-lib-tests.mjs
    // in the same directory is a Tier A input and stays out of this list.
    /^tools\/testing\/(website-|launch-packaged-electron\.mjs$)/,
    /^LICENSE$/,
];

/**
 * `package.json` feeds Tier A through dependencies, the `@package` version
 * import and Jest/Nx configuration, but not through `scripts`. A change that
 * only edits scripts (the usual case in a tooling PR) cannot reach a test.
 */
export function isScriptsOnlyChange(basePackageJson, headPackageJson) {
    let base;
    let head;
    try {
        base = JSON.parse(basePackageJson);
        head = JSON.parse(headPackageJson);
    } catch {
        return false;
    }
    const withoutScripts = ({ scripts: _scripts, ...rest }) => rest;
    return (
        JSON.stringify(withoutScripts(base)) ===
        JSON.stringify(withoutScripts(head))
    );
}

export function isSkippable(file) {
    return SKIPPABLE_PATTERNS.some((pattern) => pattern.test(file));
}

export function decideUnitCoverageScope(
    files,
    { packageJsonScriptsOnly = false } = {}
) {
    const changed = files.map((file) => file.trim()).filter(Boolean);
    if (changed.length === 0) {
        return {
            run: true,
            reason: 'No changed files were listed; running the suite to be safe.',
            blocking: [],
        };
    }
    const blocking = changed.filter(
        (file) =>
            !isSkippable(file) &&
            !(file === 'package.json' && packageJsonScriptsOnly)
    );
    if (blocking.length > 0) {
        return {
            run: true,
            reason: `${blocking.length} of ${changed.length} changed files can affect Tier A tests.`,
            blocking,
        };
    }
    return {
        run: false,
        reason: `All ${changed.length} changed files are outside Tier A test inputs (docs, notes, other workflows, non-Tier-A apps and tooling).`,
        blocking: [],
    };
}

const isMain =
    process.argv[1] &&
    path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

function gitShow(ref, file) {
    try {
        return execFileSync('git', ['show', `${ref}:${file}`], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
    } catch {
        return null;
    }
}

if (isMain) {
    const argv = process.argv.slice(2);
    const baseIndex = argv.indexOf('--base');
    const base = baseIndex === -1 ? null : argv[baseIndex + 1];
    const files = readFileSync(0, 'utf8').split('\n');
    let packageJsonScriptsOnly = false;
    if (base && files.some((file) => file.trim() === 'package.json')) {
        const basePackageJson = gitShow(base, 'package.json');
        const headPackageJson = readFileSync('package.json', 'utf8');
        packageJsonScriptsOnly =
            basePackageJson !== null &&
            isScriptsOnlyChange(basePackageJson, headPackageJson);
        console.log(
            `package.json changed ${packageJsonScriptsOnly ? 'only in scripts' : 'outside scripts'} relative to ${base}.`
        );
    }
    const decision = decideUnitCoverageScope(files, { packageJsonScriptsOnly });
    console.log(`Tier A unit coverage: ${decision.run ? 'run' : 'skip'}. ${decision.reason}`);
    for (const file of decision.blocking.slice(0, 20)) {
        console.log(`  needs tests: ${file}`);
    }
    if (decision.blocking.length > 20) {
        console.log(`  … and ${decision.blocking.length - 20} more`);
    }
    if (process.argv.includes('--github-output')) {
        const outputFile = process.env.GITHUB_OUTPUT;
        if (!outputFile) {
            console.error('--github-output needs GITHUB_OUTPUT to be set.');
            process.exit(1);
        }
        appendFileSync(outputFile, `run=${decision.run}\n`);
    }
}
