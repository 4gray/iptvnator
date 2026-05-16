import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND_SOURCE_DIRS = ['apps/web/src', 'libs'];
const BACKEND_MAIN_SOURCE_DIRS = ['apps/electron-backend/src', 'libs/shared'];
const BACKEND_PRELOAD_SOURCE_DIRS = [
    'apps/electron-backend/src/app/api',
    'apps/electron-backend/src/app/services/debug-trace.ts',
    'libs/shared/interfaces/src',
];
const FRONTEND_OUTPUTS = ['dist/apps/web/index.html'];
const BACKEND_MAIN_OUTPUTS = ['dist/apps/electron-backend/main.js'];
const BACKEND_PRELOAD_OUTPUTS = ['dist/apps/electron-backend/main.preload.js'];
const SOURCE_EXTENSIONS = new Set([
    '.css',
    '.html',
    '.json',
    '.scss',
    '.ts',
    '.tsx',
]);

function parseArgs(argv) {
    return {
        checkOnly: argv.includes('--check'),
        dryRun: argv.includes('--dry-run'),
        json: argv.includes('--json'),
        workspaceRoot: resolve(
            argv
                .find((arg) => arg.startsWith('--workspace-root='))
                ?.slice('--workspace-root='.length) ?? process.cwd()
        ),
    };
}

function getMtimeMs(path) {
    try {
        return statSync(path).mtimeMs;
    } catch {
        return 0;
    }
}

function isSourceFile(path) {
    const dotIndex = path.lastIndexOf('.');
    return dotIndex >= 0 && SOURCE_EXTENSIONS.has(path.slice(dotIndex));
}

function newestSourceMtime(root, relativeDirs) {
    let newest = 0;
    const stack = [];

    for (const relativePath of relativeDirs) {
        const path = join(root, relativePath);
        if (!existsSync(path)) {
            continue;
        }

        const stat = statSync(path);
        if (stat.isFile()) {
            if (isSourceFile(path)) {
                newest = Math.max(newest, stat.mtimeMs);
            }
            continue;
        }

        if (stat.isDirectory()) {
            stack.push(path);
        }
    }

    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
            continue;
        }

        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const path = join(current, entry.name);
            if (entry.isDirectory()) {
                if (
                    entry.name === 'node_modules' ||
                    entry.name === 'dist' ||
                    entry.name === 'coverage'
                ) {
                    continue;
                }
                stack.push(path);
                continue;
            }

            if (entry.isFile() && isSourceFile(path)) {
                newest = Math.max(newest, getMtimeMs(path));
            }
        }
    }

    return newest;
}

function oldestOutputMtime(root, outputs) {
    let oldest = Number.POSITIVE_INFINITY;

    for (const output of outputs) {
        const outputPath = join(root, output);
        const mtime = Math.max(
            getMtimeMs(outputPath),
            getMtimeMs(`${outputPath}.map`)
        );
        if (!mtime) {
            return 0;
        }
        oldest = Math.min(oldest, mtime);
    }

    return Number.isFinite(oldest) ? oldest : 0;
}

export function getDistFreshness(root) {
    const frontendNewestSource = newestSourceMtime(root, FRONTEND_SOURCE_DIRS);
    const backendMainNewestSource = newestSourceMtime(
        root,
        BACKEND_MAIN_SOURCE_DIRS
    );
    const backendPreloadNewestSource = newestSourceMtime(
        root,
        BACKEND_PRELOAD_SOURCE_DIRS
    );
    const newestSource = Math.max(
        frontendNewestSource,
        backendMainNewestSource,
        backendPreloadNewestSource
    );
    const frontendOldestOutput = oldestOutputMtime(root, FRONTEND_OUTPUTS);
    const backendMainOutput = oldestOutputMtime(root, BACKEND_MAIN_OUTPUTS);
    const backendPreloadOutput = oldestOutputMtime(
        root,
        BACKEND_PRELOAD_OUTPUTS
    );
    const backendOldestOutput = Math.min(
        backendMainOutput || 0,
        backendPreloadOutput || 0
    );

    return {
        backendStale:
            !backendMainOutput ||
            backendMainOutput < backendMainNewestSource ||
            !backendPreloadOutput ||
            backendPreloadOutput < backendPreloadNewestSource,
        frontendStale:
            !frontendOldestOutput ||
            frontendOldestOutput < frontendNewestSource,
        newestSource,
        backendMainNewestSource,
        backendMainOutput,
        backendOldestOutput,
        backendPreloadNewestSource,
        backendPreloadOutput,
        frontendNewestSource,
        frontendOldestOutput,
    };
}

function runCommand(root, command) {
    const result = spawnSync(command[0], command.slice(1), {
        cwd: root,
        env: {
            ...process.env,
            COREPACK_INTEGRITY_KEYS: '0',
        },
        shell: process.platform === 'win32',
        stdio: 'inherit',
        windowsHide: true,
    });

    return result.status ?? 1;
}

export function ensureLocalDistFresh(options) {
    const freshness = getDistFreshness(options.workspaceRoot);
    const needsBuild = freshness.frontendStale || freshness.backendStale;

    if (!needsBuild || options.checkOnly || options.dryRun) {
        return {
            ...freshness,
            built: false,
            needsBuild,
            status: needsBuild ? 'stale' : 'fresh',
        };
    }

    const status = runCommand(options.workspaceRoot, [
        'pnpm',
        'nx',
        'run',
        'electron-backend:build',
        '--configuration=production',
    ]);
    if (status !== 0) {
        return {
            ...freshness,
            built: false,
            needsBuild,
            status: 'build-failed',
            exitCode: status,
        };
    }

    const nextFreshness = getDistFreshness(options.workspaceRoot);
    const stillStale =
        nextFreshness.frontendStale || nextFreshness.backendStale;

    return {
        ...nextFreshness,
        built: true,
        needsBuild: stillStale,
        status: stillStale ? 'stale-after-build' : 'fresh',
    };
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const result = ensureLocalDistFresh(options);

    if (options.json) {
        console.log(JSON.stringify(result));
    } else {
        console.log(
            `Local dist is ${result.status}. ` +
                `frontendStale=${result.frontendStale} backendStale=${result.backendStale}`
        );
    }

    process.exit(
        result.status === 'build-failed' || result.status === 'stale-after-build'
            ? result.exitCode ?? 1
            : 0
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}
