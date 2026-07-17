'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_PACKAGES = Object.freeze(
    [
        {
            id: 'freetype',
            version: '2.13.3',
            sourceKind: 'archive',
            sourceUrl:
                'https://download.savannah.gnu.org/releases/freetype/freetype-2.13.3.tar.xz',
            license: 'FreeType License (FTL)',
        },
        {
            id: 'fribidi',
            version: '1.0.16',
            sourceKind: 'archive',
            sourceUrl:
                'https://github.com/fribidi/fribidi/releases/download/v1.0.16/fribidi-1.0.16.tar.xz',
            license: 'LGPL-2.1-or-later',
        },
        {
            id: 'harfbuzz',
            version: '8.5.0',
            sourceKind: 'archive',
            sourceUrl:
                'https://github.com/harfbuzz/harfbuzz/releases/download/8.5.0/harfbuzz-8.5.0.tar.xz',
            license: 'MIT',
        },
        {
            id: 'expat',
            version: '2.8.2',
            sourceKind: 'archive',
            sourceUrl:
                'https://github.com/libexpat/libexpat/releases/download/R_2_8_2/expat-2.8.2.tar.xz',
            license: 'MIT',
        },
        {
            id: 'fontconfig',
            version: '2.16.0',
            sourceKind: 'archive',
            sourceUrl:
                'https://www.freedesktop.org/software/fontconfig/release/fontconfig-2.16.0.tar.xz',
            license: 'MIT',
        },
        {
            id: 'libass',
            version: '0.17.3',
            sourceKind: 'archive',
            sourceUrl:
                'https://github.com/libass/libass/releases/download/0.17.3/libass-0.17.3.tar.xz',
            license: 'ISC',
        },
        {
            id: 'openssl',
            version: '3.5.7',
            sourceKind: 'archive',
            sourceUrl:
                'https://github.com/openssl/openssl/releases/download/openssl-3.5.7/openssl-3.5.7.tar.gz',
            license: 'Apache-2.0',
        },
        {
            id: 'ffmpeg',
            version: '8.1',
            sourceKind: 'archive',
            sourceUrl: 'https://ffmpeg.org/releases/ffmpeg-8.1.tar.xz',
            license: 'LGPL-2.1-or-later',
        },
        {
            id: 'libplacebo',
            version: '7.360.1',
            sourceKind: 'git',
            sourceUrl: 'https://github.com/haasn/libplacebo.git',
            sourceTag: 'v7.360.1',
            license: 'LGPL-2.1-or-later',
        },
        {
            id: 'mpv',
            version: '0.41.0',
            sourceKind: 'archive',
            sourceUrl:
                'https://github.com/mpv-player/mpv/archive/refs/tags/v0.41.0.tar.gz',
            license: 'LGPL-2.1-or-later with -Dgpl=false',
        },
    ].map((sourcePackage) => Object.freeze(sourcePackage))
);

const BUILD_ORDER = Object.freeze(
    SOURCE_PACKAGES.map((sourcePackage) => sourcePackage.id)
);

const FFMPEG_CONFIGURE_FLAGS = Object.freeze([
    '--enable-shared',
    '--disable-static',
    '--disable-programs',
    '--disable-doc',
    '--disable-debug',
    '--disable-autodetect',
    '--disable-gpl',
    '--disable-nonfree',
    '--disable-version3',
    '--enable-pic',
    '--enable-pthreads',
    '--enable-openssl',
    '--disable-gnutls',
    '--disable-mbedtls',
    '--disable-libtls',
    '--enable-network',
    '--disable-protocols',
    '--enable-protocol=file',
    '--enable-protocol=http',
    '--enable-protocol=https',
    '--enable-protocol=httpproxy',
    '--enable-protocol=tcp',
    '--enable-protocol=tls',
    '--enable-protocol=udp',
    '--enable-protocol=crypto',
    '--enable-protocol=data',
    '--enable-demuxer=hls',
    '--enable-vaapi',
    '--disable-vdpau',
    '--disable-vulkan',
    '--disable-libdrm',
    '--disable-cuda-llvm',
    '--disable-cuvid',
    '--disable-nvdec',
    '--disable-nvenc',
    '--disable-xlib',
    '--disable-sdl2',
    '--disable-openal',
]);

