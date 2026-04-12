import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const normalizedArgs = args[0] === '--' ? args.slice(1) : args;
const [platform, arch = ''] = normalizedArgs;

if (!platform) {
    console.error(
        'Usage: node tools/packaging/verify-electron-package-layout.mjs <macos|linux|windows> [arch]'
    );
    process.exit(1);
}

const workspaceRoot = process.cwd();
const executablesRoot = path.join(workspaceRoot, 'dist', 'executables');
const packageJsonPath = path.join(workspaceRoot, 'package.json');
const electronBuilderConfigPath = path.join(workspaceRoot, 'electron-builder.json');
const flatpakMetainfoPath = path.join(
    workspaceRoot,
    'apps',
    'electron-backend',
    'linux',
    'com.fourgray.iptvnator.metainfo.xml'
);
const packageMetadata = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const electronBuilderConfig = JSON.parse(
    fs.readFileSync(electronBuilderConfigPath, 'utf8')
);
const workerRelativeDir = path.join(
    'dist',
    'apps',
    'electron-backend',
    'workers'
);
const workerFiles = ['epg-parser.worker.js', 'database.worker.js'];
const nativeModuleRelativeDirs = [
    path.join('app.asar.unpacked', 'node_modules'),
    path.join('app.asar.unpacked', 'electron-backend', 'node_modules'),
    path.join(
        'app.asar.unpacked',
        'dist',
        'apps',
        'electron-backend',
        'node_modules'
    ),
];
const linuxExecutableName = getLinuxExecutableName();

function directoryExists(directoryPath) {
    return fs.existsSync(directoryPath) && fs.statSync(directoryPath).isDirectory();
}

function fileExists(filePath) {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function getMacResourceDirs() {
    const candidates = [
        {
            arch: 'x64',
            directory: path.join(
                executablesRoot,
                'mac',
                'IPTVnator.app',
                'Contents',
                'Resources'
            ),
        },
        {
            arch: 'arm64',
            directory: path.join(
                executablesRoot,
                'mac-arm64',
                'IPTVnator.app',
                'Contents',
                'Resources'
            ),
        },
    ];

    return candidates
        .filter((candidate) => !arch || candidate.arch === arch)
        .map((candidate) => candidate.directory)
        .filter(directoryExists);
}

function getUnpackedResourceDirs(prefix) {
    if (!directoryExists(executablesRoot)) {
        return [];
    }

    return fs
        .readdirSync(executablesRoot, { withFileTypes: true })
        .filter(
            (entry) =>
                entry.isDirectory() &&
                entry.name.startsWith(prefix) &&
                entry.name.endsWith('-unpacked')
        )
        .map((entry) => path.join(executablesRoot, entry.name, 'resources'))
        .filter(directoryExists);
}

function getResourceDirs() {
    switch (platform) {
        case 'macos':
            return getMacResourceDirs();
        case 'linux':
            return getUnpackedResourceDirs('linux');
        case 'windows':
            return getUnpackedResourceDirs('win');
        default:
            console.error(`Unsupported platform "${platform}"`);
            process.exit(1);
    }
}

function sanitizeExecutableName(value) {
    return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '');
}

function getLinuxExecutableName() {
    const configuredExecutableName =
        electronBuilderConfig.linux?.executableName ??
        electronBuilderConfig.executableName;

    if (configuredExecutableName) {
        return sanitizeExecutableName(configuredExecutableName);
    }

    return packageMetadata.name.toLowerCase();
}

function verifyLinuxLauncher(resourceDir, errors) {
    const appDir = path.dirname(resourceDir);
    const launcherPath = path.join(appDir, linuxExecutableName);
    const launcherBinaryPath = `${launcherPath}.bin`;

    if (!fileExists(launcherBinaryPath)) {
        errors.push(
            `Missing Linux launcher binary in ${appDir}: ${path.basename(launcherBinaryPath)}`
        );
        return;
    }

    if (!fileExists(launcherPath)) {
        errors.push(
            `Missing Linux launcher wrapper in ${appDir}: ${path.basename(launcherPath)}`
        );
        return;
    }

    const launcherScript = fs.readFileSync(launcherPath, 'utf8');
    const requiredMarkers = [
        'SCRIPT_PATH="${BASH_SOURCE[0]}"',
        'readlink -f "$SCRIPT_PATH"',
        `exec "$SCRIPT_DIR/${linuxExecutableName}.bin"`,
    ];
    const missingMarkers = requiredMarkers.filter(
        (marker) => !launcherScript.includes(marker)
    );

    if (missingMarkers.length > 0) {
        errors.push(
            [
                `Linux launcher wrapper is missing symlink-safe logic in ${launcherPath}.`,
                'Missing markers:',
                ...missingMarkers.map((marker) => `- ${marker}`),
            ].join('\n')
        );
    }
}

function verifyResourceDir(resourceDir) {
    const missingWorkers = workerFiles.filter(
        (workerFile) =>
            !fileExists(path.join(resourceDir, workerRelativeDir, workerFile))
    );

    const nativeModuleDirs = nativeModuleRelativeDirs.map((relativeDir) =>
        path.join(resourceDir, relativeDir)
    );
    const matchingNativeModuleDir = nativeModuleDirs.find((nativeDir) =>
        fileExists(path.join(nativeDir, 'better-sqlite3', 'package.json'))
    );

    const errors = [];

    if (missingWorkers.length > 0) {
        errors.push(
            `Missing worker artifacts in ${resourceDir}: ${missingWorkers.join(', ')}`
        );
    }

    if (!matchingNativeModuleDir) {
        errors.push(
            [
                `Unable to find unpacked better-sqlite3 in ${resourceDir}.`,
                'Checked:',
                ...nativeModuleDirs.map((nativeDir) => `- ${nativeDir}`),
            ].join('\n')
        );
    }

    if (platform === 'linux') {
        if (!fileExists(flatpakMetainfoPath)) {
            errors.push(`Missing Flatpak metainfo file: ${flatpakMetainfoPath}`);
        }
        verifyLinuxLauncher(resourceDir, errors);
    }

    return {
        resourceDir,
        errors,
        matchingNativeModuleDir,
    };
}

const resourceDirs = getResourceDirs();

if (resourceDirs.length === 0) {
    console.error(
        `No packaged resource directories found for ${platform}${arch ? ` (${arch})` : ''}.`
    );
    process.exit(1);
}

const results = resourceDirs.map(verifyResourceDir);
const failures = results.filter((result) => result.errors.length > 0);

for (const result of results) {
    console.log(`Verified packaged resources: ${result.resourceDir}`);
    if (result.matchingNativeModuleDir) {
        console.log(
            `Resolved unpacked better-sqlite3 at: ${result.matchingNativeModuleDir}`
        );
    }
}

if (failures.length > 0) {
    for (const failure of failures) {
        console.error(failure.errors.join('\n'));
    }
    process.exit(1);
}
