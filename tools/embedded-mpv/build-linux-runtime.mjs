#!/usr/bin/env node

import fs from 'node:fs';
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
    REQUIRED_TOOLS,
    SOURCE_PACKAGES,
    assertArchiveMatchesPin,
    assertGitCommitMatchesPin,
    createBuildEnvironment,
    createLinuxRuntimeManifest,
    createRuntimeFileRecords,
    materializeLibrarySymlinks,
    parseCliInvocation,
    parseReadelfDynamic,
    resolveSystemPkgConfigDirs,
    runtimeLibraryNames,
    sha256Buffer,
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
        sourceSubmodules: submoduleOutput
            ? submoduleOutput
                  .split(/\r?\n/)
                  .map((line) => line.trim())
                  .filter(Boolean)
            : [],
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
    context.run('meson', ['install', '-C', buildPath], { cwd: sourcePath });
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
            `--openssldir=${path.join(context.prefix, 'etc', 'ssl')}`,
            '--libdir=lib',
            ...recipe.args,
        ],
        { cwd: sourcePath }
    );
    context.run('make', [`-j${context.parallelism}`], { cwd: sourcePath });
    context.run('make', ['install_sw'], { cwd: sourcePath });
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
        switch (recipe.buildSystem) {
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
    materializeLibrarySymlinks(libDir);

    const dynamicEntries = [];
    for (const libraryName of runtimeLibraryNames(libDir)) {
        const libraryPath = path.join(libDir, libraryName);
        assertElfLibrary(libraryPath);
        context.run('patchelf', ['--set-rpath', '$ORIGIN', libraryPath]);
        const dynamic = parseReadelfDynamic(
            context.runCapture('readelf', ['-d', libraryPath])
        );
        dynamicEntries.push({ name: libraryName, ...dynamic });
    }

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

    return { dependencyClosure, runtimeFiles };
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
    const versionArgs = {
        cc: ['--version'],
        cmake: ['--version'],
        curl: ['--version'],
        git: ['--version'],
        make: ['--version'],
        meson: ['--version'],
        ninja: ['--version'],
        patchelf: ['--version'],
        perl: ['--version'],
        'pkg-config': ['--version'],
        python3: ['--version'],
        readelf: ['--version'],
        tar: ['--version'],
    };
    const tools = {};
    for (const tool of REQUIRED_TOOLS) {
        tools[tool] = firstLine(
            context.runCapture(tool, versionArgs[tool] ?? ['--version'])
        );
    }
    const systemPkgConfigPackages = {};
    for (const packageName of EXPECTED_SYSTEM_PKG_CONFIG_PACKAGES) {
        systemPkgConfigPackages[packageName] = context.runCapture(
            'pkg-config',
            ['--modversion', packageName]
        );
    }

    return {
        platform: process.platform,
        arch: process.arch,
        release: os.release(),
        systemPkgConfigDirs: [...context.systemPkgConfigDirs],
        systemPkgConfigPackages,
        tools,
    };
}

function verifySystemPkgConfigPackages(context) {
    for (const packageName of EXPECTED_SYSTEM_PKG_CONFIG_PACKAGES) {
        context.run('pkg-config', ['--exists', packageName]);
    }
}

function writeManifest(context, sourceRecords, runtimeMetadata) {
    const mpvMesonFlags = mesonSetupArgs(context.prefix, MPV_MESON_FLAGS);
    const manifest = createLinuxRuntimeManifest({
        sourceRecords,
        runtimeFiles: runtimeMetadata.runtimeFiles,
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
    const { prefix } = parseCliInvocation({ platform, arch, argv, cwd });
    ensureTools();
    const context = createBuildContext(prefix, environment);
    fs.mkdirSync(context.buildRoot, { recursive: true });
    fs.rmSync(context.prefix, { recursive: true, force: true });
    fs.mkdirSync(context.prefix, { recursive: true });
    verifySystemPkgConfigPackages(context);
    const sourceRecords = acquireSources(context);
    buildRuntime(context);
    removeNonRuntimeBuildOutputs(prefix);
    const runtimeMetadata = postProcessRuntime(context);
    const manifest = writeManifest(context, sourceRecords, runtimeMetadata);
    log(
        `Built ${manifest.runtimeFiles.length} LGPL-compatible runtime libraries (${manifest.runtimeTotalBytes} bytes) at ${prefix}`
    );
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