const MPV_MESON_FLAGS = Object.freeze([
    '-Dgpl=false',
    '-Dlibmpv=true',
    '-Dcplayer=false',
    '-Dbuild-date=false',
    '-Dtests=false',
    '-Dfuzzers=false',
    '-Ddisable-packet-pool=false',
    '-Dcdda=disabled',
    '-Dcplugins=disabled',
    '-Ddvbin=disabled',
    '-Ddvdnav=disabled',
    '-Diconv=enabled',
    '-Djavascript=disabled',
    '-Djpeg=disabled',
    '-Dlcms2=disabled',
    '-Dlibarchive=disabled',
    '-Dlibavdevice=disabled',
    '-Dlibbluray=disabled',
    '-Dlua=disabled',
    '-Dpthread-debug=disabled',
    '-Drubberband=disabled',
    '-Dsdl2-gamepad=disabled',
    '-Duchardet=disabled',
    '-Duwp=disabled',
    '-Dvapoursynth=disabled',
    '-Dvector=enabled',
    '-Dwin32-threads=disabled',
    '-Dx11-clipboard=disabled',
    '-Dzimg=disabled',
    '-Dzlib=disabled',
    '-Dalsa=enabled',
    '-Daudiounit=disabled',
    '-Dcoreaudio=disabled',
    '-Davfoundation=disabled',
    '-Djack=disabled',
    '-Dopenal=disabled',
    '-Daudiotrack=disabled',
    '-Daaudio=disabled',
    '-Dopensles=disabled',
    '-Doss-audio=disabled',
    '-Dpipewire=disabled',
    '-Dpulse=enabled',
    '-Dsdl2-audio=disabled',
    '-Dsndio=disabled',
    '-Dwasapi=disabled',
    '-Dcaca=disabled',
    '-Dcocoa=disabled',
    '-Dd3d11=disabled',
    '-Ddirect3d=disabled',
    '-Ddmabuf-wayland=disabled',
    '-Ddrm=disabled',
    '-Degl=enabled',
    '-Degl-android=disabled',
    '-Degl-angle=disabled',
    '-Degl-angle-lib=disabled',
    '-Degl-angle-win32=disabled',
    '-Degl-drm=disabled',
    '-Degl-wayland=disabled',
    '-Degl-x11=disabled',
    '-Dgbm=enabled',
    '-Dgl=enabled',
    '-Dgl-cocoa=disabled',
    '-Dgl-dxinterop=disabled',
    '-Dgl-win32=disabled',
    '-Dgl-x11=disabled',
    '-Dsdl2-video=disabled',
    '-Dshaderc=disabled',
    '-Dsixel=disabled',
    '-Dspirv-cross=disabled',
    '-Dplain-gl=enabled',
    '-Dvdpau=disabled',
    '-Dvdpau-gl-x11=disabled',
    '-Dvaapi=enabled',
    '-Dvaapi-drm=enabled',
    '-Dvaapi-wayland=disabled',
    '-Dvaapi-win32=disabled',
    '-Dvaapi-x11=disabled',
    '-Dvulkan=disabled',
    '-Dwayland=disabled',
    '-Dx11=disabled',
    '-Dxv=disabled',
    '-Dandroid-media-ndk=disabled',
    '-Dcuda-hwaccel=disabled',
    '-Dcuda-interop=disabled',
    '-Dd3d-hwaccel=disabled',
    '-Dd3d9-hwaccel=disabled',
    '-Dgl-dxinterop-d3d9=disabled',
    '-Dios-gl=disabled',
    '-Dvideotoolbox-gl=disabled',
    '-Dvideotoolbox-pl=disabled',
    '-Dmacos-10-15-4-features=disabled',
    '-Dmacos-11-features=disabled',
    '-Dmacos-11-3-features=disabled',
    '-Dmacos-12-features=disabled',
    '-Dmacos-cocoa-cb=disabled',
    '-Dmacos-media-player=disabled',
    '-Dmacos-touchbar=disabled',
    '-Dswift-build=disabled',
    '-Dwin32-smtc=disabled',
    '-Dhtml-build=disabled',
    '-Dmanpage-build=disabled',
    '-Dpdf-build=disabled',
]);

