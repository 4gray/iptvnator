'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const HWDATA_BUILD_INPUT = Object.freeze({
    consumer: 'libdisplay-info',
    relativePath: 'pnp.ids',
    purpose: 'PNP vendor lookup table compiled into libdisplay-info.',
});
const EXPECTED_LIBPLACEBO_V7_360_1_SOURCE_SUBMODULES = Object.freeze([
    '450bd2232225d6c7728a4108055ac2e37cef6475 3rdparty/Vulkan-Headers (v1.4.337)',
    '97b54ca9e75f5303507699d27c6b4f4efe4641a1 3rdparty/fast_float (v6.1.0-275-g97b54ca)',
    '73db193f853e2ee079bf3ca8a64aa2eaf6459043 3rdparty/glad (v0.1.11a-302-g73db193)',
    '15206881c006c79667fe5154fe80c01c65410679 3rdparty/jinja (3.1.6)',
    '297fc8e356e6836a62087949245d09a28e9f1b13 3rdparty/markupsafe (3.0.3)',
    '242f35efa067a46c595645eeda7b1771ea1f83b1 demos/3rdparty/nuklear (4.12.8)',
]);

const SOURCE_PACKAGES = Object.freeze(
    [
        {
            id: 'freetype',
            version: '2.13.3',
            sourceKind: 'archive',
            sourceUrl:
                'https://download.savannah.gnu.org/releases/freetype/freetype-2.13.3.tar.xz',
            expectedSha256:
                '0550350666d427c74daeb85d5ac7bb353acba5f76956395995311a9c6f063289',
            license: 'FreeType License (FTL)',
        },
        {
            id: 'fribidi',
            version: '1.0.16',
            sourceKind: 'archive',
            sourceUrl:
                'https://github.com/fribidi/fribidi/releases/download/v1.0.16/fribidi-1.0.16.tar.xz',
            expectedSha256:
                '1b1cde5b235d40479e91be2f0e88a309e3214c8ab470ec8a2744d82a5a9ea05c',
            license: 'LGPL-2.1-or-later',
        },
        {
            id: 'harfbuzz',
            version: '8.5.0',
            sourceKind: 'archive',
            sourceUrl:
                'https://github.com/harfbuzz/harfbuzz/releases/download/8.5.0/harfbuzz-8.5.0.tar.xz',
            expectedSha256:
                '77e4f7f98f3d86bf8788b53e6832fb96279956e1c3961988ea3d4b7ca41ddc27',
            license: 'MIT',
        },
        {
            id: 'expat',
            version: '2.8.2',
            sourceKind: 'archive',
            sourceUrl:
                'https://github.com/libexpat/libexpat/releases/download/R_2_8_2/expat-2.8.2.tar.xz',
            expectedSha256:
                '3ad89b8588e6644bd4e49981480d48b21289eebbcd4f0a1a4afb1c29f99b6ab4',
            license: 'MIT',
        },
        {
            id: 'fontconfig',
            version: '2.16.0',
            sourceKind: 'archive',
            sourceUrl:
                'https://www.freedesktop.org/software/fontconfig/release/fontconfig-2.16.0.tar.xz',
            expectedSha256:
                '6a33dc555cc9ba8b10caf7695878ef134eeb36d0af366041f639b1da9b6ed220',
            license: 'MIT',
        },
        {
            id: 'libass',
            version: '0.17.3',
            sourceKind: 'archive',
            sourceUrl:
                'https://github.com/libass/libass/releases/download/0.17.3/libass-0.17.3.tar.xz',
            expectedSha256:
                'eae425da50f0015c21f7b3a9c7262a910f0218af469e22e2931462fed3c50959',
            license: 'ISC',
        },
        {
            id: 'openssl',
            version: '3.5.7',
            sourceKind: 'archive',
            sourceUrl:
                'https://github.com/openssl/openssl/releases/download/openssl-3.5.7/openssl-3.5.7.tar.gz',
            expectedSha256:
                'a8c0d28a529ca480f9f36cf5792e2cd21984552a3c8e4aa11a24aa31aeac98e8',
            license: 'Apache-2.0',
        },
        {
            id: 'ffmpeg',
            version: '8.1',
            sourceKind: 'archive',
            sourceUrl: 'https://ffmpeg.org/releases/ffmpeg-8.1.tar.xz',
            expectedSha256:
                'b072aed6871998cce9b36e7774033105ca29e33632be5b6347f3206898e0756a',
            license: 'LGPL-2.1-or-later',
        },
        {
            id: 'libplacebo',
            version: '7.360.1',
            sourceKind: 'git',
            sourceUrl: 'https://github.com/haasn/libplacebo.git',
            sourceTag: 'v7.360.1',
            expectedGitCommit: 'cee9b076f2c63104ccfd497fa79c39a867293ec4',
            expectedSubmodules: EXPECTED_LIBPLACEBO_V7_360_1_SOURCE_SUBMODULES,
            license: 'LGPL-2.1-or-later',
        },
        {
            id: 'hwdata',
            version: '0.409',
            sourceKind: 'archive',
            sourceUrl:
                'https://github.com/vcrhonek/hwdata/archive/refs/tags/v0.409.tar.gz',
            expectedSha256:
                '23006accc0f931dd5187d0307a57d0744e2b8feb85e73c37bc0f5229fb31eadd',
            license: 'GPL-2.0-or-later OR XFree86-1.0',
            buildInput: HWDATA_BUILD_INPUT,
        },
        {
            id: 'libdisplay-info',
            version: '0.1.1',
            sourceKind: 'archive',
            sourceUrl:
                'https://gitlab.freedesktop.org/emersion/libdisplay-info/-/releases/0.1.1/downloads/libdisplay-info-0.1.1.tar.xz',
            expectedSha256:
                '0d8731588e9f82a9cac96324a3d7c82e2ba5b1b5e006143fefe692c74069fb60',
            license: 'MIT',
        },
        {
            id: 'mpv',
            version: '0.41.0',
            sourceKind: 'archive',
            sourceUrl:
                'https://github.com/mpv-player/mpv/archive/refs/tags/v0.41.0.tar.gz',
            expectedSha256:
                'ee21092a5ee427353392360929dc64645c54479aefdb5babc5cfbb5fad626209',
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
    '-Ddrm=enabled',
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
            '-Dxml-backend=expat',
            '-Dbaseconfig-dir=/etc/fonts',
            '-Dconfig-dir=/etc/fonts/conf.d',
            '-Dtemplate-dir=/usr/share/fontconfig/conf.avail',
            '-Dcache-dir=/var/cache/fontconfig',
            '-Dxml-dir=/usr/share/xml/fontconfig',
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
            '--openssldir=/etc/ssl',
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
    hwdata: Object.freeze({
        buildSystem: 'data',
        sharedOnly: false,
        args: Object.freeze([]),
    }),
    'libdisplay-info': Object.freeze({
        buildSystem: 'meson',
        sharedOnly: true,
        args: Object.freeze([]),
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
    'gperf',
    'make',
    'meson',
    'nasm',
    'ninja',
    'patchelf',
    'perl',
    'pkg-config',
    'python3',
    'readelf',
    'tar',
]);

const MINIMUM_TOOL_VERSIONS = Object.freeze({
    cc: '9.0.0',
    cmake: '3.16.0',
    curl: '7.71.0',
    git: '2.30.0',
    gperf: '3.1.0',
    make: '4.0.0',
    meson: '1.6.0',
    nasm: '2.15.05',
    ninja: '1.10.0',
    patchelf: '0.14.0',
    perl: '5.30.0',
    'pkg-config': '0.29.0',
    python3: '3.8.0',
    readelf: '2.35.0',
    tar: '1.30.0',
});

const DEFAULT_SYSTEM_PKG_CONFIG_DIRS = Object.freeze([
    '/usr/lib/x86_64-linux-gnu/pkgconfig',
    '/usr/lib64/pkgconfig',
    '/usr/lib/pkgconfig',
    '/usr/share/pkgconfig',
]);

const EXPECTED_SYSTEM_PKG_CONFIG_PACKAGES = Object.freeze([
    'alsa',
    'egl',
    'gbm',
    'gl',
    'libdrm',
    'libpulse',
    'libva',
    'libva-drm',
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

const RUNTIME_EXTERNAL_CONFIGURATION = Object.freeze({
    fontconfig: Object.freeze({
        configDirectory: '/etc/fonts',
        templateDirectory: '/usr/share/fontconfig',
        cacheDirectory: '/var/cache/fontconfig',
        ownership: 'system',
    }),
    openssl: Object.freeze({
        configFile: '/etc/ssl/openssl.cnf',
        certificateFile: '/etc/ssl/cert.pem',
        certificateDirectory: '/etc/ssl/certs',
        ownership: 'system',
    }),
});

const OUTPUT_OWNERSHIP_MARKER = '.iptvnator-linux-runtime-owner';
const OUTPUT_OWNERSHIP_MARKER_CONTENT =
    'iptvnator-embedded-mpv-linux-runtime-v1\n';

const PORTABLE_ABI_BASELINE = Object.freeze({
    distribution: 'Ubuntu 22.04',
    glibcMaximum: '2.35',
    glibcxxMaximum: '3.4.30',
});

const SHARED_LIBRARY_PATTERN = /\.so(?:\.\d+)*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const externalSystemLibraryNames = new Set(
    EXTERNAL_SYSTEM_LIBRARIES.map(({ name }) => name)
);
const allowedExternalLibraryNames = new Set([
    ...GLIBC_TOOLCHAIN_ALLOWLIST,
    ...externalSystemLibraryNames,
]);

function assertArchiveMatchesPin(sourcePackage, actualSha256) {
    if (actualSha256 !== sourcePackage.expectedSha256) {
        throw new Error(
            `${sourcePackage.id} archive SHA-256 mismatch: expected ${sourcePackage.expectedSha256}, received ${actualSha256}.`
        );
    }
}

function assertGitCommitMatchesPin(sourcePackage, actualGitCommit) {
    if (actualGitCommit !== sourcePackage.expectedGitCommit) {
        throw new Error(
            `${sourcePackage.id} git commit mismatch: expected ${sourcePackage.expectedGitCommit}, received ${actualGitCommit}.`
        );
    }
}

function assertGitSubmodulesMatchPin(sourcePackage, actualSubmodules) {
    if (
        !isDeepStrictEqual(actualSubmodules, sourcePackage.expectedSubmodules)
    ) {
        throw new Error(
            `${sourcePackage.id} git submodules do not match the exact pinned recursive records.`
        );
    }
}

function parseVersion(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const match = value.match(/\b(\d+\.\d+(?:\.\d+)*)\b/);
    return match?.[1] ?? null;
}

function compareVersions(left, right) {
    const leftParts = left.split('.').map(Number);
    const rightParts = right.split('.').map(Number);
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index += 1) {
        const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
        if (difference !== 0) {
            return Math.sign(difference);
        }
    }
    return 0;
}

function assertMinimumToolVersions(toolVersions) {
    for (const tool of REQUIRED_TOOLS) {
        const declaredVersion = toolVersions?.[tool];
        if (typeof declaredVersion !== 'string' || !declaredVersion.trim()) {
            throw new Error(`Missing required tool version for ${tool}.`);
        }
        const actualVersion = parseVersion(declaredVersion);
        if (!actualVersion) {
            throw new Error(
                `Unable to parse required tool version for ${tool}: ${declaredVersion}.`
            );
        }
        const minimumVersion = MINIMUM_TOOL_VERSIONS[tool];
        if (compareVersions(actualVersion, minimumVersion) < 0) {
            throw new Error(
                `${tool} ${actualVersion} is unsupported; ${tool} requires ${minimumVersion} or newer for Linux runtime builds.`
            );
        }
    }
}

function assertUniqueMesonOptionAssignments(buildRecipes) {
    if (!buildRecipes || typeof buildRecipes !== 'object') {
        throw new TypeError('Linux runtime build recipes must be an object.');
    }
    for (const [packageId, recipe] of Object.entries(buildRecipes)) {
        if (recipe?.buildSystem !== 'meson') {
            continue;
        }
        if (!Array.isArray(recipe.args)) {
            throw new Error(
                `${packageId} Meson recipe must declare an argument array.`
            );
        }

        const assignmentsByOption = new Map();
        for (const flag of recipe.args) {
            const match =
                typeof flag === 'string' ? flag.match(/^(-D[^=]+)=/) : null;
            if (!match) {
                continue;
            }
            const option = match[1];
            const assignmentCount = (assignmentsByOption.get(option) ?? 0) + 1;
            assignmentsByOption.set(option, assignmentCount);
            if (assignmentCount > 1) {
                throw new Error(
                    `${packageId} Meson recipe must assign ${option} exactly once.`
                );
            }
        }
    }
}

function lstatIfExists(fileSystem, filePath) {
    try {
        return fileSystem.lstatSync(filePath);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

function assertOwnedOutputDestination(outputPrefix, fileSystem = fs) {
    const outputStat = lstatIfExists(fileSystem, outputPrefix);
    if (!outputStat) {
        return;
    }
    if (!outputStat.isDirectory() || outputStat.isSymbolicLink()) {
        throw new Error(
            `Existing output ${outputPrefix} must be a non-symbolic-link directory carrying the IPTVnator ownership marker.`
        );
    }

    const markerPath = path.join(outputPrefix, OUTPUT_OWNERSHIP_MARKER);
    const markerStat = lstatIfExists(fileSystem, markerPath);
    if (
        !markerStat ||
        !markerStat.isFile() ||
        markerStat.isSymbolicLink() ||
        fileSystem.readFileSync(markerPath, 'utf8') !==
            OUTPUT_OWNERSHIP_MARKER_CONTENT
    ) {
        throw new Error(
            `Existing output ${outputPrefix} is missing the valid IPTVnator ownership marker.`
        );
    }
}

function ownedStagingPrefixPath(outputPrefix, token) {
    return path.join(
        path.dirname(outputPrefix),
        `.${path.basename(outputPrefix)}.iptvnator-stage-${token}`
    );
}

function createOwnedStagingPrefix(
    outputPrefix,
    { fileSystem = fs, token = crypto.randomBytes(8).toString('hex') } = {}
) {
    assertOwnedOutputDestination(outputPrefix, fileSystem);
    const outputParent = path.dirname(outputPrefix);
    const stagingPrefix = ownedStagingPrefixPath(outputPrefix, token);
    if (lstatIfExists(fileSystem, stagingPrefix)) {
        throw new Error(
            `Refusing to reuse existing Linux runtime staging path ${stagingPrefix}.`
        );
    }

    fileSystem.mkdirSync(outputParent, { recursive: true });
    fileSystem.mkdirSync(stagingPrefix);
    try {
        fileSystem.writeFileSync(
            path.join(stagingPrefix, OUTPUT_OWNERSHIP_MARKER),
            OUTPUT_OWNERSHIP_MARKER_CONTENT,
            { mode: 0o644 }
        );
    } catch (error) {
        fileSystem.rmSync(stagingPrefix, { recursive: true, force: true });
        throw error;
    }
    return stagingPrefix;
}

function publishOwnedOutput({
    outputPrefix,
    stagingPrefix,
    fileSystem = fs,
    token = crypto.randomBytes(8).toString('hex'),
}) {
    assertOwnedOutputDestination(outputPrefix, fileSystem);
    assertOwnedOutputDestination(stagingPrefix, fileSystem);
    if (!lstatIfExists(fileSystem, stagingPrefix)) {
        throw new Error(
            `Linux runtime staging prefix does not exist: ${stagingPrefix}.`
        );
    }

    const backupPrefix = path.join(
        path.dirname(outputPrefix),
        `.${path.basename(outputPrefix)}.iptvnator-backup-${token}`
    );
    if (lstatIfExists(fileSystem, backupPrefix)) {
        throw new Error(
            `Refusing to reuse existing Linux runtime backup path ${backupPrefix}.`
        );
    }

    let movedPreviousOutput = false;
    let published = false;
    try {
        if (lstatIfExists(fileSystem, outputPrefix)) {
            fileSystem.renameSync(outputPrefix, backupPrefix);
            movedPreviousOutput = true;
        }
        fileSystem.renameSync(stagingPrefix, outputPrefix);
        published = true;
        if (movedPreviousOutput) {
            fileSystem.rmSync(backupPrefix, {
                recursive: true,
                force: true,
            });
        }
    } catch (error) {
        if (
            movedPreviousOutput &&
            !lstatIfExists(fileSystem, outputPrefix) &&
            lstatIfExists(fileSystem, backupPrefix)
        ) {
            fileSystem.renameSync(backupPrefix, outputPrefix);
        }
        throw error;
    } finally {
        if (lstatIfExists(fileSystem, stagingPrefix)) {
            fileSystem.rmSync(stagingPrefix, {
                recursive: true,
                force: true,
            });
        }
        if (published && lstatIfExists(fileSystem, backupPrefix)) {
            fileSystem.rmSync(backupPrefix, {
                recursive: true,
                force: true,
            });
        }
    }
}

function joinEnvironmentParts(parts, separator = ' ') {
    return parts.filter((value) => value && value.trim()).join(separator);
}

function resolveSystemPkgConfigDirs(environment = {}) {
    const explicitDirectories =
        environment.IPTVNATOR_EMBEDDED_MPV_SYSTEM_PKG_CONFIG_DIRS;
    if (!explicitDirectories) {
        return [...DEFAULT_SYSTEM_PKG_CONFIG_DIRS];
    }

    const directories = explicitDirectories
        .split(path.delimiter)
        .map((directory) => directory.trim())
        .filter(Boolean);
    if (
        directories.length === 0 ||
        directories.some((directory) => !path.isAbsolute(directory))
    ) {
        throw new Error(
            'IPTVNATOR_EMBEDDED_MPV_SYSTEM_PKG_CONFIG_DIRS must contain only absolute paths.'
        );
    }
    return [
        ...new Set(directories.map((directory) => path.normalize(directory))),
    ];
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
    const ignoredVariables = new Set([
        'CFLAGS',
        'CPPFLAGS',
        'CXXFLAGS',
        'LDFLAGS',
        'LD_LIBRARY_PATH',
        'LIBRARY_PATH',
        'CPATH',
        'C_INCLUDE_PATH',
        'CPLUS_INCLUDE_PATH',
        'CMAKE_PREFIX_PATH',
        'CMAKE_LIBRARY_PATH',
        'CMAKE_INCLUDE_PATH',
        'FONTCONFIG_PATH',
        'OPENSSL_MODULES',
    ]);
    const inheritedEnvironment = Object.fromEntries(
        Object.entries(baseEnv).filter(
            ([name]) =>
                !ignoredVariables.has(name) && !name.startsWith('PKG_CONFIG')
        )
    );

    return {
        ...inheritedEnvironment,
        PATH: joinEnvironmentParts(
            [path.join(prefix, 'bin'), baseEnv.PATH],
            path.delimiter
        ),
        PKG_CONFIG_PATH: prefixPkgConfigDirs.join(path.delimiter),
        PKG_CONFIG_LIBDIR: pkgConfigLibDirs.join(path.delimiter),
        CMAKE_PREFIX_PATH: prefix,
        CPPFLAGS: `-I${path.join(prefix, 'include')}`,
        CFLAGS: joinEnvironmentParts([
            '-fPIC',
            `-I${path.join(prefix, 'include')}`,
        ]),
        CXXFLAGS: joinEnvironmentParts([
            '-fPIC',
            `-I${path.join(prefix, 'include')}`,
        ]),
        LDFLAGS: joinEnvironmentParts([
            `-L${prefixLibDir}`,
            `-Wl,-rpath-link,${prefixLibDir}`,
        ]),
        LD_LIBRARY_PATH: prefixLibDir,
        FONTCONFIG_PATH: path.join(prefix, 'etc', 'fonts'),
        OPENSSL_MODULES: path.join(prefixLibDir, 'ossl-modules'),
    };
}

function createPinnedHwdataPkgConfigEnvironment({ buildEnvironment, prefix }) {
    if (!buildEnvironment || typeof buildEnvironment !== 'object') {
        throw new TypeError(
            'Pinned hwdata requires the Linux runtime build environment.'
        );
    }
    const prefixPkgConfigDirs = [
        path.join(prefix, 'lib', 'pkgconfig'),
        path.join(prefix, 'share', 'pkgconfig'),
    ];
    const pinnedPkgConfigPath = prefixPkgConfigDirs.join(path.delimiter);
    return {
        ...buildEnvironment,
        PKG_CONFIG_PATH: pinnedPkgConfigPath,
        PKG_CONFIG_LIBDIR: pinnedPkgConfigPath,
    };
}

function assertPinnedHwdataResolution({
    pcFileDir,
    pkgDataDir,
    prefix,
    version,
}) {
    const expectedPcFileDir = path.join(prefix, 'share', 'pkgconfig');
    const expectedPkgDataDir = path.join(prefix, 'share', 'hwdata');
    if (path.resolve(pcFileDir) !== path.resolve(expectedPcFileDir)) {
        throw new Error(
            `Pinned hwdata pkg-config metadata resolved outside the staged prefix: ${pcFileDir}.`
        );
    }
    if (path.resolve(pkgDataDir) !== path.resolve(expectedPkgDataDir)) {
        throw new Error(
            `Pinned hwdata data resolved outside the staged prefix: ${pkgDataDir}.`
        );
    }
    const hwdataPackage = SOURCE_PACKAGES.find(({ id }) => id === 'hwdata');
    if (version !== hwdataPackage.version) {
        throw new Error(
            `Pinned hwdata version mismatch: expected ${hwdataPackage.version}, received ${version}.`
        );
    }
}

function preparePinnedHwdataBuildInput({
    buildEnvironment,
    fileSystem = fs,
    prefix,
    runCapture,
    sourcePath,
}) {
    if (typeof runCapture !== 'function') {
        throw new TypeError(
            'Pinned hwdata preparation requires a command capture function.'
        );
    }
    const hwdataPackage = SOURCE_PACKAGES.find(({ id }) => id === 'hwdata');
    const sourceRoot = fileSystem.realpathSync(sourcePath);
    const sourceInputPath = path.join(
        sourcePath,
        hwdataPackage.buildInput.relativePath
    );
    const sourceInputStat = fileSystem.lstatSync(sourceInputPath);
    if (!sourceInputStat.isFile() || sourceInputStat.isSymbolicLink()) {
        throw new Error(
            `Pinned hwdata build input must be a regular file: ${sourceInputPath}.`
        );
    }
    const realSourceInputPath = fileSystem.realpathSync(sourceInputPath);
    assertPathInside(
        sourceRoot,
        realSourceInputPath,
        'Pinned hwdata build input'
    );
    const pnpIds = fileSystem.readFileSync(realSourceInputPath);
    if (pnpIds.length === 0) {
        throw new Error('Pinned hwdata pnp.ids build input must not be empty.');
    }

    const pkgDataDir = path.join(prefix, 'share', 'hwdata');
    const pcFileDir = path.join(prefix, 'share', 'pkgconfig');
    fileSystem.mkdirSync(pkgDataDir, { recursive: true });
    fileSystem.mkdirSync(pcFileDir, { recursive: true });
    fileSystem.writeFileSync(path.join(pkgDataDir, 'pnp.ids'), pnpIds, {
        mode: 0o644,
    });
    fileSystem.writeFileSync(
        path.join(pcFileDir, 'hwdata.pc'),
        [
            `prefix=${prefix}`,
            'datadir=${prefix}/share',
            `pkgdatadir=${pkgDataDir}`,
            '',
            'Name: hwdata',
            'Description: Pinned PNP hardware identification data',
            `Version: ${hwdataPackage.version}`,
            '',
        ].join('\n'),
        { mode: 0o644 }
    );

    const pinnedEnvironment = createPinnedHwdataPkgConfigEnvironment({
        buildEnvironment,
        prefix,
    });
    const captureOptions = { env: pinnedEnvironment };
    const resolvedPcFileDir = runCapture(
        'pkg-config',
        ['--variable=pcfiledir', 'hwdata'],
        captureOptions
    );
    const resolvedPkgDataDir = runCapture(
        'pkg-config',
        ['--variable=pkgdatadir', 'hwdata'],
        captureOptions
    );
    const resolvedVersion = runCapture(
        'pkg-config',
        ['--modversion', 'hwdata'],
        captureOptions
    );
    assertPinnedHwdataResolution({
        pcFileDir: resolvedPcFileDir,
        pkgDataDir: resolvedPkgDataDir,
        prefix,
        version: resolvedVersion,
    });
    return pinnedEnvironment;
}

function resolveLinuxPackageBuildEnvironment(packageId, context) {
    if (packageId !== 'libdisplay-info') {
        return context.buildEnvironment;
    }
    if (!context.hwdataBuildEnvironment) {
        throw new Error(
            'libdisplay-info requires the staged pinned hwdata build environment.'
        );
    }
    return context.hwdataBuildEnvironment;
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

function materializeLibrarySymlinks(libDir, selectedNames = null) {
    const realLibDir = fs.realpathSync(libDir);
    for (const name of runtimeLibraryNames(libDir)) {
        if (selectedNames && !selectedNames.has(name)) {
            continue;
        }
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

function selectReachableRuntimeLibraryNames(entries) {
    if (!Array.isArray(entries)) {
        throw new TypeError('Runtime dynamic entries must be an array.');
    }

    const entriesByName = new Map();
    for (const entry of entries) {
        if (
            !entry ||
            typeof entry.name !== 'string' ||
            !SHARED_LIBRARY_PATTERN.test(entry.name)
        ) {
            throw new Error(
                'Runtime dynamic entry has an invalid library name.'
            );
        }
        if (entriesByName.has(entry.name)) {
            throw new Error(
                `Runtime dynamic entries contain duplicate library ${entry.name}.`
            );
        }
        entriesByName.set(entry.name, entry);
    }

    const linkerAlias = entriesByName.get('libmpv.so');
    if (!linkerAlias) {
        throw new Error(
            'Linux runtime must contain the libmpv.so linker alias.'
        );
    }
    if (
        typeof linkerAlias.soname !== 'string' ||
        !SHARED_LIBRARY_PATTERN.test(linkerAlias.soname) ||
        !entriesByName.has(linkerAlias.soname)
    ) {
        throw new Error(
            'libmpv.so must declare a bundled SONAME before runtime pruning.'
        );
    }

    const reachableNames = new Set(['libmpv.so']);
    const pendingNames = [linkerAlias.soname];
    while (pendingNames.length > 0) {
        const libraryName = pendingNames.shift();
        if (reachableNames.has(libraryName)) {
            continue;
        }
        reachableNames.add(libraryName);
        const entry = entriesByName.get(libraryName);
        if (!entry) {
            throw new Error(
                `Reachable runtime library ${libraryName} is missing its dynamic entry.`
            );
        }
        for (const neededName of entry.needed ?? []) {
            if (
                entriesByName.has(neededName) &&
                !reachableNames.has(neededName)
            ) {
                pendingNames.push(neededName);
            }
        }
    }

    return [...reachableNames].sort();
}

function retainRuntimeLibraries(libDir, retainedNames) {
    if (!Array.isArray(retainedNames) || retainedNames.length === 0) {
        throw new Error('Runtime retention list must be a non-empty array.');
    }
    const retainedNameSet = new Set(retainedNames);
    if (retainedNameSet.size !== retainedNames.length) {
        throw new Error('Runtime retention list contains duplicate libraries.');
    }

    const availableNames = runtimeLibraryNames(libDir);
    for (const retainedName of retainedNameSet) {
        if (!availableNames.includes(retainedName)) {
            throw new Error(
                `Retained runtime library does not exist: ${retainedName}.`
            );
        }
    }

    materializeLibrarySymlinks(libDir, retainedNameSet);
    for (const libraryName of availableNames) {
        if (!retainedNameSet.has(libraryName)) {
            fs.rmSync(path.join(libDir, libraryName));
        }
    }

    for (const retainedName of retainedNameSet) {
        const retainedPath = path.join(libDir, retainedName);
        const stat = fs.lstatSync(retainedPath);
        if (!stat.isFile() || stat.isSymbolicLink()) {
            throw new Error(
                `Retained runtime library ${retainedName} must be a materialized regular file.`
            );
        }
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
        soname: null,
    };
    const dynamicEntryPattern =
        /\((NEEDED|RPATH|RUNPATH|SONAME)\)[^[]*\[([^\]]*)\]/g;
    for (const match of output.matchAll(dynamicEntryPattern)) {
        const [, tag, value] = match;
        if (tag === 'SONAME') {
            dynamic.soname = value;
            continue;
        }
        if (tag === 'NEEDED') {
            dynamic.needed.push(value);
            continue;
        }
        const field = tag.toLowerCase();
        dynamic[field].push(
            ...value.split(':').filter((pathEntry) => pathEntry.length > 0)
        );
    }

    for (const field of ['needed', 'rpath', 'runpath']) {
        dynamic[field] = [...new Set(dynamic[field])].sort();
    }
    return dynamic;
}

function parseReadelfVersionInfo(output, name) {
    if (typeof output !== 'string' || typeof name !== 'string' || !name) {
        throw new TypeError(
            'readelf version output and runtime library name are required.'
        );
    }

    let requiredGlibc = null;
    let requiredGlibcxx = null;
    const versionPattern = /\b(GLIBCXX|GLIBC)_(\d+(?:\.\d+)+)\b/g;
    for (const [, namespace, version] of output.matchAll(versionPattern)) {
        if (
            namespace === 'GLIBC' &&
            (!requiredGlibc || compareVersions(version, requiredGlibc) > 0)
        ) {
            requiredGlibc = version;
        }
        if (
            namespace === 'GLIBCXX' &&
            (!requiredGlibcxx || compareVersions(version, requiredGlibcxx) > 0)
        ) {
            requiredGlibcxx = version;
        }
    }

    return { name, requiredGlibc, requiredGlibcxx };
}

function assertPortableAbiRecords(records) {
    if (!Array.isArray(records)) {
        throw new TypeError('Runtime ABI records must be an array.');
    }
    for (const record of records) {
        for (const [field, maximum] of [
            ['requiredGlibc', PORTABLE_ABI_BASELINE.glibcMaximum],
            ['requiredGlibcxx', PORTABLE_ABI_BASELINE.glibcxxMaximum],
        ]) {
            const version = record?.[field];
            if (version && compareVersions(version, maximum) > 0) {
                throw new Error(
                    `Portable ABI baseline ${PORTABLE_ABI_BASELINE.distribution} rejects newer symbol ${version} required by ${record.name}; maximum ${field} is ${maximum}.`
                );
            }
        }
    }
}

function assertPortableBuildHostGlibc(glibcVersion) {
    if (
        typeof glibcVersion !== 'string' ||
        !/^\d+(?:\.\d+)+$/.test(glibcVersion)
    ) {
        throw new Error(
            'Unable to determine the Linux build host glibc version.'
        );
    }
    if (compareVersions(glibcVersion, PORTABLE_ABI_BASELINE.glibcMaximum) > 0) {
        throw new Error(
            `Build host glibc ${glibcVersion} exceeds the portable ABI baseline ${PORTABLE_ABI_BASELINE.distribution} maximum ${PORTABLE_ABI_BASELINE.glibcMaximum}.`
        );
    }
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
            soname: entry.soname ?? null,
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

        if (
            entry.soname !== null &&
            (typeof entry.soname !== 'string' ||
                !SHARED_LIBRARY_PATTERN.test(entry.soname) ||
                path.basename(entry.soname) !== entry.soname)
        ) {
            throw new Error(
                `${entry.name} SONAME must be null or a safe shared-library basename.`
            );
        }
        if (
            entry.name === 'libmpv.so' &&
            (typeof entry.soname !== 'string' ||
                !/^libmpv\.so\.\d+(?:\.\d+)*$/.test(entry.soname) ||
                !bundledNames.has(entry.soname))
        ) {
            throw new Error(
                'libmpv.so must declare a versioned SONAME present in the runtime closure.'
            );
        }

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
        ...(sourceRecord.buildInput
            ? { buildInput: { ...sourceRecord.buildInput } }
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
    abiRecords,
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
        if (sourcePackage.sourceKind === 'archive') {
            assertArchiveMatchesPin(sourcePackage, sourceRecord.sourceSha256);
        } else {
            assertGitCommitMatchesPin(
                sourcePackage,
                sourceRecord.sourceGitCommit
            );
            assertGitSubmodulesMatchPin(
                sourcePackage,
                sourceRecord.sourceSubmodules
            );
        }
        packages[sourcePackage.id] = sourceManifestMetadata(sourceRecord);
    }
    assertPortableAbiRecords(abiRecords);

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
        runtimeAbi: {
            baseline: { ...PORTABLE_ABI_BASELINE },
            files: abiRecords.map((record) => ({ ...record })),
        },
        runtimeExternalConfiguration: {
            fontconfig: { ...RUNTIME_EXTERNAL_CONFIGURATION.fontconfig },
            openssl: { ...RUNTIME_EXTERNAL_CONFIGURATION.openssl },
        },
        runtimeDependencyClosure: {
            entries: dependencyClosure.entries.map((entry) => ({
                name: entry.name,
                soname: entry.soname ?? null,
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
            'Attach a source archive to the corresponding Linux binary release containing the exact downloaded source archives, including the pinned dual-licensed hwdata archive whose pnp.ids is compiled into the MIT-licensed libdisplay-info source archive, a checkout or git bundle of the recorded libplacebo commit and submodules, tools/embedded-mpv/build-linux-runtime.mjs, tools/embedded-mpv/build-linux-runtime.cjs, this runtime manifest, and any local patches.',
    };
}

module.exports = {
    BUILD_RECIPES,
    BUILD_ORDER,
    DEFAULT_SYSTEM_PKG_CONFIG_DIRS,
    EXTERNAL_SYSTEM_LIBRARIES,
    EXPECTED_LIBPLACEBO_V7_360_1_SOURCE_SUBMODULES,
    EXPECTED_SYSTEM_PKG_CONFIG_PACKAGES,
    FFMPEG_CONFIGURE_FLAGS,
    GLIBC_TOOLCHAIN_ALLOWLIST,
    MINIMUM_TOOL_VERSIONS,
    MPV_MESON_FLAGS,
    OUTPUT_OWNERSHIP_MARKER,
    PORTABLE_ABI_BASELINE,
    REQUIRED_TOOLS,
    RUNTIME_EXTERNAL_CONFIGURATION,
    SOURCE_PACKAGES,
    assertArchiveMatchesPin,
    assertGitCommitMatchesPin,
    assertGitSubmodulesMatchPin,
    assertMinimumToolVersions,
    assertOwnedOutputDestination,
    assertPortableAbiRecords,
    assertPortableBuildHostGlibc,
    assertUniqueMesonOptionAssignments,
    compareVersions,
    createBuildEnvironment,
    createLinuxRuntimeManifest,
    createOwnedStagingPrefix,
    createRuntimeFileRecords,
    materializeLibrarySymlinks,
    ownedStagingPrefixPath,
    parseCliInvocation,
    parseReadelfDynamic,
    parseReadelfVersionInfo,
    parseVersion,
    preparePinnedHwdataBuildInput,
    resolveSystemPkgConfigDirs,
    resolveLinuxPackageBuildEnvironment,
    runtimeLibraryNames,
    sha256Buffer,
    publishOwnedOutput,
    retainRuntimeLibraries,
    selectReachableRuntimeLibraryNames,
    validateRuntimeDependencyClosure,
};
