import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const builderScript = path.join(currentDir, 'build-linux-runtime.mjs');
const builderHelpers = path.join(currentDir, 'build-linux-runtime.cjs');
const workspaceRoot = path.resolve(currentDir, '..', '..');
const require = createRequire(import.meta.url);
const {
    BUILD_RECIPES,
    BUILD_ORDER,
    DEFAULT_SYSTEM_PKG_CONFIG_DIRS,
    EXTERNAL_SYSTEM_LIBRARIES,
    EXPECTED_SYSTEM_PKG_CONFIG_PACKAGES,
    FFMPEG_CONFIGURE_FLAGS,
    GLIBC_TOOLCHAIN_ALLOWLIST,
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
    validateRuntimeDependencyClosure,
} = require('./build-linux-runtime.cjs');
const {
    validateLinuxRuntimeManifest,
} = require('./linux-runtime-manifest.cjs');

function createPinnedSourceRecords() {
    return Object.fromEntries(
        SOURCE_PACKAGES.map((sourcePackage) => [
            sourcePackage.id,
            {
                ...sourcePackage,
                ...(sourcePackage.sourceKind === 'git'
                    ? {
                          sourceGitCommit: sourcePackage.expectedGitCommit,
                          sourceSubmodules: [
                              `${'a'.repeat(40)} 3rdparty/example`,
                          ],
                      }
                    : {
                          sourceSha256: sourcePackage.expectedSha256,
                      }),
            },
        ])
    );
}

test('provides the Linux source runtime builder entrypoint and helpers', () => {
    assert.equal(fs.existsSync(builderScript), true);
    assert.equal(fs.existsSync(builderHelpers), true);
});

