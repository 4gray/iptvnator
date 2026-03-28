import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const args = process.argv.slice(2);
const normalizedArgs = args[0] === '--' ? args.slice(1) : args;
const [platformArg, arch = ''] = normalizedArgs;
const currentPlatform =
    platformArg ??
    (process.platform === 'darwin'
        ? 'macos'
        : process.platform === 'win32'
          ? 'windows'
          : 'linux');

const workspaceRoot = process.cwd();
const executablesRoot = path.join(workspaceRoot, 'dist', 'executables');
const remoteDebuggingPort = '9222';

function ensureFile(filePath) {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function findUnpackedExecutable(prefix, executableNames) {
    if (!fs.existsSync(executablesRoot)) {
        return undefined;
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

    return undefined;
}

function resolvePackagedExecutable() {
    if (currentPlatform === 'macos') {
        const candidates = [
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
        ];

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

const executable = resolvePackagedExecutable();

if (!executable) {
    console.error(
        `Unable to resolve a packaged executable for ${currentPlatform}${arch ? ` (${arch})` : ''}.`
    );
    process.exit(1);
}

console.log(`Launching packaged app: ${executable}`);
console.log(
    `After the window opens, connect with: agent-browser --cdp ${remoteDebuggingPort} tab list`
);

const child = spawn(executable, [`--remote-debugging-port=${remoteDebuggingPort}`], {
    stdio: 'inherit',
    detached: false,
});

child.on('exit', (code) => {
    process.exit(code ?? 0);
});
