#!/usr/bin/env node

import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
    BUILD_RECIPES,
    BUILD_ORDER,
    EXPECTED_SYSTEM_PKG_CONFIG_PACKAGES,
    MPV_MESON_FLAGS,
    PORTABLE_ABI_BASELINE,
    REQUIRED_TOOLS,
    SOURCE_PACKAGES,
    assertArchiveMatchesPin,
    assertGitCommitMatchesPin,
    assertMinimumToolVersions,
    assertOwnedOutputDestination,
    assertPortableAbiRecords,
    assertPortableBuildHostGlibc,
    assertUniqueMesonOptionAssignments,
    canonicalizeGitSubmoduleStatus,
    createBuildEnvironment,
    createLinuxRuntimeManifest,
    createOwnedStagingPrefix,
    createRuntimeFileRecords,
    ownedStagingPrefixPath,
    parseCliInvocation,
    parseReadelfDynamic,
    parseReadelfVersionInfo,
    preparePinnedHwdataBuildInput,
    retainRuntimeLibraries,
    resolveLinuxPackageBuildEnvironment,
    resolveSystemPkgConfigDirs,
    runtimeLibraryNames,
    selectReachableRuntimeLibraryNames,
    sha256Buffer,
    publishOwnedOutput,
    validateRuntimeDependencyClosure,
} = require('./build-linux-runtime.cjs');
const {
    validateLinuxRuntimeManifest,
} = require('./linux-runtime-manifest.cjs');

const scriptPath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(scriptPath), '..', '..');
const sourcePackageById = new Map(
    SOURCE_PACKAGES.map((sourcePackage) => [sourcePackage.id, sourcePackage])
);

function log(message) {
    process.stdout.write(`[embedded-mpv-linux-runtime] ${message}\n`);
}

function commandLine(command, args) {
    return [command, ...args]
        .map((value) =>
            /^[A-Za-z0-9_./:=+,-]+$/.test(value) ? value : JSON.stringify(value)
        )
        .join(' ');
}