test('pins the complete source stack and preserves dependency build order', () => {
    assert.deepEqual(
        SOURCE_PACKAGES.map(({ id, version }) => ({ id, version })),
        [
            { id: 'freetype', version: '2.13.3' },
            { id: 'fribidi', version: '1.0.16' },
            { id: 'harfbuzz', version: '8.5.0' },
            { id: 'expat', version: '2.8.2' },
            { id: 'fontconfig', version: '2.16.0' },
            { id: 'libass', version: '0.17.3' },
            { id: 'openssl', version: '3.5.7' },
            { id: 'ffmpeg', version: '8.1' },
            { id: 'libplacebo', version: '7.360.1' },
            { id: 'mpv', version: '0.41.0' },
        ]
    );
    assert.deepEqual(
        BUILD_ORDER,
        SOURCE_PACKAGES.map(({ id }) => id)
    );

    for (const sourcePackage of SOURCE_PACKAGES) {
        assert.match(sourcePackage.sourceUrl, /^https:\/\//);
        assert.ok(sourcePackage.license);
        if (sourcePackage.id === 'libplacebo') {
            assert.equal(sourcePackage.sourceTag, 'v7.360.1');
            assert.equal(sourcePackage.sourceKind, 'git');
        } else {
            assert.equal(sourcePackage.sourceKind, 'archive');
        }
    }

    const byId = new Map(
        SOURCE_PACKAGES.map((sourcePackage) => [
            sourcePackage.id,
            sourcePackage,
        ])
    );
    assert.equal(
        byId.get('expat').sourceUrl,
        'https://github.com/libexpat/libexpat/releases/download/R_2_8_2/expat-2.8.2.tar.xz'
    );
    assert.equal(
        byId.get('fontconfig').sourceUrl,
        'https://www.freedesktop.org/software/fontconfig/release/fontconfig-2.16.0.tar.xz'
    );
    assert.equal(
        byId.get('openssl').sourceUrl,
        'https://github.com/openssl/openssl/releases/download/openssl-3.5.7/openssl-3.5.7.tar.gz'
    );
});

test('hardcodes the verified official archive digests and libplacebo commit', () => {
    const expectedArchivePins = {
        expat: '3ad89b8588e6644bd4e49981480d48b21289eebbcd4f0a1a4afb1c29f99b6ab4',
        ffmpeg: 'b072aed6871998cce9b36e7774033105ca29e33632be5b6347f3206898e0756a',
        fontconfig:
            '6a33dc555cc9ba8b10caf7695878ef134eeb36d0af366041f639b1da9b6ed220',
        freetype:
            '0550350666d427c74daeb85d5ac7bb353acba5f76956395995311a9c6f063289',
        fribidi:
            '1b1cde5b235d40479e91be2f0e88a309e3214c8ab470ec8a2744d82a5a9ea05c',
        harfbuzz:
            '77e4f7f98f3d86bf8788b53e6832fb96279956e1c3961988ea3d4b7ca41ddc27',
        libass: 'eae425da50f0015c21f7b3a9c7262a910f0218af469e22e2931462fed3c50959',
        mpv: 'ee21092a5ee427353392360929dc64645c54479aefdb5babc5cfbb5fad626209',
        openssl:
            'a8c0d28a529ca480f9f36cf5792e2cd21984552a3c8e4aa11a24aa31aeac98e8',
    };
    assert.deepEqual(
        Object.fromEntries(
            SOURCE_PACKAGES.filter(({ sourceKind }) => sourceKind === 'archive')
                .map(({ id, expectedSha256 }) => [id, expectedSha256])
                .sort(([left], [right]) => left.localeCompare(right))
        ),
        expectedArchivePins
    );
    assert.equal(
        SOURCE_PACKAGES.find(({ id }) => id === 'libplacebo').expectedGitCommit,
        'cee9b076f2c63104ccfd497fa79c39a867293ec4'
    );
});

test('rejects archive and git sources that differ from immutable pins', () => {
    const freetype = SOURCE_PACKAGES.find(({ id }) => id === 'freetype');
    assert.doesNotThrow(() =>
        assertArchiveMatchesPin(freetype, freetype.expectedSha256)
    );
    assert.throws(
        () => assertArchiveMatchesPin(freetype, '0'.repeat(64)),
        /freetype.*SHA-256 mismatch.*expected 055035.*received 000000/i
    );

    const libplacebo = SOURCE_PACKAGES.find(({ id }) => id === 'libplacebo');
    assert.doesNotThrow(() =>
        assertGitCommitMatchesPin(libplacebo, libplacebo.expectedGitCommit)
    );
    assert.throws(
        () => assertGitCommitMatchesPin(libplacebo, '0'.repeat(40)),
        /libplacebo.*commit mismatch.*expected cee9b.*received 000000/i
    );
});

test('verifies source pins before archive extraction or git submodules', () => {
    const builderSource = fs.readFileSync(builderScript, 'utf8');
    assert.ok(
        builderSource.indexOf(
            'assertArchiveMatchesPin(sourcePackage, sourceSha256)'
        ) < builderSource.indexOf("context.run('tar'")
    );
    assert.ok(
        builderSource.indexOf(
            'assertGitCommitMatchesPin(sourcePackage, sourceGitCommit)'
        ) <
            builderSource.indexOf(
                "['submodule', 'update', '--init', '--recursive', '--depth', '1']"
            )
    );
});

test('rejects source metadata that does not match the immutable pins', () => {
    const sourceRecords = createPinnedSourceRecords();
    sourceRecords.freetype.sourceSha256 = '0'.repeat(64);
    assert.throws(
        () =>
            createLinuxRuntimeManifest({
                sourceRecords,
                runtimeFiles: [
                    {
                        name: 'libmpv.so.2',
                        size: 1,
                        sha256: 'a'.repeat(64),
                    },
                ],
                dependencyClosure: {
                    entries: [
                        {
                            name: 'libmpv.so.2',
                            needed: ['libc.so.6'],
                            rpath: [],
                            runpath: ['$ORIGIN'],
                        },
                    ],
                    externalDependencies: ['libc.so.6'],
                },
                buildHost: {
                    platform: 'linux',
                    arch: 'x64',
                    tools: {},
                },
            }),
        /freetype.*SHA-256 mismatch/i
    );
});

test('defines shared-only source recipes with font discovery before playback', () => {
    assert.deepEqual(Object.keys(BUILD_RECIPES), BUILD_ORDER);
    assert.ok(BUILD_RECIPES.freetype.args.includes('--enable-shared'));
    assert.ok(BUILD_RECIPES.freetype.args.includes('--disable-static'));
    assert.ok(BUILD_RECIPES.fribidi.args.includes('--disable-docs'));
    assert.ok(BUILD_RECIPES.fribidi.args.includes('--disable-bin'));
    for (const flag of [
        '-Dtests=disabled',
        '-Ddocs=disabled',
        '-Dutilities=disabled',
    ]) {
        assert.ok(BUILD_RECIPES.harfbuzz.args.includes(flag), flag);
    }
    for (const flag of [
        '-DEXPAT_SHARED_LIBS=ON',
        '-DEXPAT_BUILD_TOOLS=OFF',
        '-DEXPAT_BUILD_EXAMPLES=OFF',
        '-DEXPAT_BUILD_TESTS=OFF',
        '-DEXPAT_BUILD_DOCS=OFF',
    ]) {
        assert.ok(BUILD_RECIPES.expat.args.includes(flag), flag);
    }
    for (const flag of [
        '-Ddoc=disabled',
        '-Dtests=disabled',
        '-Dtools=disabled',
        '-Dcache-build=disabled',
    ]) {
        assert.ok(BUILD_RECIPES.fontconfig.args.includes(flag), flag);
    }
    assert.ok(BUILD_RECIPES.libass.args.includes('--enable-fontconfig'));
    assert.equal(
        BUILD_RECIPES.libass.args.includes('--disable-fontconfig'),
        false
    );
    for (const flag of ['shared', 'no-apps', 'no-docs', 'no-tests']) {
        assert.ok(BUILD_RECIPES.openssl.args.includes(flag), flag);
    }
    assert.ok(
        BUILD_ORDER.indexOf('fontconfig') < BUILD_ORDER.indexOf('libass')
    );
    assert.ok(BUILD_ORDER.indexOf('openssl') < BUILD_ORDER.indexOf('ffmpeg'));
    for (const packageId of BUILD_ORDER) {
        assert.equal(BUILD_RECIPES[packageId].sharedOnly, true, packageId);
    }
});

test('constructs a prefix-only build environment and ignores hostile host flags', () => {
    const environment = createBuildEnvironment({
        prefix: '/opt/runtime',
        baseEnv: {
            PATH: '/usr/bin',
            KEEP_ME: 'benign',
            CPPFLAGS: '-I/host/include',
            CFLAGS: '-O0 -march=native',
            CXXFLAGS: '-stdlib=hostile',
            LDFLAGS: '-L/host/lib -Wl,--as-needed',
            LD_LIBRARY_PATH: '/host/runtime',
            LIBRARY_PATH: '/host/implicit',
            CPATH: '/host/cpath',
            C_INCLUDE_PATH: '/host/c-include',
            CPLUS_INCLUDE_PATH: '/host/cxx-include',
            CMAKE_PREFIX_PATH: '/host/cmake',
            PKG_CONFIG_PATH: '/host/pkgconfig',
            PKG_CONFIG_LIBDIR: '/host/pkgconfig-libdir',
            PKG_CONFIG_SYSROOT_DIR: '/host/sysroot',
            FONTCONFIG_PATH: '/host/fonts',
            OPENSSL_MODULES: '/host/openssl-modules',
        },
        systemPkgConfigDirs: [
            '/usr/lib/x86_64-linux-gnu/pkgconfig',
            '/usr/share/pkgconfig',
        ],
    });

    assert.equal(environment.PATH, '/opt/runtime/bin:/usr/bin');
    assert.equal(
        environment.PKG_CONFIG_PATH,
        '/opt/runtime/lib/pkgconfig:/opt/runtime/share/pkgconfig'
    );
    assert.equal(
        environment.PKG_CONFIG_LIBDIR,
        [
            '/opt/runtime/lib/pkgconfig',
            '/opt/runtime/share/pkgconfig',
            '/usr/lib/x86_64-linux-gnu/pkgconfig',
            '/usr/share/pkgconfig',
        ].join(':')
    );
    assert.equal(environment.CPPFLAGS, '-I/opt/runtime/include');
    assert.equal(environment.CFLAGS, '-fPIC -I/opt/runtime/include');
    assert.equal(environment.CXXFLAGS, '-fPIC -I/opt/runtime/include');
    assert.equal(
        environment.LDFLAGS,
        '-L/opt/runtime/lib -Wl,-rpath-link,/opt/runtime/lib'
    );
    assert.equal(environment.LD_LIBRARY_PATH, '/opt/runtime/lib');
    assert.equal(environment.CMAKE_PREFIX_PATH, '/opt/runtime');
    assert.equal(environment.KEEP_ME, 'benign');
    for (const variable of [
        'LIBRARY_PATH',
        'CPATH',
        'C_INCLUDE_PATH',
        'CPLUS_INCLUDE_PATH',
        'PKG_CONFIG_SYSROOT_DIR',
    ]) {
        assert.equal(environment[variable], undefined, variable);
    }
    assert.doesNotMatch(JSON.stringify(environment), /\/host\//);
});

test('uses fixed Linux x64 pkg-config directories without host discovery', () => {
    assert.deepEqual(DEFAULT_SYSTEM_PKG_CONFIG_DIRS, [
        '/usr/lib/x86_64-linux-gnu/pkgconfig',
        '/usr/lib64/pkgconfig',
        '/usr/lib/pkgconfig',
        '/usr/share/pkgconfig',
    ]);
    assert.deepEqual(
        resolveSystemPkgConfigDirs({}),
        DEFAULT_SYSTEM_PKG_CONFIG_DIRS
    );
    assert.deepEqual(
        resolveSystemPkgConfigDirs({
            IPTVNATOR_EMBEDDED_MPV_SYSTEM_PKG_CONFIG_DIRS:
                '/opt/interfaces/pkgconfig:/usr/share/pkgconfig:/opt/interfaces/pkgconfig',
        }),
        ['/opt/interfaces/pkgconfig', '/usr/share/pkgconfig']
    );
    assert.throws(
        () =>
            resolveSystemPkgConfigDirs({
                IPTVNATOR_EMBEDDED_MPV_SYSTEM_PKG_CONFIG_DIRS:
                    'relative/pkgconfig',
            }),
        /must contain only absolute paths/
    );

    const builderSource = fs.readFileSync(builderScript, 'utf8');
    assert.doesNotMatch(builderSource, /--variable['"],\s*['"]pc_path/);
});

test('declares only the intended Linux system interface packages', () => {
    assert.deepEqual(EXPECTED_SYSTEM_PKG_CONFIG_PACKAGES, [
        'alsa',
        'egl',
        'gbm',
        'gl',
        'libpulse',
        'libva',
        'libva-drm',
    ]);

    const builderSource = fs.readFileSync(builderScript, 'utf8');
    assert.match(
        builderSource,
        /pkg-config['"],\s*\[['"]--exists['"],\s*packageName\]/
    );
    assert.match(
        builderSource,
        /pkg-config['"],\s*\[['"]--modversion['"],\s*packageName\]/
    );
});

test('requires ELF patching and inspection tools in addition to the build toolchain', () => {
    for (const tool of [
        'cc',
        'cmake',
        'curl',
        'git',
        'make',
        'meson',
        'ninja',
        'patchelf',
        'pkg-config',
        'readelf',
        'tar',
    ]) {
        assert.ok(REQUIRED_TOOLS.includes(tool), tool);
    }
});

test('uses an explicit LGPL FFmpeg HTTPS and HLS protocol baseline', () => {
    const required = [
        '--enable-shared',
        '--disable-static',
        '--disable-programs',
        '--disable-doc',
        '--disable-debug',
        '--disable-autodetect',
        '--disable-gpl',
        '--disable-nonfree',
        '--enable-pic',
        '--enable-pthreads',
        '--enable-openssl',
        '--enable-network',
        '--enable-protocol=file',
        '--enable-protocol=http',
        '--enable-protocol=https',
        '--enable-protocol=tcp',
        '--enable-protocol=tls',
        '--enable-protocol=udp',
        '--enable-protocol=crypto',
        '--enable-protocol=data',
        '--enable-demuxer=hls',
        '--enable-vaapi',
    ];

    for (const flag of required) {
        assert.ok(FFMPEG_CONFIGURE_FLAGS.includes(flag), `missing ${flag}`);
    }
    for (const forbidden of [
        '--enable-gpl',
        '--enable-nonfree',
        '--enable-version3',
    ]) {
        assert.equal(FFMPEG_CONFIGURE_FLAGS.includes(forbidden), false);
    }
});

test('uses valid mpv v0.41 Meson option names and pins the Linux backends', () => {
    const upstreamMpv041Options = new Set([
        'aaudio',
        'alsa',
        'android-media-ndk',
        'audiotrack',
        'audiounit',
        'avfoundation',
        'build-date',
        'caca',
        'cdda',
        'coreaudio',
        'cocoa',
        'cplayer',
        'cplugins',
        'cuda-hwaccel',
        'cuda-interop',
        'd3d-hwaccel',
        'd3d11',
        'd3d9-hwaccel',
        'direct3d',
        'disable-packet-pool',
        'dmabuf-wayland',
        'drm',
        'dvbin',
        'dvdnav',
        'egl',
        'egl-android',
        'egl-angle',
        'egl-angle-lib',
        'egl-angle-win32',
        'egl-drm',
        'egl-wayland',
        'egl-x11',
        'fuzzers',
        'gbm',
        'gl',
        'gl-cocoa',
        'gl-dxinterop',
        'gl-dxinterop-d3d9',
        'gl-win32',
        'gl-x11',
        'gpl',
        'html-build',
        'iconv',
        'ios-gl',
        'jack',
        'javascript',
        'jpeg',
        'lcms2',
        'libarchive',
        'libavdevice',
        'libbluray',
        'libmpv',
        'lua',
        'macos-10-15-4-features',
        'macos-11-3-features',
        'macos-11-features',
        'macos-12-features',
        'macos-cocoa-cb',
        'macos-media-player',
        'macos-touchbar',
        'manpage-build',
        'openal',
        'opensles',
        'oss-audio',
        'pdf-build',
        'pipewire',
        'plain-gl',
        'pthread-debug',
        'pulse',
        'rubberband',
        'sdl2-audio',
        'sdl2-gamepad',
        'sdl2-video',
        'shaderc',
        'sixel',
        'sndio',
        'spirv-cross',
        'swift-build',
        'tests',
        'uchardet',
        'uwp',
        'vaapi',
        'vaapi-drm',
        'vaapi-wayland',
        'vaapi-win32',
        'vaapi-x11',
        'vapoursynth',
        'vdpau',
        'vdpau-gl-x11',
        'vector',
        'videotoolbox-gl',
        'videotoolbox-pl',
        'vulkan',
        'wasapi',
        'wayland',
        'win32-smtc',
        'win32-threads',
        'x11',
        'x11-clipboard',
        'xv',
        'zimg',
        'zlib',
    ]);

    for (const flag of MPV_MESON_FLAGS) {
        const optionName = flag.slice(2).split('=')[0];
        assert.ok(
            upstreamMpv041Options.has(optionName),
            `unknown mpv v0.41 option ${optionName}`
        );
        assert.doesNotMatch(flag, /=auto$/);
    }

    for (const required of [
        '-Dgpl=false',
        '-Dlibmpv=true',
        '-Dcplayer=false',
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
        '-Dvulkan=disabled',
        '-Dshaderc=disabled',
        '-Dspirv-cross=disabled',
        '-Dgl=enabled',
        '-Dplain-gl=enabled',
        '-Degl=enabled',
        '-Dgbm=enabled',
        '-Dpulse=enabled',
        '-Dalsa=enabled',
        '-Dvaapi=enabled',
        '-Dvaapi-drm=enabled',
    ]) {
        assert.ok(MPV_MESON_FLAGS.includes(required), `missing ${required}`);
    }
});

test('keeps the external dependency allowlists explicit and deterministic', () => {
    assert.deepEqual(GLIBC_TOOLCHAIN_ALLOWLIST, [
        'ld-linux-x86-64.so.2',
        'libc.so.6',
        'libdl.so.2',
        'libgcc_s.so.1',
        'libm.so.6',
        'libpthread.so.0',
        'librt.so.1',
        'libstdc++.so.6',
    ]);
    assert.deepEqual(
        EXTERNAL_SYSTEM_LIBRARIES.map(({ name }) => name),
        [
            'libEGL.so.1',
            'libGL.so.1',
            'libGLX.so.0',
            'libOpenGL.so.0',
            'libasound.so.2',
            'libdrm.so.2',
            'libgbm.so.1',
            'libpulse.so.0',
            'libva-drm.so.2',
            'libva.so.2',
        ]
    );
    for (const externalLibrary of EXTERNAL_SYSTEM_LIBRARIES) {
        assert.ok(externalLibrary.interface);
        assert.ok(externalLibrary.reason);
    }
});

test('parses readelf dynamic sections and validates an ORIGIN-only closure', () => {
    const mpvDynamic = parseReadelfDynamic(`
 0x0000000000000001 (NEEDED)             Shared library: [libavcodec.so.62]
 0x0000000000000001 (NEEDED)             Shared library: [libEGL.so.1]
 0x0000000000000001 (NEEDED)             Shared library: [libc.so.6]
 0x000000000000001d (RUNPATH)            Library runpath: [$ORIGIN]
`);
    assert.deepEqual(mpvDynamic, {
        needed: ['libEGL.so.1', 'libavcodec.so.62', 'libc.so.6'],
        rpath: [],
        runpath: ['$ORIGIN'],
    });

    const closure = validateRuntimeDependencyClosure({
        entries: [
            {
                name: 'libavcodec.so.62',
                ...parseReadelfDynamic(`
 0x0000000000000001 (NEEDED) Shared library: [libm.so.6]
 0x000000000000001d (RUNPATH) Library runpath: [$ORIGIN]
`),
            },
            { name: 'libmpv.so.2', ...mpvDynamic },
        ],
        runtimeFileNames: ['libavcodec.so.62', 'libmpv.so.2'],
        buildPrefix: '/tmp/iptvnator-prefix',
    });
    assert.deepEqual(closure.externalDependencies, [
        'libEGL.so.1',
        'libc.so.6',
        'libm.so.6',
    ]);
    assert.deepEqual(closure.entries[1].needed, [
        'libEGL.so.1',
        'libavcodec.so.62',
        'libc.so.6',
    ]);

    assert.throws(
        () =>
            validateRuntimeDependencyClosure({
                entries: [
                    {
                        name: 'libmpv.so.2',
                        needed: ['libsurprise.so.1'],
                        rpath: [],
                        runpath: ['$ORIGIN'],
                    },
                ],
                runtimeFileNames: ['libmpv.so.2'],
                buildPrefix: '/tmp/iptvnator-prefix',
            }),
        /not bundled or allowlisted.*libsurprise\.so\.1/
    );
    for (const forbiddenRunpath of [
        '/tmp/iptvnator-prefix/lib',
        '/usr/local/lib',
        '$ORIGIN:/tmp/host-lib',
    ]) {
        assert.throws(
            () =>
                validateRuntimeDependencyClosure({
                    entries: [
                        {
                            name: 'libmpv.so.2',
                            needed: ['libc.so.6'],
                            rpath: [],
                            runpath: [forbiddenRunpath],
                        },
                    ],
                    runtimeFileNames: ['libmpv.so.2'],
                    buildPrefix: '/tmp/iptvnator-prefix',
                }),
            /RUNPATH/
        );
    }
});

test('materializes symlink aliases and hashes every runtime library', (t) => {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-linux-builder-')
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const libDir = path.join(root, 'lib');
    fs.mkdirSync(libDir);
    const contents = Buffer.from('fake-elf-runtime');
    fs.writeFileSync(path.join(libDir, 'libmpv.so.2.0.0'), contents);
    fs.symlinkSync('libmpv.so.2.0.0', path.join(libDir, 'libmpv.so.2'));
    fs.symlinkSync('libmpv.so.2', path.join(libDir, 'libmpv.so'));

    materializeLibrarySymlinks(libDir);

    for (const name of ['libmpv.so', 'libmpv.so.2', 'libmpv.so.2.0.0']) {
        const filePath = path.join(libDir, name);
        assert.equal(fs.lstatSync(filePath).isFile(), true);
        assert.deepEqual(fs.readFileSync(filePath), contents);
    }
    assert.deepEqual(createRuntimeFileRecords(libDir), [
        {
            name: 'libmpv.so',
            size: contents.length,
            sha256: crypto.createHash('sha256').update(contents).digest('hex'),
        },
        {
            name: 'libmpv.so.2',
            size: contents.length,
            sha256: crypto.createHash('sha256').update(contents).digest('hex'),
        },
        {
            name: 'libmpv.so.2.0.0',
            size: contents.length,
            sha256: crypto.createHash('sha256').update(contents).digest('hex'),
        },
    ]);
});

test('generates a hash-complete manifest accepted by the Linux validator', (t) => {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-linux-manifest-')
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const libDir = path.join(root, 'lib');
    fs.mkdirSync(libDir);
    fs.writeFileSync(path.join(libDir, 'libavcodec.so.62'), 'avcodec');
    fs.writeFileSync(path.join(libDir, 'libmpv.so.2'), 'mpv');
    const runtimeFiles = createRuntimeFileRecords(libDir);
    const sourceRecords = createPinnedSourceRecords();
    const manifest = createLinuxRuntimeManifest({
        sourceRecords,
        runtimeFiles,
        dependencyClosure: {
            entries: [
                {
                    name: 'libavcodec.so.62',
                    needed: ['libm.so.6'],
                    rpath: [],
                    runpath: ['$ORIGIN'],
                },
                {
                    name: 'libmpv.so.2',
                    needed: ['libavcodec.so.62', 'libEGL.so.1'],
                    rpath: [],
                    runpath: ['$ORIGIN'],
                },
            ],
            externalDependencies: ['libEGL.so.1', 'libm.so.6'],
        },
        buildHost: {
            platform: 'linux',
            arch: 'x64',
            release: 'fixture-kernel',
            systemPkgConfigDirs: [...DEFAULT_SYSTEM_PKG_CONFIG_DIRS],
            systemPkgConfigPackages: Object.fromEntries(
                EXPECTED_SYSTEM_PKG_CONFIG_PACKAGES.map((packageName) => [
                    packageName,
                    `${packageName} fixture version`,
                ])
            ),
            tools: Object.fromEntries(
                REQUIRED_TOOLS.map((tool) => [tool, `${tool} fixture version`])
            ),
        },
        generatedAt: '2026-07-17T00:00:00.000Z',
    });

    assert.deepEqual(validateLinuxRuntimeManifest(manifest), []);
    assert.equal(
        manifest.runtimeTotalBytes,
        runtimeFiles.reduce((total, runtimeFile) => total + runtimeFile.size, 0)
    );
    assert.deepEqual(manifest.runtimeDependencyClosure.externalDependencies, [
        'libEGL.so.1',
        'libm.so.6',
    ]);
    assert.deepEqual(
        manifest.externalSystemLibraries,
        EXTERNAL_SYSTEM_LIBRARIES
    );
    assert.deepEqual(
        Object.keys(manifest.buildHost.systemPkgConfigPackages),
        EXPECTED_SYSTEM_PKG_CONFIG_PACKAGES
    );
    for (const sourcePackage of SOURCE_PACKAGES) {
        if (sourcePackage.sourceKind === 'archive') {
            assert.equal(
                manifest.packages[sourcePackage.id].sourceSha256,
                sourcePackage.expectedSha256
            );
        }
    }
    assert.equal(
        manifest.packages.libplacebo.sourceGitCommit,
        SOURCE_PACKAGES.find(({ id }) => id === 'libplacebo').expectedGitCommit
    );
    assert.doesNotMatch(manifest.sourceDistribution, /TBD|TODO/i);
    assert.match(manifest.sourceDistribution, /source archives/i);
});

test('guards the CLI to Linux x64 and requires exactly one output prefix', () => {
    assert.deepEqual(
        parseCliInvocation({
            platform: 'linux',
            arch: 'x64',
            argv: ['/tmp/runtime'],
            cwd: '/workspace',
        }),
        { prefix: '/tmp/runtime' }
    );
    assert.deepEqual(
        parseCliInvocation({
            platform: 'linux',
            arch: 'x64',
            argv: ['--', 'relative/runtime'],
            cwd: '/workspace',
        }),
        { prefix: '/workspace/relative/runtime' }
    );
    assert.throws(
        () =>
            parseCliInvocation({
                platform: 'darwin',
                arch: 'x64',
                argv: ['/tmp/runtime'],
                cwd: '/workspace',
            }),
        /supported on Linux x64 only.*darwin\/x64/
    );
    assert.throws(
        () =>
            parseCliInvocation({
                platform: 'linux',
                arch: 'arm64',
                argv: ['/tmp/runtime'],
                cwd: '/workspace',
            }),
        /supported on Linux x64 only.*linux\/arm64/
    );
    for (const argv of [[], ['/one', '/two']]) {
        assert.throws(
            () =>
                parseCliInvocation({
                    platform: 'linux',
                    arch: 'x64',
                    argv,
                    cwd: '/workspace',
                }),
            /Usage: node tools\/embedded-mpv\/build-linux-runtime\.mjs <output-prefix>/
        );
    }
});

test('does not execute the Linux build when the entrypoint is imported', async () => {
    await assert.doesNotReject(() => import(pathToFileURL(builderScript).href));
});

test('patches every materialized ELF runtime to ORIGIN before validating closure', () => {
    const builderSource = fs.readFileSync(builderScript, 'utf8');
    assert.match(
        builderSource,
        /run\('patchelf', \['--set-rpath', '\$ORIGIN', libraryPath\]\)/
    );
    assert.match(
        builderSource,
        /runCapture\('readelf', \['-d', libraryPath\]\)/
    );
    assert.match(builderSource, /materializeLibrarySymlinks\(libDir\)/);
    assert.match(builderSource, /validateRuntimeDependencyClosure\(\{/);
    assert.match(builderSource, /createRuntimeFileRecords\(libDir\)/);
    assert.match(builderSource, /runtime-manifest\.json/);
    assert.match(builderSource, /validateLinuxRuntimeManifest\(manifest\)/);
});

test('registers the builder script and focused test with package and Nx', () => {
    const packageMetadata = JSON.parse(
        fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8')
    );
    assert.equal(
        packageMetadata.scripts['embedded-mpv:build-runtime:linux'],
        'node tools/embedded-mpv/build-linux-runtime.mjs'
    );

    const packagingProject = JSON.parse(
        fs.readFileSync(
            path.join(workspaceRoot, 'tools', 'packaging', 'project.json'),
            'utf8'
        )
    );
    const inputs = packagingProject.targets.test.inputs;
    for (const registeredInput of [
        '{workspaceRoot}/tools/embedded-mpv/build-linux-runtime.cjs',
        '{workspaceRoot}/tools/embedded-mpv/build-linux-runtime.mjs',
        '{workspaceRoot}/tools/embedded-mpv/build-linux-runtime.test.mjs',
    ]) {
        assert.ok(inputs.includes(registeredInput), registeredInput);
    }
    assert.match(
        packagingProject.targets.test.options.command,
        /tools\/embedded-mpv\/build-linux-runtime\.test\.mjs/
    );
});
