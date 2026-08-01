#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { downloadPinnedSource } from './download-pinned-source.mjs';

const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
const [arch, rawPrefix] = args;
const validArchitectures = new Set(['arm64', 'x64']);
const macosDeploymentTarget =
    process.env.MACOSX_DEPLOYMENT_TARGET ?? '11.0';
const workspaceRoot = process.cwd();

const sourcePackages = [
    {
        id: 'freetype',
        version: '2.13.3',
        url: 'https://downloads.sourceforge.net/project/freetype/freetype2/2.13.3/freetype-2.13.3.tar.xz',
        mirrors: [
            'https://download.savannah.gnu.org/releases/freetype/freetype-2.13.3.tar.xz',
        ],
        expectedSha256:
            '0550350666d427c74daeb85d5ac7bb353acba5f76956395995311a9c6f063289',
        license: 'FreeType License or GPL-2.0-or-later',
    },
    {
        id: 'fribidi',
        version: '1.0.16',
        url: 'https://github.com/fribidi/fribidi/releases/download/v1.0.16/fribidi-1.0.16.tar.xz',
        expectedSha256:
            '1b1cde5b235d40479e91be2f0e88a309e3214c8ab470ec8a2744d82a5a9ea05c',
        license: 'LGPL-2.1-or-later',
    },
    {
        id: 'harfbuzz',
        version: '8.5.0',
        url: 'https://github.com/harfbuzz/harfbuzz/releases/download/8.5.0/harfbuzz-8.5.0.tar.xz',
        expectedSha256:
            '77e4f7f98f3d86bf8788b53e6832fb96279956e1c3961988ea3d4b7ca41ddc27',
        license: 'MIT',
    },
    {
        id: 'libass',
        version: '0.17.3',
        url: 'https://github.com/libass/libass/releases/download/0.17.3/libass-0.17.3.tar.xz',
        expectedSha256:
            'eae425da50f0015c21f7b3a9c7262a910f0218af469e22e2931462fed3c50959',
        license: 'ISC',
    },
    {
        id: 'ffmpeg',
        version: '8.1',
        url: 'https://ffmpeg.org/releases/ffmpeg-8.1.tar.xz',
        expectedSha256:
            'b072aed6871998cce9b36e7774033105ca29e33632be5b6347f3206898e0756a',
        license: 'LGPL-compatible configuration',
    },
    {
        id: 'libplacebo',
        version: '7.360.1',
        tag: 'v7.360.1',
        gitUrl: 'https://github.com/haasn/libplacebo.git',
        license: 'LGPL-2.1-or-later',
    },
    {
        id: 'mpv',
        version: '0.41.0',
        url: 'https://github.com/mpv-player/mpv/archive/refs/tags/v0.41.0.tar.gz',
        expectedSha256:
            'ee21092a5ee427353392360929dc64645c54479aefdb5babc5cfbb5fad626209',
        license: 'LGPL-compatible configuration with -Dgpl=false',
    },
];

if (process.platform !== 'darwin') {
    console.error('Embedded MPV runtime builds are supported on macOS only.');
    process.exit(1);
}

if (!validArchitectures.has(arch) || !rawPrefix) {
    console.error(
        [
            'Usage: node tools/embedded-mpv/build-macos-runtime.mjs <arm64|x64> <output-prefix>',
            '',
            'Builds a pinned LGPL-compatible macOS libmpv runtime from source.',
        ].join('\n')
    );
    process.exit(1);
}

const prefix = path.resolve(rawPrefix);
const buildRoot = path.resolve(
    process.env.IPTVNATOR_EMBEDDED_MPV_BUILD_ROOT ??
        path.join(os.tmpdir(), 'iptvnator-embedded-mpv-runtime', arch)
);
const archiveRoot = path.join(buildRoot, 'archives');
const sourceRoot = path.join(buildRoot, 'sources');
const packageById = new Map(sourcePackages.map((source) => [source.id, source]));
const parallelism =
    process.env.MAKEFLAGS?.match(/-j\s*(\d+)/)?.[1] ??
    String(os.cpus().length);

const ffmpegConfigureFlags = [
    `--prefix=${prefix}`,
    '--enable-shared',
    '--disable-static',
    '--disable-doc',
    '--disable-debug',
    '--disable-programs',
    '--disable-autodetect',
    '--disable-gpl',
    '--disable-nonfree',
    '--enable-pic',
    '--enable-securetransport',
    '--enable-audiotoolbox',
    '--enable-videotoolbox',
];