function spawn(command, args, options, capture) {
    log(commandLine(command, args));
    const result = spawnSync(command, args, {
        cwd: options.cwd,
        env: options.env,
        encoding: capture ? 'utf8' : undefined,
        stdio: capture ? 'pipe' : 'inherit',
    });

    if (result.error) {
        throw new Error(
            `Unable to run ${commandLine(command, args)}: ${result.error.message}`
        );
    }
    if (result.status !== 0) {
        const details = capture
            ? [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
            : '';
        throw new Error(
            `${commandLine(command, args)} failed with status ${
                result.status ?? 1
            }.${details ? `\n${details}` : ''}`
        );
    }
    return result;
}

function createCommandRunner({ buildEnvironment }) {
    return {
        run(command, args, options = {}) {
            spawn(
                command,
                args,
                {
                    cwd: options.cwd ?? workspaceRoot,
                    env: options.env ?? buildEnvironment,
                },
                false
            );
        },
        runCapture(command, args, options = {}) {
            const result = spawn(
                command,
                args,
                {
                    cwd: options.cwd ?? workspaceRoot,
                    env: options.env ?? buildEnvironment,
                },
                true
            );
            return [result.stdout, result.stderr]
                .filter(Boolean)
                .join('\n')
                .trim();
        },
    };
}

function commandExists(command) {
    const result = spawnSync(
        'sh',
        ['-c', 'command -v "$1" >/dev/null 2>&1', 'sh', command],
        { stdio: 'ignore' }
    );
    return result.status === 0;
}

function ensureTools() {
    const missingTools = REQUIRED_TOOLS.filter(
        (command) => !commandExists(command)
    );
    if (missingTools.length > 0) {
        throw new Error(
            `Missing required Linux runtime build tools: ${missingTools.join(
                ', '
            )}.`
        );
    }
}

function resolveParallelism(environment) {
    const explicitJobs = environment.IPTVNATOR_EMBEDDED_MPV_JOBS;
    const makeJobs = environment.MAKEFLAGS?.match(
        /(?:^|\s)-j\s*(\d+)(?:\s|$)/
    )?.[1];
    const value =
        explicitJobs ??
        makeJobs ??
        String(os.availableParallelism?.() ?? os.cpus().length);
    if (!/^[1-9]\d*$/.test(value)) {
        throw new Error(
            `IPTVNATOR_EMBEDDED_MPV_JOBS must be a positive integer; received ${value}.`
        );
    }
    return value;
}

function containsPath(parentPath, candidatePath) {
    const relativePath = path.relative(parentPath, candidatePath);
    return (
        relativePath === '' ||
        (!relativePath.startsWith(`..${path.sep}`) &&
            relativePath !== '..' &&
            !path.isAbsolute(relativePath))
    );
}

function assertSafeOutputPrefix(prefix, buildRoot) {
    const filesystemRoot = path.parse(prefix).root;
    if (
        prefix === filesystemRoot ||
        containsPath(prefix, workspaceRoot) ||
        containsPath(prefix, buildRoot)
    ) {
        throw new Error(
            `Refusing unsafe output prefix ${prefix}; choose a dedicated directory that does not contain the repository or build cache.`
        );
    }
}

function archiveExtension(sourceUrl) {
    for (const extension of ['.tar.xz', '.tar.gz', '.tar.bz2', '.tgz']) {
        if (new URL(sourceUrl).pathname.endsWith(extension)) {
            return extension;
        }
    }
    throw new Error(`Unsupported source archive URL: ${sourceUrl}`);
}

function archivePathFor(sourcePackage, archiveRoot) {
    return path.join(
        archiveRoot,
        `${sourcePackage.id}-${sourcePackage.version}${archiveExtension(
            sourcePackage.sourceUrl
        )}`
    );
}

function sourcePathFor(packageId, sourceRoot) {
    return path.join(sourceRoot, packageId);
}

function sha256File(filePath) {
    return sha256Buffer(fs.readFileSync(filePath));
}

function downloadArchive(sourcePackage, context) {
    const archivePath = archivePathFor(sourcePackage, context.archiveRoot);
    if (!fs.existsSync(archivePath)) {
        const temporaryArchivePath = `${archivePath}.partial`;
        fs.rmSync(temporaryArchivePath, { force: true });
        context.run('curl', [
            '--fail',
            '--location',
            '--retry',
            '3',
            '--retry-all-errors',
            '--connect-timeout',
            '30',
            '--proto',
            '=https',
            '--tlsv1.2',
            '--output',
            temporaryArchivePath,
            sourcePackage.sourceUrl,
        ]);
        fs.renameSync(temporaryArchivePath, archivePath);
    }

    const sourceSha256 = sha256File(archivePath);
    assertArchiveMatchesPin(sourcePackage, sourceSha256);
    const packageSourcePath = sourcePathFor(
        sourcePackage.id,
        context.sourceRoot
    );
    fs.rmSync(packageSourcePath, { recursive: true, force: true });
    fs.mkdirSync(packageSourcePath, { recursive: true });
    context.run('tar', [
        '--extract',
        '--file',
        archivePath,
        '--directory',
        packageSourcePath,
        '--strip-components',
        '1',
        '--no-same-owner',
    ]);

    return {
        ...sourcePackage,
        sourceSha256,
    };
}

function cloneGitSource(sourcePackage, context) {
    const packageSourcePath = sourcePathFor(
        sourcePackage.id,
        context.sourceRoot
    );
    fs.rmSync(packageSourcePath, { recursive: true, force: true });
    context.run('git', [
        'clone',
        '--depth',
        '1',
        '--branch',
        sourcePackage.sourceTag,
        sourcePackage.sourceUrl,
        packageSourcePath,
    ]);
    const sourceGitCommit = context.runCapture('git', ['rev-parse', 'HEAD'], {
        cwd: packageSourcePath,
    });
    assertGitCommitMatchesPin(sourcePackage, sourceGitCommit);
    context.run(
        'git',
        ['submodule', 'update', '--init', '--recursive', '--depth', '1'],
        { cwd: packageSourcePath }
    );

    const submoduleOutput = context.runCapture(
        'git',
        ['submodule', 'status', '--recursive'],
        { cwd: packageSourcePath }
    );

    return {
        ...sourcePackage,
        sourceGitCommit,
        sourceSubmodules: canonicalizeGitSubmoduleStatus(submoduleOutput),
    };
}

function acquireSources(context) {
    fs.mkdirSync(context.archiveRoot, { recursive: true });
    fs.mkdirSync(context.sourceRoot, { recursive: true });
    const sourceRecords = {};

    for (const packageId of BUILD_ORDER) {
        const sourcePackage = sourcePackageById.get(packageId);
        log(
            `Acquiring ${sourcePackage.id} ${sourcePackage.version} from ${sourcePackage.sourceUrl}`
        );
        sourceRecords[packageId] =
            sourcePackage.sourceKind === 'git'
                ? cloneGitSource(sourcePackage, context)
                : downloadArchive(sourcePackage, context);
    }
    return sourceRecords;
}

function configureInstall(packageId, recipe, context) {
    const sourcePath = sourcePathFor(packageId, context.sourceRoot);
    context.run('./configure', [`--prefix=${context.prefix}`, ...recipe.args], {
        cwd: sourcePath,
    });
    context.run('make', [`-j${context.parallelism}`], { cwd: sourcePath });
    context.run('make', ['install'], { cwd: sourcePath });
}

function mesonSetupArgs(prefix, recipeArgs) {
    return [
        `--prefix=${prefix}`,
        '--libdir=lib',
        '--buildtype=release',
        '--default-library=shared',
        '--wrap-mode=nodownload',
        '--auto-features=disabled',
        '-Db_ndebug=true',
        ...recipeArgs,
    ];
}

function mesonInstall(packageId, recipe, context) {
    const sourcePath = sourcePathFor(packageId, context.sourceRoot);
    const buildPath = path.join(sourcePath, 'build-iptvnator');
    const buildEnvironment = resolveLinuxPackageBuildEnvironment(
        packageId,
        context
    );
    fs.rmSync(buildPath, { recursive: true, force: true });
    context.run(
        'meson',
        ['setup', buildPath, ...mesonSetupArgs(context.prefix, recipe.args)],
        { cwd: sourcePath, env: buildEnvironment }
    );
    context.run(
        'meson',
        ['compile', '--jobs', context.parallelism, '-C', buildPath],
        { cwd: sourcePath, env: buildEnvironment }
    );
    context.run('meson', ['install', '-C', buildPath], {
        cwd: sourcePath,
        env: buildEnvironment,
    });
}

function prepareHwdata(context) {
    context.hwdataBuildEnvironment = preparePinnedHwdataBuildInput({
        buildEnvironment: context.buildEnvironment,
        prefix: context.prefix,
        runCapture: (command, args, options) =>
            context.runCapture(command, args, options),
        sourcePath: sourcePathFor('hwdata', context.sourceRoot),
    });
}

function pathInsideDestdir(destdir, absolutePath) {
    return path.join(
        destdir,
        absolutePath.slice(path.parse(absolutePath).root.length)
    );
}

export function copyDirectoryContents(sourceDirectory, destinationDirectory) {
    if (!fs.existsSync(sourceDirectory)) {
        return;
    }
    fs.mkdirSync(destinationDirectory, { recursive: true });
    for (const entry of fs.readdirSync(sourceDirectory)) {
        fs.cpSync(
            path.join(sourceDirectory, entry),
            path.join(destinationDirectory, entry),
            {
                recursive: true,
                force: true,
                verbatimSymlinks: true,
            }
        );
    }
}

function installWithDestdir(packageId, context, install, externalPaths = []) {
    const destdir = path.join(context.buildRoot, 'install-roots', packageId);
    fs.rmSync(destdir, { recursive: true, force: true });
    fs.mkdirSync(destdir, { recursive: true });
    try {
        install(destdir);
        copyDirectoryContents(
            pathInsideDestdir(destdir, context.prefix),
            context.prefix
        );
        for (const { destination, source } of externalPaths) {
            copyDirectoryContents(
                pathInsideDestdir(destdir, source),
                path.join(context.prefix, destination)
            );
        }
    } finally {
        fs.rmSync(destdir, { recursive: true, force: true });
    }
}

function fontconfigInstall(recipe, context) {
    const sourcePath = sourcePathFor('fontconfig', context.sourceRoot);
    const buildPath = path.join(sourcePath, 'build-iptvnator');
    fs.rmSync(buildPath, { recursive: true, force: true });
    context.run(
        'meson',
        ['setup', buildPath, ...mesonSetupArgs(context.prefix, recipe.args)],
        { cwd: sourcePath }
    );
    context.run(
        'meson',
        ['compile', '--jobs', context.parallelism, '-C', buildPath],
        { cwd: sourcePath }
    );
    installWithDestdir(
        'fontconfig',
        context,
        (destdir) =>
            context.run('meson', ['install', '-C', buildPath], {
                cwd: sourcePath,
                env: { ...context.buildEnvironment, DESTDIR: destdir },
            }),
        [
            { source: '/etc/fonts', destination: path.join('etc', 'fonts') },
            {
                source: '/usr/share/fontconfig',
                destination: path.join('share', 'fontconfig'),
            },
            {
                source: '/usr/share/xml/fontconfig',
                destination: path.join('share', 'xml', 'fontconfig'),
            },
            {
                source: '/var/cache/fontconfig',
                destination: path.join('var', 'cache', 'fontconfig'),
            },
        ]
    );
}

function cmakeInstall(packageId, recipe, context) {
    const sourcePath = sourcePathFor(packageId, context.sourceRoot);
    const buildPath = path.join(sourcePath, 'build-iptvnator');
    fs.rmSync(buildPath, { recursive: true, force: true });
    context.run('cmake', [
        '-S',
        sourcePath,
        '-B',
        buildPath,
        '-G',
        'Ninja',
        `-DCMAKE_INSTALL_PREFIX=${context.prefix}`,
        '-DCMAKE_INSTALL_LIBDIR=lib',
        '-DCMAKE_BUILD_TYPE=Release',
        '-DBUILD_SHARED_LIBS=ON',
        ...recipe.args,
    ]);
    context.run('cmake', [
        '--build',
        buildPath,
        '--parallel',
        context.parallelism,
    ]);
    context.run('cmake', ['--install', buildPath]);
}

function opensslInstall(recipe, context) {
    const sourcePath = sourcePathFor('openssl', context.sourceRoot);
    context.run(
        'perl',
        [
            './Configure',
            'linux-x86_64',
            `--prefix=${context.prefix}`,
            '--libdir=lib',
            ...recipe.args,
        ],
        { cwd: sourcePath }
    );
    context.run('make', [`-j${context.parallelism}`], { cwd: sourcePath });
    installWithDestdir('openssl', context, (destdir) =>
        context.run('make', ['install_sw', `DESTDIR=${destdir}`], {
            cwd: sourcePath,
        })
    );
}

function ffmpegInstall(recipe, context) {
    const sourcePath = sourcePathFor('ffmpeg', context.sourceRoot);
    const configureFlags = [`--prefix=${context.prefix}`, ...recipe.args];
    context.run('./configure', configureFlags, { cwd: sourcePath });
    context.run('make', [`-j${context.parallelism}`], { cwd: sourcePath });
    context.run('make', ['install'], { cwd: sourcePath });
    context.ffmpegConfigureFlags = configureFlags;
}

function buildRuntime(context) {
    for (const packageId of BUILD_ORDER) {
        const recipe = BUILD_RECIPES[packageId];
        log(`Building ${packageId} as shared libraries`);
        if (packageId === 'fontconfig') {
            fontconfigInstall(recipe, context);
            continue;
        }
        switch (recipe.buildSystem) {
            case 'data':
                prepareHwdata(context);
                break;
            case 'configure':
                configureInstall(packageId, recipe, context);
                break;
            case 'meson':
                mesonInstall(packageId, recipe, context);
                break;
            case 'cmake':
                cmakeInstall(packageId, recipe, context);
                break;
            case 'openssl':
                opensslInstall(recipe, context);
                break;
            case 'ffmpeg':
                ffmpegInstall(recipe, context);
                break;
            default:
                throw new Error(
                    `Unsupported build system ${recipe.buildSystem} for ${packageId}.`
                );
        }
    }
}

function removeFilesMatching(root, pattern) {
    if (!fs.existsSync(root)) {
        return;
    }
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const entryPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            removeFilesMatching(entryPath, pattern);
        } else if (entry.isFile() && pattern.test(entry.name)) {
            fs.rmSync(entryPath);
        }
    }
}