const BUILD_RECIPES = Object.freeze({
    freetype: Object.freeze({
        buildSystem: 'configure',
        sharedOnly: true,
        args: Object.freeze([
            '--enable-shared',
            '--disable-static',
            '--without-brotli',
            '--without-bzip2',
            '--without-harfbuzz',
            '--without-png',
            '--without-zlib',
        ]),
    }),
    fribidi: Object.freeze({
        buildSystem: 'configure',
        sharedOnly: true,
        args: Object.freeze([
            '--enable-shared',
            '--disable-static',
            '--disable-docs',
            '--disable-bin',
        ]),
    }),
    harfbuzz: Object.freeze({
        buildSystem: 'meson',
        sharedOnly: true,
        args: Object.freeze([
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
        ]),
    }),
    expat: Object.freeze({
        buildSystem: 'cmake',
        sharedOnly: true,
        args: Object.freeze([
            '-DEXPAT_SHARED_LIBS=ON',
            '-DEXPAT_BUILD_TOOLS=OFF',
            '-DEXPAT_BUILD_EXAMPLES=OFF',
            '-DEXPAT_BUILD_TESTS=OFF',
            '-DEXPAT_BUILD_DOCS=OFF',
        ]),
    }),
    fontconfig: Object.freeze({
        buildSystem: 'meson',
        sharedOnly: true,
        args: Object.freeze([
            '-Ddoc=disabled',
            '-Dtests=disabled',
            '-Dtools=disabled',
            '-Dcache-build=disabled',
            '-Dnls=disabled',
        ]),
    }),
    libass: Object.freeze({
        buildSystem: 'configure',
        sharedOnly: true,
        args: Object.freeze([
            '--enable-shared',
            '--disable-static',
            '--enable-fontconfig',
            '--disable-coretext',
            '--disable-directwrite',
            '--disable-libunibreak',
        ]),
    }),
    openssl: Object.freeze({
        buildSystem: 'openssl',
        sharedOnly: true,
        args: Object.freeze([
            'shared',
            'no-apps',
            'no-docs',
            'no-tests',
            'no-engine',
            'no-legacy',
            'no-module',
            'no-weak-ssl-ciphers',
        ]),
    }),
    ffmpeg: Object.freeze({
        buildSystem: 'ffmpeg',
        sharedOnly: true,
        args: FFMPEG_CONFIGURE_FLAGS,
    }),
    libplacebo: Object.freeze({
        buildSystem: 'meson',
        sharedOnly: true,
        args: Object.freeze([
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
        ]),
    }),
    mpv: Object.freeze({
        buildSystem: 'meson',
        sharedOnly: true,
        args: MPV_MESON_FLAGS,
    }),
});

const REQUIRED_TOOLS = Object.freeze([
    'cc',
    'cmake',
    'curl',
    'git',
    'make',
    'meson',
    'ninja',
    'patchelf',
    'perl',
    'pkg-config',
    'python3',
    'readelf',
    'tar',
]);

const GLIBC_TOOLCHAIN_ALLOWLIST = Object.freeze([
    'ld-linux-x86-64.so.2',
    'libc.so.6',
    'libdl.so.2',
    'libgcc_s.so.1',
    'libm.so.6',
    'libpthread.so.0',
    'librt.so.1',
    'libstdc++.so.6',
]);

const EXTERNAL_SYSTEM_LIBRARIES = Object.freeze(
    [
        {
            name: 'libEGL.so.1',
            interface: 'EGL',
            reason: 'System graphics-driver interface used by the frame-copy helper.',
        },
        {
            name: 'libGL.so.1',
            interface: 'OpenGL',
            reason: 'System OpenGL compatibility interface supplied by the graphics stack.',
        },
        {
            name: 'libGLX.so.0',
            interface: 'OpenGL',
            reason: 'GLVND OpenGL dispatch interface supplied by the graphics stack.',
        },
        {
            name: 'libOpenGL.so.0',
            interface: 'OpenGL',
            reason: 'GLVND OpenGL interface supplied by the graphics stack.',
        },
        {
            name: 'libasound.so.2',
            interface: 'ALSA',
            reason: 'Linux system audio interface intentionally used by libmpv.',
        },
        {
            name: 'libdrm.so.2',
            interface: 'DRM',
            reason: 'Kernel graphics interface used by system GBM and VA-API drivers.',
        },
        {
            name: 'libgbm.so.1',
            interface: 'GBM',
            reason: 'System graphics-buffer interface used by headless EGL rendering.',
        },
        {
            name: 'libpulse.so.0',
            interface: 'PulseAudio',
            reason: 'Linux desktop audio interface intentionally used by libmpv.',
        },
        {
            name: 'libva-drm.so.2',
            interface: 'VA-API DRM',
            reason: 'System VA-API DRM interface used for hardware decoding.',
        },
        {
            name: 'libva.so.2',
            interface: 'VA-API',
            reason: 'System video-acceleration interface used for hardware decoding.',
        },
    ].map((externalLibrary) => Object.freeze(externalLibrary))
);

