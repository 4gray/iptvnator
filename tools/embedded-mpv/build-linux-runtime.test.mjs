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
    validateRuntimeDependencyClosure,
} = require('./build-linux-runtime.cjs');
const {
    validateLinuxRuntimeManifest,
} = require('./linux-runtime-manifest.cjs');

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

test('constructs a prefix-first build environment with only declared system interfaces', () => {
    const environment = createBuildEnvironment({
        prefix: '/opt/runtime',
        baseEnv: {
            PATH: '/usr/bin',
            CFLAGS: '-O2',
            LDFLAGS: '-Wl,--as-needed',
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
    assert.match(environment.CPPFLAGS, /-I\/opt\/runtime\/include/);
    assert.match(environment.CFLAGS, /-fPIC/);
    assert.match(environment.CFLAGS, /-O2/);
    assert.match(environment.LDFLAGS, /-L\/opt\/runtime\/lib/);
    assert.match(environment.LDFLAGS, /-Wl,--as-needed/);
    assert.equal(environment.LD_LIBRARY_PATH, '/opt/runtime/lib');
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
    const sourceRecords = Object.fromEntries(
        SOURCE_PACKAGES.map((sourcePackage, index) => [
            sourcePackage.id,
            {
                ...sourcePackage,
                ...(sourcePackage.sourceKind === 'git'
                    ? {
                          sourceGitCommit: String(index + 1)
                              .repeat(40)
                              .slice(0, 40),
                          sourceSubmodules: [
                              `${String(index + 2)
                                  .repeat(40)
                                  .slice(0, 40)} 3rdparty/example`,
                          ],
                      }
                    : { sourceSha256: String(index).repeat(64).slice(0, 64) }),
            },
        ])
    );
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
            tools: {
                cc: 'cc fixture',
                meson: '1.7.0',
                ninja: '1.12.1',
                patchelf: '0.18.0',
                readelf: 'GNU readelf fixture',
            },
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
