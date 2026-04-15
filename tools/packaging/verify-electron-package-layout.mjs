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
const electronBuilderConfigPath = path.join(
    workspaceRoot,
    'electron-builder.json'
);
const builderEffectiveConfigPath = path.join(
    executablesRoot,
    'builder-effective-config.yaml'
);
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
const flatpakFinishArgs = electronBuilderConfig.flatpak?.finishArgs ?? [];
const snapConfigInspection = loadSnapConfigInspection();
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
    return (
        fs.existsSync(directoryPath) && fs.statSync(directoryPath).isDirectory()
    );
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

function parseYamlScalar(value) {
    const normalizedValue = value.trim();

    if (normalizedValue === 'true') {
        return true;
    }

    if (normalizedValue === 'false') {
        return false;
    }

    if (normalizedValue === 'null') {
        return null;
    }

    const singleQuotedMatch = normalizedValue.match(/^'(.*)'$/);
    if (singleQuotedMatch) {
        return singleQuotedMatch[1].replace(/''/g, "'");
    }

    const doubleQuotedMatch = normalizedValue.match(/^"(.*)"$/);
    if (doubleQuotedMatch) {
        return doubleQuotedMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }

    return normalizedValue;
}

function getYamlSectionLines(yamlContent, sectionName) {
    const lines = yamlContent.split(/\r?\n/);
    const sectionHeader = `${sectionName}:`;
    const sectionLines = [];
    let isInsideSection = false;

    for (const line of lines) {
        if (!isInsideSection) {
            if (line === sectionHeader) {
                isInsideSection = true;
            }
            continue;
        }

        if (line.trim() === '') {
            sectionLines.push(line);
            continue;
        }

        const indentation = line.match(/^ */)?.[0].length ?? 0;
        if (indentation === 0) {
            break;
        }

        sectionLines.push(line);
    }

    return isInsideSection ? sectionLines : null;
}

function parseIndentedYamlSequence(lines, startIndex, indentation) {
    const values = [];
    let nextIndex = startIndex;

    while (nextIndex < lines.length) {
        const line = lines[nextIndex];
        const trimmedLine = line.trim();

        if (trimmedLine === '') {
            nextIndex += 1;
            continue;
        }

        const currentIndentation = line.match(/^ */)?.[0].length ?? 0;
        if (currentIndentation < indentation) {
            break;
        }

        if (currentIndentation > indentation || !trimmedLine.startsWith('- ')) {
            break;
        }

        values.push(parseYamlScalar(trimmedLine.slice(2)));
        nextIndex += 1;
    }

    return {
        values,
        nextIndex,
    };
}

function parseIndentedYamlMapping(lines, startIndex, indentation) {
    const values = {};
    let nextIndex = startIndex;

    while (nextIndex < lines.length) {
        const line = lines[nextIndex];
        const trimmedLine = line.trim();

        if (trimmedLine === '') {
            nextIndex += 1;
            continue;
        }

        const currentIndentation = line.match(/^ */)?.[0].length ?? 0;
        if (currentIndentation < indentation) {
            break;
        }

        if (currentIndentation > indentation) {
            break;
        }

        const separatorIndex = trimmedLine.indexOf(':');
        if (separatorIndex === -1) {
            break;
        }

        const key = trimmedLine.slice(0, separatorIndex).trim();
        const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
        values[key] = parseYamlScalar(rawValue);
        nextIndex += 1;
    }

    return {
        values,
        nextIndex,
    };
}

function parseEffectiveSnapConfig(yamlContent) {
    const sectionLines = getYamlSectionLines(yamlContent, 'snap');

    if (!sectionLines) {
        return null;
    }

    const snapConfig = {};

    for (let index = 0; index < sectionLines.length; index += 1) {
        const line = sectionLines[index];
        const trimmedLine = line.trim();

        if (trimmedLine === '') {
            continue;
        }

        const indentation = line.match(/^ */)?.[0].length ?? 0;
        if (indentation !== 2) {
            continue;
        }

        const separatorIndex = trimmedLine.indexOf(':');
        if (separatorIndex === -1) {
            continue;
        }

        const key = trimmedLine.slice(0, separatorIndex).trim();
        const rawValue = trimmedLine.slice(separatorIndex + 1).trim();

        if (rawValue !== '') {
            snapConfig[key] = parseYamlScalar(rawValue);
            continue;
        }

        if (key === 'executableArgs') {
            const { values, nextIndex } = parseIndentedYamlSequence(
                sectionLines,
                index + 1,
                4
            );
            snapConfig[key] = values;
            index = nextIndex - 1;
            continue;
        }

        if (key === 'environment') {
            const { values, nextIndex } = parseIndentedYamlMapping(
                sectionLines,
                index + 1,
                4
            );
            snapConfig[key] = values;
            index = nextIndex - 1;
        }
    }

    return snapConfig;
}

function loadSnapConfigInspection() {
    if (fileExists(builderEffectiveConfigPath)) {
        const effectiveConfigContent = fs.readFileSync(
            builderEffectiveConfigPath,
            'utf8'
        );
        const effectiveSnapConfig = parseEffectiveSnapConfig(
            effectiveConfigContent
        );

        if (effectiveSnapConfig) {
            return {
                config: effectiveSnapConfig,
                sourcePath: builderEffectiveConfigPath,
            };
        }
    }

    return {
        config: electronBuilderConfig.snap ?? {},
        sourcePath: electronBuilderConfigPath,
    };
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

function verifyFlatpakPermissions(errors) {
    if (!Array.isArray(flatpakFinishArgs)) {
        errors.push('Flatpak finishArgs must be configured as an array.');
        return;
    }

    if (!flatpakFinishArgs.includes('--talk-name=org.freedesktop.Flatpak')) {
        errors.push(
            'Flatpak finishArgs must include --talk-name=org.freedesktop.Flatpak for host player launching.'
        );
    }
}

function verifySnapPackagingConfig(errors) {
    if (snapConfigInspection.config?.base !== 'core22') {
        errors.push(
            `Snap config in ${snapConfigInspection.sourcePath} must set base to core22 so packaged native modules stay compatible with the Snap runtime glibc.`
        );
    }

    const snapExecutableArgs = Array.isArray(
        snapConfigInspection.config?.executableArgs
    )
        ? snapConfigInspection.config.executableArgs
        : [];

    if (!snapExecutableArgs.includes('--ozone-platform=x11')) {
        errors.push(
            `Snap config in ${snapConfigInspection.sourcePath} must include --ozone-platform=x11 in executableArgs.`
        );
    }

    if (snapConfigInspection.config?.allowNativeWayland === true) {
        errors.push(
            `Snap config in ${snapConfigInspection.sourcePath} must not enable allowNativeWayland while the X11 startup workaround is required.`
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
            errors.push(
                `Missing Flatpak metainfo file: ${flatpakMetainfoPath}`
            );
        }
        verifyFlatpakPermissions(errors);
        verifySnapPackagingConfig(errors);
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