const SHARED_LIBRARY_PATTERN = /\.so(?:\.\d+)*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const externalSystemLibraryNames = new Set(
    EXTERNAL_SYSTEM_LIBRARIES.map(({ name }) => name)
);
const allowedExternalLibraryNames = new Set([
    ...GLIBC_TOOLCHAIN_ALLOWLIST,
    ...externalSystemLibraryNames,
]);

function joinEnvironmentParts(parts, separator = ' ') {
    return parts.filter((value) => value && value.trim()).join(separator);
}

function createBuildEnvironment({
    prefix,
    baseEnv = process.env,
    systemPkgConfigDirs = [],
}) {
    const prefixPkgConfigDirs = [
        path.join(prefix, 'lib', 'pkgconfig'),
        path.join(prefix, 'share', 'pkgconfig'),
    ];
    const pkgConfigLibDirs = [
        ...new Set([
            ...prefixPkgConfigDirs,
            ...systemPkgConfigDirs.filter(Boolean),
        ]),
    ];
    const prefixLibDir = path.join(prefix, 'lib');

    return {
        ...baseEnv,
        PATH: joinEnvironmentParts(
            [path.join(prefix, 'bin'), baseEnv.PATH],
            path.delimiter
        ),
        PKG_CONFIG_PATH: prefixPkgConfigDirs.join(path.delimiter),
        PKG_CONFIG_LIBDIR: pkgConfigLibDirs.join(path.delimiter),
        CMAKE_PREFIX_PATH: prefix,
        CPPFLAGS: joinEnvironmentParts([
            `-I${path.join(prefix, 'include')}`,
            baseEnv.CPPFLAGS,
        ]),
        CFLAGS: joinEnvironmentParts([
            '-fPIC',
            `-I${path.join(prefix, 'include')}`,
            baseEnv.CFLAGS,
        ]),
        CXXFLAGS: joinEnvironmentParts([
            '-fPIC',
            `-I${path.join(prefix, 'include')}`,
            baseEnv.CXXFLAGS,
        ]),
        LDFLAGS: joinEnvironmentParts([
            `-L${prefixLibDir}`,
            `-Wl,-rpath-link,${prefixLibDir}`,
            baseEnv.LDFLAGS,
        ]),
        LD_LIBRARY_PATH: joinEnvironmentParts(
            [prefixLibDir, baseEnv.LD_LIBRARY_PATH],
            path.delimiter
        ),
        FONTCONFIG_PATH: path.join(prefix, 'etc', 'fonts'),
        OPENSSL_MODULES: path.join(prefixLibDir, 'ossl-modules'),
    };
}

function sha256Buffer(contents) {
    return crypto.createHash('sha256').update(contents).digest('hex');
}

function runtimeLibraryNames(libDir) {
    return fs
        .readdirSync(libDir, { withFileTypes: true })
        .filter(
            (entry) =>
                (entry.isFile() || entry.isSymbolicLink()) &&
                SHARED_LIBRARY_PATTERN.test(entry.name)
        )
        .map((entry) => entry.name)
        .sort();
}

function assertPathInside(parentPath, candidatePath, label) {
    const relativePath = path.relative(parentPath, candidatePath);
    if (
        relativePath === '..' ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
    ) {
        throw new Error(`${label} resolves outside ${parentPath}.`);
    }
}

function materializeLibrarySymlinks(libDir) {
    const realLibDir = fs.realpathSync(libDir);
    for (const name of runtimeLibraryNames(libDir)) {
        const libraryPath = path.join(libDir, name);
        const stat = fs.lstatSync(libraryPath);
        if (!stat.isSymbolicLink()) {
            continue;
        }

        const realLibraryPath = fs.realpathSync(libraryPath);
        assertPathInside(
            realLibDir,
            realLibraryPath,
            `Runtime library alias ${name}`
        );
        const targetStat = fs.statSync(realLibraryPath);
        if (!targetStat.isFile()) {
            throw new Error(
                `Runtime library alias ${name} does not resolve to a regular file.`
            );
        }
        const contents = fs.readFileSync(realLibraryPath);
        fs.unlinkSync(libraryPath);
        fs.writeFileSync(libraryPath, contents, {
            mode: targetStat.mode & 0o777,
        });
    }
}

