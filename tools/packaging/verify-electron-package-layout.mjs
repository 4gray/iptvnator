import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';

import { buildElectronBuilderMetadata } from './generate-electron-builder-metadata.mjs';
import {
    collectEmbeddedMpvNativeArchiveEntries,
    inspectPackagedDependencyClosure,
} from './asar-dependency-closure.mjs';

const require = createRequire(import.meta.url);
const { extractFile, listPackage } = require('@electron/asar');
const {
    linuxUnpackedDirArch,
    resolveConfiguredLinuxTargetNames,
    validatePackagedEmbeddedMpv,
} = require('./embedded-mpv-packaging.cjs');
const {
    validateLinuxProfileTargets,
} = require('./linux-frame-copy-profile.cjs');
const { resolveLinuxLauncherLayout } = require('./linux-launcher-layout.cjs');
const {
    validateFlatpakLauncher,
} = require('./flatpak-launcher-validation.cjs');
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
const packageOutputRoots = [
    path.join(workspaceRoot, 'dist', 'executables'),
    path.join(workspaceRoot, 'dist', 'packages'),
];
const packageJsonPath = path.join(workspaceRoot, 'package.json');
const electronBuilderConfigPath = path.join(
    workspaceRoot,
    'electron-builder.json'
);
const builderEffectiveConfigPaths = packageOutputRoots.map((outputRoot) =>
    path.join(outputRoot, 'builder-effective-config.yaml')
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
const linuxExecutableArgs = electronBuilderConfig.linux?.executableArgs ?? [];
const snapConfigInspection = loadSnapConfigInspection();
const embeddedMpvRequired = isTruthy(
    process.env.IPTVNATOR_REQUIRE_EMBEDDED_MPV
);
const linuxFrameCopyProfile =
    process.env.IPTVNATOR_LINUX_FRAME_COPY_PROFILE?.trim() || undefined;
const workerRelativeDir = path.join(
    'dist',
    'apps',
    'electron-backend',
    'workers'
);
const workerFiles = ['epg-parser.worker.js', 'database.worker.js'];
const packagedPackageMetadata = buildElectronBuilderMetadata(
    packageMetadata,
    electronBuilderConfig
).extraMetadata;
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

function isTruthy(value) {
    return ['1', 'true', 'yes', 'on'].includes(
        String(value ?? '')
            .trim()
            .toLowerCase()
    );
}

function getMacResourceDirs() {
    const candidates = packageOutputRoots.flatMap((outputRoot) => [
        {
            arch: 'x64',
            directory: path.join(
                outputRoot,
                'mac',
                'IPTVnator.app',
                'Contents',
                'Resources'
            ),
        },
        {
            arch: 'arm64',
            directory: path.join(
                outputRoot,
                'mac-arm64',
                'IPTVnator.app',
                'Contents',
                'Resources'
            ),
        },
    ]);

    return candidates
        .filter((candidate) => !arch || candidate.arch === arch)
        .map((candidate) => candidate.directory)
        .filter(directoryExists);
}

function getUnpackedResourceDirs(prefix) {
    return packageOutputRoots.filter(directoryExists).flatMap((outputRoot) =>
        fs
            .readdirSync(outputRoot, { withFileTypes: true })
            .filter(
                (entry) =>
                    entry.isDirectory() &&
                    entry.name.startsWith(prefix) &&
                    entry.name.endsWith('-unpacked')
            )
            .map((entry) => path.join(outputRoot, entry.name, 'resources'))
            .filter(directoryExists)
    );
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
    const invalidCharacters = new Set([
        '<',
        '>',
        ':',
        '"',
        '/',
        '\\',
        '|',
        '?',
        '*',
    ]);

    return [...value]
        .filter(
            (character) =>
                character.charCodeAt(0) >= 32 &&
                !invalidCharacters.has(character)
        )
        .join('');
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
    const builderEffectiveConfigPath =
        builderEffectiveConfigPaths.find(fileExists);

    if (builderEffectiveConfigPath) {
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

function formatJsonValue(value) {
    return JSON.stringify(value);
}

function packageMetadataMatches(actualValue, expectedValue) {
    return formatJsonValue(actualValue) === formatJsonValue(expectedValue);
}

function readAsarPackageMetadata(asarPath) {
    return JSON.parse(extractFile(asarPath, 'package.json').toString('utf8'));
}

function verifyPackagedPackageMetadata(resourceDir, errors) {
    const asarPath = path.join(resourceDir, 'app.asar');

    if (!fileExists(asarPath)) {
        errors.push(`Missing packaged app archive: ${asarPath}`);
        return;
    }

    let appPackageMetadata;

    try {
        appPackageMetadata = readAsarPackageMetadata(asarPath);
    } catch (error) {
        errors.push(
            `Unable to read package.json from ${asarPath}: ${error.message}`
        );
        return;
    }

    const mismatches = Object.entries(packagedPackageMetadata)
        .filter(([, expectedValue]) => expectedValue !== undefined)
        .filter(
            ([fieldName, expectedValue]) =>
                !packageMetadataMatches(
                    appPackageMetadata[fieldName],
                    expectedValue
                )
        )
        .map(([fieldName, expectedValue]) => {
            const actualValue = appPackageMetadata[fieldName];

            return `- ${fieldName}: expected ${formatJsonValue(expectedValue)}, received ${formatJsonValue(actualValue)}`;
        });

    if (mismatches.length > 0) {
        errors.push(
            [
                `Packaged app package.json metadata does not match root package identity in ${asarPath}.`,
                ...mismatches,
            ].join('\n')
        );
    }
}

function verifyLinuxLauncher(resourceDir, targetNames, errors) {
    let launcherLayout;
    try {
        launcherLayout = resolveLinuxLauncherLayout(
            targetNames,
            linuxExecutableName
        );
    } catch (error) {
        errors.push(
            `Unable to resolve Linux launcher layout: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
        return;
    }

    const appDir = path.dirname(resourceDir);
    const launcherPath = path.join(appDir, linuxExecutableName);

    if (!launcherLayout.wrapperRequired) {
        errors.push(...validateFlatpakLauncher(appDir, linuxExecutableName));
        return;
    }

    const launcherBinaryPath = path.join(
        appDir,
        launcherLayout.electronBinaryName
    );

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

function verifyLinuxExecutableArgs(errors) {
    if (!Array.isArray(linuxExecutableArgs)) {
        errors.push('linux.executableArgs must be configured as an array.');
        return;
    }

    if (!linuxExecutableArgs.includes('--ozone-platform=x11')) {
        errors.push(
            'linux.executableArgs must include --ozone-platform=x11 while embedded MPV requires X11/Xwayland on Linux.'
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

function verifyPackagedDependencyClosure(resourceDir, errors) {
    const asarPath = path.join(resourceDir, 'app.asar');

    if (!fileExists(asarPath)) {
        // Missing archive is already reported by verifyPackagedPackageMetadata.
        return;
    }

    let inspection;

    try {
        inspection = inspectPackagedDependencyClosure(asarPath, {
            listPackage,
            extractFile,
        });
    } catch (error) {
        errors.push(
            `Unable to inspect packaged app archive ${asarPath}: ${error.message}`
        );
        return;
    }

    const { missing, packageCount, manifestReadFailures } = inspection;

    // A packaged app always ships node_modules, so an empty audit means the
    // guard itself failed (e.g. path-separator handling), not a healthy asar.
    if (packageCount === 0) {
        errors.push(
            `Dependency-closure guard found no node_modules packages in ${asarPath}; the audit cannot have run against the real archive contents.`
        );
        return;
    }

    if (manifestReadFailures.length > 0) {
        errors.push(
            [
                `Dependency-closure guard could not read ${manifestReadFailures.length} package manifest(s) in ${asarPath}:`,
                ...manifestReadFailures.map(
                    (failure) => `- ${failure.packageDir}: ${failure.message}`
                ),
            ].join('\n')
        );
    }

    if (missing.length === 0) {
        return;
    }

    const details = missing
        .map(
            (entry) => `- ${entry.dependency} (required by ${entry.requiredBy})`
        )
        .join('\n');

    errors.push(
        [
            `Packaged app.asar is missing runtime node_modules in ${asarPath}.`,
            "electron-builder's pnpm collector likely dropped a deduplicated transitive dependency.",
            'Fix it by declaring the missing package as a direct dependency in package.json (see issue #1103).',
            details,
        ].join('\n')
    );
}

function verifyNoEmbeddedMpvNativeArchiveEntries(resourceDir, errors) {
    const asarPath = path.join(resourceDir, 'app.asar');
    if (!fileExists(asarPath)) {
        // Missing archive is already reported by verifyPackagedPackageMetadata.
        return;
    }

    let nativeEntries;
    try {
        nativeEntries = collectEmbeddedMpvNativeArchiveEntries(
            listPackage(asarPath)
        );
    } catch (error) {
        errors.push(
            `Unable to inspect embedded MPV archive ownership in ${asarPath}: ${error.message}`
        );
        return;
    }

    if (nativeEntries.length > 0) {
        errors.push(
            [
                `Packaged app.asar must not contain embedded MPV native payloads; afterPack exclusively owns the profile-specific unpacked directory in ${asarPath}.`,
                ...nativeEntries.map((entry) => `- ${entry}`),
            ].join('\n')
        );
    }
}

// Official Linux frame-copy support is x64-only. Every arm64/armv7l output
// must carry the unavailable marker instead of native frame-copy artifacts.
function isForeignArchLinuxResourceDir(resourceDir) {
    if (platform !== 'linux') {
        return false;
    }

    const dirArch = linuxUnpackedDirArch(
        path.basename(path.dirname(resourceDir))
    );
    return Boolean(dirArch) && dirArch !== 'x64';
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
    let linuxTargetNames;

    verifyPackagedPackageMetadata(resourceDir, errors);
    verifyPackagedDependencyClosure(resourceDir, errors);
    verifyNoEmbeddedMpvNativeArchiveEntries(resourceDir, errors);

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
        const resourceArch =
            linuxUnpackedDirArch(path.basename(path.dirname(resourceDir))) ||
            arch;
        try {
            linuxTargetNames = resolveConfiguredLinuxTargetNames(
                electronBuilderConfig.linux?.target,
                resourceArch
            );
            if (linuxFrameCopyProfile) {
                errors.push(
                    ...validateLinuxProfileTargets(
                        linuxFrameCopyProfile,
                        linuxTargetNames
                    )
                );
            }
        } catch (error) {
            errors.push(
                `Unable to resolve selected Linux package targets: ${error.message}`
            );
            linuxTargetNames = [];
        }
        if (!fileExists(flatpakMetainfoPath)) {
            errors.push(
                `Missing Flatpak metainfo file: ${flatpakMetainfoPath}`
            );
        }
        verifyLinuxExecutableArgs(errors);
        verifyFlatpakPermissions(errors);
        verifySnapPackagingConfig(errors);
        verifyLinuxLauncher(resourceDir, linuxTargetNames, errors);
    }

    errors.push(
        ...validatePackagedEmbeddedMpv(resourceDir, {
            platform,
            required: embeddedMpvRequired,
            foreignArch: isForeignArchLinuxResourceDir(resourceDir),
            profile: linuxFrameCopyProfile,
            targetNames: linuxTargetNames,
            executableName: linuxExecutableName,
        })
    );

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