function removeNonRuntimeBuildOutputs(prefix) {
    removeFilesMatching(path.join(prefix, 'lib'), /\.(?:a|la)$/);
    for (const relativePath of [
        'bin',
        path.join('share', 'doc'),
        path.join('share', 'gtk-doc'),
        path.join('share', 'man'),
    ]) {
        fs.rmSync(path.join(prefix, relativePath), {
            recursive: true,
            force: true,
        });
    }
}

function assertElfLibrary(libraryPath) {
    const descriptor = fs.openSync(libraryPath, 'r');
    try {
        const header = Buffer.alloc(4);
        const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
        if (
            bytesRead !== 4 ||
            !header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
        ) {
            throw new Error(
                `Runtime shared library is not an ELF file: ${libraryPath}.`
            );
        }
    } finally {
        fs.closeSync(descriptor);
    }
}

function postProcessRuntime(context) {
    const libDir = path.join(context.prefix, 'lib');
    if (!fs.existsSync(libDir)) {
        throw new Error(`Runtime library directory was not built: ${libDir}.`);
    }

    const unprunedDynamicEntries = runtimeLibraryNames(libDir).map(
        (libraryName) => {
            const libraryPath = path.join(libDir, libraryName);
            assertElfLibrary(libraryPath);
            return {
                name: libraryName,
                ...parseReadelfDynamic(
                    context.runCapture('readelf', ['-d', libraryPath])
                ),
            };
        }
    );
    const retainedNames = selectReachableRuntimeLibraryNames(
        unprunedDynamicEntries
    );
    retainRuntimeLibraries(libDir, retainedNames);

    const abiRecords = [];
    const dynamicEntries = [];
    for (const libraryName of runtimeLibraryNames(libDir)) {
        const libraryPath = path.join(libDir, libraryName);
        assertElfLibrary(libraryPath);
        context.run('patchelf', ['--set-rpath', '$ORIGIN', libraryPath]);
        const dynamic = parseReadelfDynamic(
            context.runCapture('readelf', ['-d', libraryPath])
        );
        dynamicEntries.push({ name: libraryName, ...dynamic });
        const versionInfo = context.runCapture('readelf', [
            '--version-info',
            libraryPath,
        ]);
        abiRecords.push(parseReadelfVersionInfo(versionInfo, libraryName));
    }
    assertPortableAbiRecords(abiRecords);

    const runtimeFiles = createRuntimeFileRecords(libDir);
    if (runtimeFiles.length === 0) {
        throw new Error(
            'The Linux runtime build produced no shared libraries.'
        );
    }
    const dependencyClosure = validateRuntimeDependencyClosure({
        entries: dynamicEntries,
        runtimeFileNames: runtimeFiles.map(({ name }) => name),
        buildPrefix: context.prefix,
    });

    return {
        abiBaseline: PORTABLE_ABI_BASELINE,
        abiRecords,
        dependencyClosure,
        runtimeFiles,
    };
}