function createRuntimeFileRecords(libDir) {
    return runtimeLibraryNames(libDir).map((name) => {
        const libraryPath = path.join(libDir, name);
        const stat = fs.lstatSync(libraryPath);
        if (!stat.isFile() || stat.isSymbolicLink()) {
            throw new Error(
                `Runtime library ${name} must be a materialized regular file.`
            );
        }
        const contents = fs.readFileSync(libraryPath);
        return {
            name,
            size: contents.length,
            sha256: sha256Buffer(contents),
        };
    });
}

function parseReadelfDynamic(output) {
    const dynamic = {
        needed: [],
        rpath: [],
        runpath: [],
    };
    const dynamicEntryPattern = /\((NEEDED|RPATH|RUNPATH)\)[^[]*\[([^\]]*)\]/g;
    for (const match of output.matchAll(dynamicEntryPattern)) {
        const [, tag, value] = match;
        if (tag === 'NEEDED') {
            dynamic.needed.push(value);
            continue;
        }
        const field = tag.toLowerCase();
        dynamic[field].push(
            ...value.split(':').filter((pathEntry) => pathEntry.length > 0)
        );
    }

    for (const field of Object.keys(dynamic)) {
        dynamic[field] = [...new Set(dynamic[field])].sort();
    }
    return dynamic;
}

function validateRuntimeDependencyClosure({
    entries,
    runtimeFileNames,
    buildPrefix,
}) {
    if (!Array.isArray(entries) || !Array.isArray(runtimeFileNames)) {
        throw new TypeError(
            'Runtime closure entries and runtime file names must be arrays.'
        );
    }

    const bundledNames = new Set(runtimeFileNames);
    const entryNames = new Set();
    const externalDependencies = new Set();
    const normalizedEntries = [...entries]
        .map((entry) => ({
            name: entry.name,
            needed: [...new Set(entry.needed ?? [])].sort(),
            rpath: [...new Set(entry.rpath ?? [])].sort(),
            runpath: [...new Set(entry.runpath ?? [])].sort(),
        }))
        .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of normalizedEntries) {
        if (!bundledNames.has(entry.name)) {
            throw new Error(
                `Dynamic closure contains undeclared runtime file ${entry.name}.`
            );
        }
        if (entryNames.has(entry.name)) {
            throw new Error(
                `Dynamic closure contains duplicate runtime file ${entry.name}.`
            );
        }
        entryNames.add(entry.name);

        if (entry.rpath.length > 0) {
            throw new Error(
                `${entry.name} has forbidden RPATH ${entry.rpath.join(':')}.`
            );
        }
        if (entry.runpath.length !== 1 || entry.runpath[0] !== '$ORIGIN') {
            const renderedRunpath =
                entry.runpath.length > 0 ? entry.runpath.join(':') : '<empty>';
            throw new Error(
                `${entry.name} RUNPATH must be exactly $ORIGIN; got ${renderedRunpath}.`
            );
        }
        if (
            buildPrefix &&
            [...entry.rpath, ...entry.runpath].some((value) =>
                value.includes(buildPrefix)
            )
        ) {
            throw new Error(
                `${entry.name} RPATH/RUNPATH contains build prefix ${buildPrefix}.`
            );
        }

        for (const dependencyName of entry.needed) {
            if (bundledNames.has(dependencyName)) {
                continue;
            }
            if (!allowedExternalLibraryNames.has(dependencyName)) {
                throw new Error(
                    `Runtime dependency is not bundled or allowlisted: ${entry.name} -> ${dependencyName}.`
                );
            }
            externalDependencies.add(dependencyName);
        }
    }

    for (const runtimeFileName of bundledNames) {
        if (!entryNames.has(runtimeFileName)) {
            throw new Error(
                `Runtime library ${runtimeFileName} is missing from the dynamic closure.`
            );
        }
    }

    return {
        entries: normalizedEntries,
        externalDependencies: [...externalDependencies].sort(),
    };
}

function parseCliInvocation({ platform, arch, argv, cwd }) {
    if (platform !== 'linux' || arch !== 'x64') {
        throw new Error(
            `Embedded MPV runtime source builds are supported on Linux x64 only; received ${platform}/${arch}.`
        );
    }

    const args = argv[0] === '--' ? argv.slice(1) : argv;
    if (args.length !== 1 || !args[0]) {
        throw new Error(
            [
                'Usage: node tools/embedded-mpv/build-linux-runtime.mjs <output-prefix>',
                '',
                'Builds the pinned LGPL-compatible Linux x64 libmpv runtime from source.',
            ].join('\n')
        );
    }

    return { prefix: path.resolve(cwd, args[0]) };
}