const mpvMesonFlags = [
    '-Dgpl=false',
    '-Dlibmpv=true',
    '-Dcplayer=false',
    '-Dbuild-date=false',
    '-Dtests=false',
    '-Dlua=disabled',
    '-Djavascript=disabled',
    '-Dcplugins=disabled',
    '-Dmanpage-build=disabled',
    '-Dhtml-build=disabled',
    '-Dpdf-build=disabled',
    '-Dlibarchive=disabled',
    '-Dlibbluray=disabled',
    '-Ddvdnav=disabled',
    '-Dcdda=disabled',
    '-Ddvbin=disabled',
    '-Djpeg=disabled',
    '-Dlcms2=disabled',
    '-Drubberband=disabled',
    '-Duchardet=disabled',
    '-Dzimg=disabled',
    '-Dvulkan=disabled',
    '-Dshaderc=disabled',
    '-Dspirv-cross=disabled',
    '-Dcocoa=disabled',
    '-Dgl-cocoa=disabled',
    '-Dmacos-cocoa-cb=disabled',
    '-Dswift-build=disabled',
    '-Dplain-gl=enabled',
];

function log(message) {
    process.stdout.write(`[embedded-mpv-runtime] ${message}\n`);
}

function run(command, commandArgs, options = {}) {
    log(`${command} ${commandArgs.join(' ')}`);
    const result = spawnSync(command, commandArgs, {
        cwd: options.cwd ?? workspaceRoot,
        env: options.env ?? buildEnv(),
        stdio: 'inherit',
        ...options,
    });

    if (result.status !== 0) {
        throw new Error(
            `${command} ${commandArgs.join(' ')} failed with status ${
                result.status ?? 1
            }.`
        );
    }
}

function commandExists(command) {
    const result = spawnSync('sh', ['-lc', `command -v ${command}`], {
        stdio: 'ignore',
    });
    return result.status === 0;
}

function buildEnv() {
    const pkgConfigDirs = [
        path.join(prefix, 'lib', 'pkgconfig'),
        path.join(prefix, 'share', 'pkgconfig'),
    ].join(path.delimiter);

    return {
        ...process.env,
        PATH: [path.join(prefix, 'bin'), process.env.PATH]
            .filter(Boolean)
            .join(path.delimiter),
        PKG_CONFIG_PATH: pkgConfigDirs,
        PKG_CONFIG_LIBDIR: pkgConfigDirs,
        CMAKE_PREFIX_PATH: prefix,
        DYLD_LIBRARY_PATH: path.join(prefix, 'lib'),
        MACOSX_DEPLOYMENT_TARGET: macosDeploymentTarget,
        CFLAGS: [`-I${path.join(prefix, 'include')}`, process.env.CFLAGS]
            .filter(Boolean)
            .join(' '),
        LDFLAGS: [`-L${path.join(prefix, 'lib')}`, process.env.LDFLAGS]
            .filter(Boolean)
            .join(' '),
    };
}

function ensureTools() {
    const requiredCommands = [
        'curl',
        'tar',
        'make',
        'meson',
        'ninja',
        'pkg-config',
        'git',
    ];
    const missing = requiredCommands.filter((command) => !commandExists(command));

    if (missing.length > 0) {
        throw new Error(`Missing required build tools: ${missing.join(', ')}`);
    }
}

function archivePathFor(sourcePackage) {
    const extension = sourcePackage.url.endsWith('.tar.xz')
        ? '.tar.xz'
        : '.tar.gz';
    return path.join(
        archiveRoot,
        `${sourcePackage.id}-${sourcePackage.version}${extension}`
    );
}

function sourcePathFor(packageId) {
    return path.join(sourceRoot, packageId);
}

function runCapture(command, commandArgs, options = {}) {
    const result = spawnSync(command, commandArgs, {
        cwd: options.cwd ?? workspaceRoot,
        env: options.env ?? buildEnv(),
        encoding: 'utf8',
        stdio: 'pipe',
        ...options,
    });

    if (result.status !== 0) {
        const stderr = result.stderr ? `\n${result.stderr}` : '';
        throw new Error(
            `${command} ${commandArgs.join(' ')} failed with status ${
                result.status ?? 1
            }.${stderr}`
        );
    }

    return result.stdout.trim();
}