function firstLine(value) {
    return (
        value
            .split(/\r?\n/)
            .find((line) => line.trim())
            ?.trim() ?? ''
    );
}

function collectBuildHost(context) {
    const tools = context.toolVersions;
    if (!tools) {
        throw new Error('Linux runtime tool versions were not preflighted.');
    }
    return {
        platform: process.platform,
        arch: process.arch,
        release: os.release(),
        glibcVersion: context.glibcVersion,
        systemPkgConfigDirs: [...context.systemPkgConfigDirs],
        systemPkgConfigPackages: {
            ...context.systemPkgConfigPackages,
        },
        tools: { ...tools },
    };
}

function detectBuildHostGlibcVersion() {
    const glibcVersion =
        process.report?.getReport?.()?.header?.glibcVersionRuntime;
    assertPortableBuildHostGlibc(glibcVersion);
    return glibcVersion;
}

function collectToolVersions(context) {
    const versionArgs = {
        cc: ['--version'],
        cmake: ['--version'],
        curl: ['--version'],
        git: ['--version'],
        gperf: ['--version'],
        make: ['--version'],
        meson: ['--version'],
        nasm: ['-v'],
        ninja: ['--version'],
        patchelf: ['--version'],
        perl: ['-e', 'printf "%vd\\n", $^V'],
        'pkg-config': ['--version'],
        python3: ['--version'],
        readelf: ['--version'],
        tar: ['--version'],
    };
    const toolVersions = {};
    for (const tool of REQUIRED_TOOLS) {
        toolVersions[tool] = firstLine(
            context.runCapture(tool, versionArgs[tool] ?? ['--version'])
        );
    }
    return toolVersions;
}