function sourceManifestMetadata(sourceRecord) {
    const metadata = {
        version: sourceRecord.version,
        sourceUrl: sourceRecord.sourceUrl,
        ...(sourceRecord.sourceTag
            ? { sourceTag: sourceRecord.sourceTag }
            : {}),
        ...(sourceRecord.sourceSha256
            ? { sourceSha256: sourceRecord.sourceSha256 }
            : {}),
        ...(sourceRecord.sourceGitCommit
            ? { sourceGitCommit: sourceRecord.sourceGitCommit }
            : {}),
        ...(sourceRecord.sourceSubmodules
            ? { sourceSubmodules: [...sourceRecord.sourceSubmodules] }
            : {}),
        license: sourceRecord.license,
    };

    if (
        sourceRecord.sourceKind === 'archive' &&
        !SHA256_PATTERN.test(sourceRecord.sourceSha256 ?? '')
    ) {
        throw new Error(
            `Archive source ${sourceRecord.id} is missing its downloaded SHA-256 digest.`
        );
    }
    if (
        sourceRecord.sourceKind === 'git' &&
        !/^[a-f0-9]{40,64}$/.test(sourceRecord.sourceGitCommit ?? '')
    ) {
        throw new Error(
            `Git source ${sourceRecord.id} is missing its exact commit digest.`
        );
    }
    return metadata;
}

function createLinuxRuntimeManifest({
    sourceRecords,
    runtimeFiles,
    dependencyClosure,
    buildHost,
    generatedAt = new Date().toISOString(),
    ffmpegConfigureFlags = FFMPEG_CONFIGURE_FLAGS,
    mpvMesonFlags = MPV_MESON_FLAGS,
}) {
    const packages = {};
    for (const sourcePackage of SOURCE_PACKAGES) {
        const sourceRecord = sourceRecords[sourcePackage.id];
        if (!sourceRecord) {
            throw new Error(`Missing source metadata for ${sourcePackage.id}.`);
        }
        packages[sourcePackage.id] = sourceManifestMetadata(sourceRecord);
    }

    const runtimeTotalBytes = runtimeFiles.reduce(
        (total, runtimeFile) => total + runtimeFile.size,
        0
    );
    return {
        schemaVersion: 1,
        origin: 'vendored-lgpl-source-build',
        platform: 'linux',
        arch: 'x64',
        generatedAt,
        packages,
        ffmpeg: {
            ...packages.ffmpeg,
            licensePolicy:
                'LGPL, built with OpenSSL and without GPL, nonfree, or version-3-only components.',
            configureFlags: [...ffmpegConfigureFlags],
        },
        mpv: {
            ...packages.mpv,
            licensePolicy:
                'LGPL-compatible libmpv built with -Dgpl=false and without the CLI player.',
            mesonFlags: [...mpvMesonFlags],
        },
        runtimeFiles: runtimeFiles.map((runtimeFile) => ({ ...runtimeFile })),
        runtimeTotalBytes,
        runtimeDependencyClosure: {
            entries: dependencyClosure.entries.map((entry) => ({
                name: entry.name,
                needed: [...entry.needed],
                rpath: [...entry.rpath],
                runpath: [...entry.runpath],
            })),
            externalDependencies: [...dependencyClosure.externalDependencies],
        },
        externalSystemLibraries: EXTERNAL_SYSTEM_LIBRARIES.map(
            (externalLibrary) => ({ ...externalLibrary })
        ),
        buildHost,
        sourceDistribution:
            'Attach a source archive to the corresponding Linux binary release containing the exact downloaded source archives, a checkout or git bundle of the recorded libplacebo commit and submodules, tools/embedded-mpv/build-linux-runtime.mjs, tools/embedded-mpv/build-linux-runtime.cjs, this runtime manifest, and any local patches.',
    };
}

module.exports = {
    BUILD_RECIPES,
    BUILD_ORDER,
    EXTERNAL_SYSTEM_LIBRARIES,
    FFMPEG_CONFIGURE_FLAGS,
    GLIBC_TOOLCHAIN_ALLOWLIST,
    MPV_MESON_FLAGS,
    REQUIRED_TOOLS,
    SOURCE_PACKAGES,
    createBuildEnvironment,
    createLinuxRuntimeManifest,
    createRuntimeFileRecords,
    materializeLibrarySymlinks,
    parseCliInvocation,
    parseReadelfDynamic,
    runtimeLibraryNames,
    sha256Buffer,
    validateRuntimeDependencyClosure,
};