function cloneGitSource(sourcePackage) {
    const packageSourcePath = sourcePathFor(sourcePackage.id);
    fs.rmSync(packageSourcePath, { recursive: true, force: true });

    run('git', [
        'clone',
        '--depth',
        '1',
        '--branch',
        sourcePackage.tag,
        sourcePackage.gitUrl,
        packageSourcePath,
    ]);
    run(
        'git',
        [
            'submodule',
            'update',
            '--init',
            '--depth',
            '1',
            '3rdparty/glad',
            '3rdparty/jinja',
            '3rdparty/markupsafe',
            '3rdparty/fast_float',
            '3rdparty/Vulkan-Headers',
        ],
        { cwd: packageSourcePath }
    );

    sourcePackage.gitCommit = runCapture('git', ['rev-parse', 'HEAD'], {
        cwd: packageSourcePath,
    });
    sourcePackage.submodules = runCapture(
        'git',
        [
            'submodule',
            'status',
            '3rdparty/glad',
            '3rdparty/jinja',
            '3rdparty/markupsafe',
            '3rdparty/fast_float',
            '3rdparty/Vulkan-Headers',
        ],
        { cwd: packageSourcePath }
    )
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

function downloadSources() {
    fs.mkdirSync(archiveRoot, { recursive: true });
    fs.mkdirSync(sourceRoot, { recursive: true });

    for (const sourcePackage of sourcePackages) {
        if (sourcePackage.gitUrl) {
            cloneGitSource(sourcePackage);
            continue;
        }

        const archivePath = archivePathFor(sourcePackage);
        const { sourceSha256 } = downloadPinnedSource({
            archivePath,
            expectedSha256: sourcePackage.expectedSha256,
            urls: [sourcePackage.url, ...(sourcePackage.mirrors ?? [])],
            download: ({ destinationPath, url }) =>
                run('curl', [
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
                    destinationPath,
                    url,
                ]),
        });

        const packageSourcePath = sourcePathFor(sourcePackage.id);
        fs.rmSync(packageSourcePath, { recursive: true, force: true });
        fs.mkdirSync(packageSourcePath, { recursive: true });
        run('tar', [
            '-xf',
            archivePath,
            '-C',
            packageSourcePath,
            '--strip-components',
            '1',
        ]);
        sourcePackage.sha256 = sourceSha256;
    }
}

function configureMakeInstall(packageId, configureArgs) {
    const packageSourcePath = sourcePathFor(packageId);
    run('./configure', [`--prefix=${prefix}`, ...configureArgs], {
        cwd: packageSourcePath,
    });
    run('make', [`-j${parallelism}`], { cwd: packageSourcePath });
    run('make', ['install'], { cwd: packageSourcePath });
}

function mesonInstall(packageId, mesonArgs) {
    const packageSourcePath = sourcePathFor(packageId);
    const buildDir = path.join(packageSourcePath, 'build-iptvnator');
    fs.rmSync(buildDir, { recursive: true, force: true });
    run(
        'meson',
        [
            'setup',
            buildDir,
            `--prefix=${prefix}`,
            '--libdir=lib',
            '--buildtype=release',
            '--default-library=shared',
            ...mesonArgs,
        ],
        { cwd: packageSourcePath }
    );
    run('meson', ['compile', '-C', buildDir], { cwd: packageSourcePath });
    run('meson', ['install', '-C', buildDir], { cwd: packageSourcePath });
}

function buildRuntime() {
    fs.rmSync(prefix, { recursive: true, force: true });
    fs.mkdirSync(prefix, { recursive: true });

    configureMakeInstall('freetype', ['--enable-shared', '--disable-static']);
    configureMakeInstall('fribidi', ['--enable-shared', '--disable-static']);
    mesonInstall('harfbuzz', [
        '-Dglib=disabled',
        '-Dgobject=disabled',
        '-Dcairo=disabled',
        '-Dchafa=disabled',
        '-Dicu=disabled',
        '-Dfreetype=enabled',
        '-Dtests=disabled',
        '-Dintrospection=disabled',
        '-Ddocs=disabled',
        '-Dutilities=disabled',
        '-Dbenchmark=disabled',
    ]);
    configureMakeInstall('libass', [
        '--enable-shared',
        '--disable-static',
        '--disable-fontconfig',
        '--enable-coretext',
        '--disable-libunibreak',
    ]);

    const ffmpegSourcePath = sourcePathFor('ffmpeg');
    run('./configure', ffmpegConfigureFlags, { cwd: ffmpegSourcePath });
    run('make', [`-j${parallelism}`], { cwd: ffmpegSourcePath });
    run('make', ['install'], { cwd: ffmpegSourcePath });

    mesonInstall('libplacebo', [
        '-Dopengl=enabled',
        '-Dvulkan=disabled',
        '-Dvk-proc-addr=disabled',
        '-Dglslang=disabled',
        '-Dshaderc=disabled',
        '-Dlcms=disabled',
        '-Ddovi=disabled',
        '-Dlibdovi=disabled',
        '-Ddemos=false',
        '-Dtests=false',
        '-Dbench=false',
        '-Dfuzz=false',
        '-Dunwind=disabled',
        '-Dxxhash=disabled',
    ]);
    mesonInstall('mpv', mpvMesonFlags);
}

function listDylibs(directoryPath) {
    if (!fs.existsSync(directoryPath)) {
        return [];
    }

    return fs
        .readdirSync(directoryPath, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.dylib'))
        .map((entry) => path.join(directoryPath, entry.name))
        .sort();
}

function validateRuntimeLinks() {
    if (!commandExists('otool')) {
        log('Skipping otool validation because otool is unavailable.');
        return;
    }

    const libDir = path.join(prefix, 'lib');
    const errors = [];
    const allowedSystemPrefixes = ['/System/Library/', '/usr/lib/'];
    const forbiddenPrefixes = ['/opt/homebrew/', '/usr/local/'];

    for (const dylibPath of listDylibs(libDir)) {
        const result = spawnSync('otool', ['-L', dylibPath], {
            encoding: 'utf8',
            stdio: 'pipe',
        });
        if (result.status !== 0) {
            errors.push(`Unable to inspect ${dylibPath}: ${result.stderr}`);
            continue;
        }

        for (const dependencyPath of result.stdout
            .split(/\r?\n/)
            .slice(1)
            .map((line) => line.trim().split(/\s+\(/)[0])
            .filter(Boolean)) {
            if (
                allowedSystemPrefixes.some((prefixValue) =>
                    dependencyPath.startsWith(prefixValue)
                ) ||
                dependencyPath.startsWith('@loader_path/') ||
                dependencyPath.startsWith('@rpath/') ||
                dependencyPath.startsWith(prefix)
            ) {
                continue;
            }

            if (
                forbiddenPrefixes.some((prefixValue) =>
                    dependencyPath.startsWith(prefixValue)
                )
            ) {
                errors.push(`${dylibPath} links to forbidden ${dependencyPath}`);
                continue;
            }

            if (path.isAbsolute(dependencyPath)) {
                errors.push(`${dylibPath} links to external ${dependencyPath}`);
            }
        }
    }

    if (errors.length > 0) {
        throw new Error(
            ['Embedded MPV runtime link validation failed.', ...errors].join('\n')
        );
    }
}

function sourceMetadata(packageId) {
    const sourcePackage = packageById.get(packageId);
    return {
        version: sourcePackage.version,
        sourceUrl: sourcePackage.url ?? sourcePackage.gitUrl,
        ...(sourcePackage.tag ? { sourceTag: sourcePackage.tag } : {}),
        ...(sourcePackage.sha256
            ? { sourceSha256: sourcePackage.sha256 }
            : {}),
        ...(sourcePackage.gitCommit
            ? { sourceGitCommit: sourcePackage.gitCommit }
            : {}),
        ...(sourcePackage.submodules
            ? { sourceSubmodules: sourcePackage.submodules }
            : {}),
        license: sourcePackage.license,
    };
}

function writeManifest() {
    const manifest = {
        origin: 'vendored-lgpl-source-build',
        arch,
        generatedAt: new Date().toISOString(),
        macosDeploymentTarget,
        buildHost: {
            platform: process.platform,
            arch: process.arch,
        },
        packages: Object.fromEntries(
            sourcePackages.map((sourcePackage) => [
                sourcePackage.id,
                {
                    version: sourcePackage.version,
                    sourceUrl: sourcePackage.url ?? sourcePackage.gitUrl,
                    ...(sourcePackage.tag
                        ? { sourceTag: sourcePackage.tag }
                        : {}),
                    ...(sourcePackage.sha256
                        ? { sourceSha256: sourcePackage.sha256 }
                        : {}),
                    ...(sourcePackage.gitCommit
                        ? { sourceGitCommit: sourcePackage.gitCommit }
                        : {}),
                    ...(sourcePackage.submodules
                        ? { sourceSubmodules: sourcePackage.submodules }
                        : {}),
                    license: sourcePackage.license,
                },
            ])
        ),
        ffmpeg: {
            ...sourceMetadata('ffmpeg'),
            licensePolicy: 'LGPL, built without --enable-gpl and --enable-nonfree',
            configureFlags: ffmpegConfigureFlags,
        },
        mpv: {
            ...sourceMetadata('mpv'),
            licensePolicy:
                'LGPL-compatible libmpv, built with -Dlibmpv=true -Dgpl=false',
            mesonFlags: mpvMesonFlags,
        },
        sourceDistribution:
            'Attach the downloaded source archives, the libplacebo git checkout metadata, this manifest, and any local patches with the macOS binary release.',
    };

    fs.writeFileSync(
        path.join(prefix, 'runtime-manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`
    );
}

try {
    ensureTools();
    fs.mkdirSync(buildRoot, { recursive: true });
    downloadSources();
    buildRuntime();
    validateRuntimeLinks();
    writeManifest();
    log(`Built LGPL-compatible runtime prefix at ${prefix}`);
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}