function verifySystemPkgConfigPackages(context) {
    const systemPkgConfigPackages = {};
    for (const packageName of EXPECTED_SYSTEM_PKG_CONFIG_PACKAGES) {
        context.run('pkg-config', ['--exists', packageName]);
        systemPkgConfigPackages[packageName] = context.runCapture(
            'pkg-config',
            ['--modversion', packageName]
        );
    }
    return systemPkgConfigPackages;
}

function writeManifest(context, sourceRecords, runtimeMetadata) {
    const mpvMesonFlags = mesonSetupArgs(context.prefix, MPV_MESON_FLAGS);
    const manifest = createLinuxRuntimeManifest({
        sourceRecords,
        runtimeFiles: runtimeMetadata.runtimeFiles,
        abiRecords: runtimeMetadata.abiRecords,
        dependencyClosure: runtimeMetadata.dependencyClosure,
        buildHost: collectBuildHost(context),
        ffmpegConfigureFlags: context.ffmpegConfigureFlags,
        mpvMesonFlags,
    });
    const manifestErrors = validateLinuxRuntimeManifest(manifest);
    if (manifestErrors.length > 0) {
        throw new Error(
            [
                'Generated Linux runtime manifest is invalid:',
                ...manifestErrors.map((error) => `- ${error}`),
            ].join('\n')
        );
    }

    const manifestPath = path.join(context.prefix, 'runtime-manifest.json');
    const temporaryManifestPath = `${manifestPath}.tmp`;
    fs.writeFileSync(
        temporaryManifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        { mode: 0o644 }
    );
    fs.renameSync(temporaryManifestPath, manifestPath);
    return manifest;
}

