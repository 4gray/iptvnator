import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';

const args = process.argv.slice(2);
const normalizedArgs = args[0] === '--' ? args.slice(1) : args;
const smokeTimeoutArg = normalizedArgs.find((arg) =>
    arg.startsWith('--smoke-timeout-ms=')
);
const smokeTimeoutMs = smokeTimeoutArg
    ? Number(smokeTimeoutArg.slice('--smoke-timeout-ms='.length))
    : 0;
const remoteDebuggingPortArg = normalizedArgs.find((arg) =>
    arg.startsWith('--remote-debugging-port=')
);
const remoteDebuggingEnabled =
    !normalizedArgs.includes('--no-remote-debugging') &&
    (normalizedArgs.includes('--remote-debugging') ||
        Boolean(remoteDebuggingPortArg));
const positionalArgs = normalizedArgs.filter((arg) => !arg.startsWith('--'));
const [platformArg, arch = ''] = positionalArgs;
const currentPlatform =
    platformArg ??
    (process.platform === 'darwin'
        ? 'macos'
        : process.platform === 'win32'
          ? 'windows'
          : 'linux');

const workspaceRoot = process.cwd();
const executableRoots = [
    path.join(workspaceRoot, 'dist', 'executables'),
    path.join(workspaceRoot, 'dist', 'packages'),
];
const remoteDebuggingPort = remoteDebuggingPortArg
    ? remoteDebuggingPortArg.slice('--remote-debugging-port='.length)
    : '9222';
const windowsDetachedProcessGraceMs = 3000;

function ensureFile(filePath) {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function findUnpackedExecutable(prefix, executableNames) {
    for (const executablesRoot of executableRoots) {
        if (!fs.existsSync(executablesRoot)) {
            continue;
        }

        const unpackedDirs = fs
            .readdirSync(executablesRoot, { withFileTypes: true })
            .filter(
                (entry) =>
                    entry.isDirectory() &&
                    entry.name.startsWith(prefix) &&
                    entry.name.endsWith('-unpacked')
            )
            .map((entry) => path.join(executablesRoot, entry.name));

        for (const unpackedDir of unpackedDirs) {
            for (const executableName of executableNames) {
                const executablePath = path.join(unpackedDir, executableName);
                if (ensureFile(executablePath)) {
                    return executablePath;
                }
            }
        }
    }

    return undefined;
}

function resolvePackagedExecutable() {
    if (currentPlatform === 'macos') {
        const candidates = executableRoots.flatMap((executablesRoot) => [
            {
                arch: 'x64',
                executable: path.join(
                    executablesRoot,
                    'mac',
                    'IPTVnator.app',
                    'Contents',
                    'MacOS',
                    'IPTVnator'
                ),
            },
            {
                arch: 'arm64',
                executable: path.join(
                    executablesRoot,
                    'mac-arm64',
                    'IPTVnator.app',
                    'Contents',
                    'MacOS',
                    'IPTVnator'
                ),
            },
        ]);

        const match = candidates.find(
            (candidate) => (!arch || candidate.arch === arch) && ensureFile(candidate.executable)
        );
        return match?.executable;
    }

    if (currentPlatform === 'windows') {
        return findUnpackedExecutable('win', ['IPTVnator.exe']);
    }

    if (currentPlatform === 'linux') {
        return findUnpackedExecutable('linux', ['IPTVnator', 'iptvnator']);
    }

    return undefined;
}

function psSingleQuoted(value) {
    return `'${value.replaceAll("'", "''")}'`;
}

function getWindowsProcessIdsByExecutable(executablePath) {
    const escapedPath = psSingleQuoted(executablePath);
    const script = [
        `$ErrorActionPreference = 'SilentlyContinue'`,
        `$target = ${escapedPath}`,
        'Get-CimInstance Win32_Process',
        '  | Where-Object { $_.ExecutablePath -eq $target }',
        '  | ForEach-Object { $_.ProcessId }',
    ].join('; ');

    const result = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        {
            encoding: 'utf8',
            windowsHide: true,
        }
    );

    if (result.status !== 0) {
        return [];
    }

    return result.stdout
        .split(/\r?\n/)
        .map((line) => Number(line.trim()))
        .filter((processId) => Number.isInteger(processId) && processId > 0);
}

function stopWindowsProcessIds(processIds) {
    if (processIds.length === 0) {
        return;
    }

    spawnSync(
        'powershell.exe',
        [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Stop-Process -Id ${processIds.join(',')} -Force -ErrorAction SilentlyContinue`,
        ],
        {
            encoding: 'utf8',
            windowsHide: true,
        }
    );
}

const executable = resolvePackagedExecutable();

if (!executable) {
    console.error(
        `Unable to resolve a packaged executable for ${currentPlatform}${arch ? ` (${arch})` : ''}.`
    );
    process.exit(1);
}

console.log(`Launching packaged app: ${executable}`);
if (remoteDebuggingEnabled) {
    console.log(
        `After the window opens, connect with: agent-browser --cdp ${remoteDebuggingPort} tab list`
    );
}

const childArgs = remoteDebuggingEnabled
    ? [`--remote-debugging-port=${remoteDebuggingPort}`]
    : [];
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, childArgs, {
    env: childEnv,
    stdio: 'inherit',
    detached: false,
});

let smokeTimeout;
let smokeCompleted = false;
let childExited = false;
let childExitCode = null;
let detachedProcessObserved = false;
let earlyExitCheckInterval;

function getPackagedProcessIds() {
    if (currentPlatform === 'windows') {
        return getWindowsProcessIdsByExecutable(executable);
    }

    return childExited ? [] : [child.pid].filter(Boolean);
}

function stopPackagedApp() {
    if (!childExited) {
        child.kill();
    }

    if (currentPlatform === 'windows') {
        stopWindowsProcessIds(getPackagedProcessIds());
    }
}

function completeSmoke(exitCode) {
    if (smokeCompleted) {
        return;
    }

    smokeCompleted = true;

    if (smokeTimeout) {
        clearTimeout(smokeTimeout);
    }
    if (earlyExitCheckInterval) {
        clearInterval(earlyExitCheckInterval);
    }

    process.exit(exitCode);
}

if (Number.isFinite(smokeTimeoutMs) && smokeTimeoutMs > 0) {
    smokeTimeout = setTimeout(() => {
        const processIds = getPackagedProcessIds();
        if (processIds.length > 0 || detachedProcessObserved || !childExited) {
            console.log(`Smoke timeout reached after ${smokeTimeoutMs}ms; closing packaged app.`);
            stopPackagedApp();
            completeSmoke(0);
            return;
        }

        console.error(
            `Packaged app exited before the smoke timeout with code ${
                childExitCode ?? 'null'
            }.`
        );
        completeSmoke(childExitCode && childExitCode !== 0 ? childExitCode : 1);
    }, smokeTimeoutMs);
}

child.on('exit', (code) => {
    childExited = true;
    childExitCode = code;

    if (smokeTimeout) {
        const earlyExitDeadline = Date.now() + windowsDetachedProcessGraceMs;
        earlyExitCheckInterval = setInterval(() => {
            const processIds = getPackagedProcessIds();
            if (processIds.length > 0) {
                detachedProcessObserved = true;
                clearInterval(earlyExitCheckInterval);
                earlyExitCheckInterval = undefined;
                return;
            }

            if (Date.now() >= earlyExitDeadline) {
                console.error(
                    `Packaged app exited before the smoke timeout with code ${
                        code ?? 'null'
                    }.`
                );
                completeSmoke(code && code !== 0 ? code : 1);
            }
        }, 250);
        return;
    }

    completeSmoke(code ?? 0);
});