function createBuildContext(prefix, environment) {
    const buildRoot = path.resolve(
        environment.IPTVNATOR_EMBEDDED_MPV_LINUX_BUILD_ROOT ??
            path.join(
                os.tmpdir(),
                'iptvnator-embedded-mpv-runtime',
                'linux-x64'
            )
    );
    assertSafeOutputPrefix(prefix, buildRoot);
    const systemPkgConfigDirs = resolveSystemPkgConfigDirs(environment);
    const buildEnvironment = createBuildEnvironment({
        prefix,
        baseEnv: environment,
        systemPkgConfigDirs,
    });
    const runner = createCommandRunner({ buildEnvironment });
    return {
        ...runner,
        prefix,
        buildRoot,
        archiveRoot: path.join(buildRoot, 'archives'),
        sourceRoot: path.join(buildRoot, 'sources'),
        parallelism: resolveParallelism(environment),
        systemPkgConfigDirs,
        buildEnvironment,
        ffmpegConfigureFlags: null,
    };
}

export function main({
    argv = process.argv.slice(2),
    platform = process.platform,
    arch = process.arch,
    cwd = process.cwd(),
    environment = process.env,
} = {}) {
    const { prefix: outputPrefix } = parseCliInvocation({
        platform,
        arch,
        argv,
        cwd,
    });
    assertUniqueMesonOptionAssignments(BUILD_RECIPES);
    ensureTools();
    assertOwnedOutputDestination(outputPrefix);
    const stagingToken = `${process.pid}-${crypto
        .randomBytes(8)
        .toString('hex')}`;
    const stagingPrefix = ownedStagingPrefixPath(outputPrefix, stagingToken);
    const context = createBuildContext(stagingPrefix, environment);
    assertSafeOutputPrefix(outputPrefix, context.buildRoot);
    const toolVersions = collectToolVersions(context);
    assertMinimumToolVersions(toolVersions);
    context.toolVersions = toolVersions;
    context.glibcVersion = detectBuildHostGlibcVersion();
    context.systemPkgConfigPackages = verifySystemPkgConfigPackages(context);
    fs.mkdirSync(context.buildRoot, { recursive: true });
    let stagingCreated = false;
    try {
        const createdStagingPrefix = createOwnedStagingPrefix(outputPrefix, {
            token: stagingToken,
        });
        if (createdStagingPrefix !== stagingPrefix) {
            throw new Error(
                'Linux runtime staging prefix changed unexpectedly.'
            );
        }
        stagingCreated = true;
        const sourceRecords = acquireSources(context);
        buildRuntime(context);
        removeNonRuntimeBuildOutputs(context.prefix);
        const runtimeMetadata = postProcessRuntime(context);
        const manifest = writeManifest(context, sourceRecords, runtimeMetadata);
        publishOwnedOutput({
            outputPrefix,
            stagingPrefix,
        });
        stagingCreated = false;
        log(
            `Built ${manifest.runtimeFiles.length} LGPL-compatible runtime libraries (${manifest.runtimeTotalBytes} bytes) at ${outputPrefix}`
        );
    } finally {
        if (stagingCreated) {
            fs.rmSync(stagingPrefix, { recursive: true, force: true });
        }
    }
}

const invokedScriptPath = process.argv[1]
    ? path.resolve(process.argv[1])
    : undefined;
if (invokedScriptPath === scriptPath) {
    try {
        main();
    } catch (error) {
        process.stderr.write(
            `${error instanceof Error ? error.message : String(error)}\n`
        );
        process.exitCode = 1;
    }
}
