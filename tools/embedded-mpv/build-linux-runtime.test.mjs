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
    MINIMUM_TOOL_VERSIONS,
    MPV_MESON_FLAGS,
    OUTPUT_OWNERSHIP_MARKER,
    PORTABLE_ABI_BASELINE,
    REQUIRED_TOOLS,
    RUNTIME_EXTERNAL_CONFIGURATION,
    SOURCE_PACKAGES,
    assertArchiveMatchesPin,
    assertGitCommitMatchesPin,
    assertMinimumToolVersions,
    assertOwnedOutputDestination,
    assertPortableAbiRecords,
    assertPortableBuildHostGlibc,
    assertUniqueMesonOptionAssignments,
    createBuildEnvironment,
    createLinuxRuntimeManifest,
    createOwnedStagingPrefix,
    createRuntimeFileRecords,
    materializeLibrarySymlinks,
    parseCliInvocation,
    parseReadelfDynamic,
    parseReadelfVersionInfo,
    preparePinnedHwdataBuildInput,
    publishOwnedOutput,
    retainRuntimeLibraries,
    resolveLinuxPackageBuildEnvironment,
    resolveSystemPkgConfigDirs,
    selectReachableRuntimeLibraryNames,
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
            { id: 'hwdata', version: '0.409' },
            { id: 'libdisplay-info', version: '0.1.1' },
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
    assert.deepEqual(byId.get('hwdata'), {
        id: 'hwdata',
        version: '0.409',
        sourceKind: 'archive',
        sourceUrl:
            'https://github.com/vcrhonek/hwdata/archive/refs/tags/v0.409.tar.gz',
        expectedSha256:
            '23006accc0f931dd5187d0307a57d0744e2b8feb85e73c37bc0f5229fb31eadd',
        license: 'GPL-2.0-or-later OR XFree86-1.0',
        buildInput: {
            consumer: 'libdisplay-info',
            relativePath: 'pnp.ids',
            purpose: 'PNP vendor lookup table compiled into libdisplay-info.',
        },
    });
    assert.deepEqual(byId.get('libdisplay-info'), {
        id: 'libdisplay-info',
        version: '0.1.1',
        sourceKind: 'archive',
        sourceUrl:
            'https://gitlab.freedesktop.org/emersion/libdisplay-info/-/releases/0.1.1/downloads/libdisplay-info-0.1.1.tar.xz',
        expectedSha256:
            '0d8731588e9f82a9cac96324a3d7c82e2ba5b1b5e006143fefe692c74069fb60',
        license: 'MIT',
    });
    assert.ok(
        BUILD_ORDER.indexOf('hwdata') < BUILD_ORDER.indexOf('libdisplay-info')
    );
    assert.ok(
        BUILD_ORDER.indexOf('libdisplay-info') < BUILD_ORDER.indexOf('mpv')
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
        hwdata: '23006accc0f931dd5187d0307a57d0744e2b8feb85e73c37bc0f5229fb31eadd',
        libass: 'eae425da50f0015c21f7b3a9c7262a910f0218af469e22e2931462fed3c50959',
        'libdisplay-info':
            '0d8731588e9f82a9cac96324a3d7c82e2ba5b1b5e006143fefe692c74069fb60',
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
        '-Dxml-backend=expat',
        '-Dbaseconfig-dir=/etc/fonts',
        '-Dconfig-dir=/etc/fonts/conf.d',
        '-Dtemplate-dir=/usr/share/fontconfig/conf.avail',
        '-Dcache-dir=/var/cache/fontconfig',
        '-Dxml-dir=/usr/share/xml/fontconfig',
    ]) {
        assert.ok(BUILD_RECIPES.fontconfig.args.includes(flag), flag);
    }
    assert.ok(BUILD_RECIPES.libass.args.includes('--enable-fontconfig'));
    assert.equal(
        BUILD_RECIPES.libass.args.includes('--disable-fontconfig'),
        false
    );
    for (const flag of [
        'shared',
        'no-apps',
        'no-docs',
        'no-tests',
        '--openssldir=/etc/ssl',
    ]) {
        assert.ok(BUILD_RECIPES.openssl.args.includes(flag), flag);
    }
    assert.ok(
        BUILD_ORDER.indexOf('fontconfig') < BUILD_ORDER.indexOf('libass')
    );
    assert.ok(BUILD_ORDER.indexOf('openssl') < BUILD_ORDER.indexOf('ffmpeg'));
    assert.equal(BUILD_RECIPES.hwdata.buildSystem, 'data');
    assert.equal(BUILD_RECIPES.hwdata.sharedOnly, false);
    assert.equal(BUILD_RECIPES['libdisplay-info'].buildSystem, 'meson');
    for (const packageId of BUILD_ORDER.filter(
        (packageId) => packageId !== 'hwdata'
    )) {
        assert.equal(BUILD_RECIPES[packageId].sharedOnly, true, packageId);
    }
});

test('stages pinned hwdata and excludes host pkg-config fallback', (t) => {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-pinned-hwdata-')
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const sourcePath = path.join(root, 'sources', 'hwdata');
    const prefix = path.join(root, 'runtime');
    fs.mkdirSync(sourcePath, { recursive: true });
    const pnpIds = 'ABC Example Display Vendor\n';
    fs.writeFileSync(path.join(sourcePath, 'pnp.ids'), pnpIds);

    const invocations = [];
    const buildEnvironment = {
        PATH: '/usr/bin',
        PKG_CONFIG_PATH: '/host/pkgconfig',
        PKG_CONFIG_LIBDIR:
            '/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/share/pkgconfig',
    };
    const pinnedEnvironment = preparePinnedHwdataBuildInput({
        buildEnvironment,
        prefix,
        runCapture(command, args, options) {
            invocations.push({ args, command, env: options.env });
            assert.equal(options.env.PKG_CONFIG_PATH.includes('/host'), false);
            assert.equal(options.env.PKG_CONFIG_LIBDIR.includes('/usr'), false);
            if (args[0] === '--variable=pcfiledir') {
                return path.join(prefix, 'share', 'pkgconfig');
            }
            if (args[0] === '--variable=pkgdatadir') {
                return path.join(prefix, 'share', 'hwdata');
            }
            if (args[0] === '--modversion') {
                return '0.409';
            }
            throw new Error(`Unexpected pkg-config query: ${args.join(' ')}`);
        },
        sourcePath,
    });

    assert.equal(
        fs.readFileSync(
            path.join(prefix, 'share', 'hwdata', 'pnp.ids'),
            'utf8'
        ),
        pnpIds
    );
    const pkgConfig = fs.readFileSync(
        path.join(prefix, 'share', 'pkgconfig', 'hwdata.pc'),
        'utf8'
    );
    assert.match(pkgConfig, /^Version: 0\.409$/m);
    assert.match(
        pkgConfig,
        new RegExp(
            `^pkgdatadir=${path
                .join(prefix, 'share', 'hwdata')
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
            'm'
        )
    );
    assert.doesNotMatch(pkgConfig, /\/usr\/share\/hwdata/);
    assert.equal(pinnedEnvironment.PKG_CONFIG_PATH.includes('/host'), false);
    assert.equal(pinnedEnvironment.PKG_CONFIG_LIBDIR.includes('/usr'), false);
    assert.equal(
        resolveLinuxPackageBuildEnvironment('libdisplay-info', {
            buildEnvironment,
            hwdataBuildEnvironment: pinnedEnvironment,
        }),
        pinnedEnvironment
    );
    assert.equal(
        resolveLinuxPackageBuildEnvironment('mpv', {
            buildEnvironment,
            hwdataBuildEnvironment: pinnedEnvironment,
        }),
        buildEnvironment
    );
    assert.throws(
        () =>
            resolveLinuxPackageBuildEnvironment('libdisplay-info', {
                buildEnvironment,
            }),
        /libdisplay-info.*pinned hwdata/i
    );
    assert.deepEqual(
        invocations.map(({ args, command }) => [command, ...args]),
        [
            ['pkg-config', '--variable=pcfiledir', 'hwdata'],
            ['pkg-config', '--variable=pkgdatadir', 'hwdata'],
            ['pkg-config', '--modversion', 'hwdata'],
        ]
    );

    assert.throws(
        () =>
            preparePinnedHwdataBuildInput({
                buildEnvironment,
                prefix: path.join(root, 'rejected-runtime'),
                runCapture(_command, args) {
                    return args[0] === '--modversion'
                        ? '0.409'
                        : '/usr/share/hwdata';
                },
                sourcePath,
            }),
        /pinned hwdata.*host|host.*hwdata|resolved outside/i
    );
});

test('rejects duplicate option assignments in every Meson recipe', () => {
    assert.doesNotThrow(() =>
        assertUniqueMesonOptionAssignments(BUILD_RECIPES)
    );

    for (const [packageId, duplicateFlag] of [
        ['fontconfig', '-Dxml-backend=libxml2'],
        ['libplacebo', '-Dvulkan=enabled'],
    ]) {
        const duplicateRecipes = {
            ...BUILD_RECIPES,
            [packageId]: {
                ...BUILD_RECIPES[packageId],
                args: [...BUILD_RECIPES[packageId].args, duplicateFlag],
            },
        };
        assert.throws(
            () => assertUniqueMesonOptionAssignments(duplicateRecipes),
            new RegExp(
                `${packageId}.*${duplicateFlag.split('=')[0]}.*once`,
                'i'
            )
        );
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

test('rejects an existing unmarked output without changing its contents', (t) => {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-output-ownership-')
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const outputPrefix = path.join(root, 'usr', 'local');
    fs.mkdirSync(outputPrefix, { recursive: true });
    fs.writeFileSync(path.join(outputPrefix, 'keep-me'), 'untouched');

    assert.throws(
        () => assertOwnedOutputDestination(outputPrefix),
        /existing output.*ownership marker/i
    );
    assert.equal(
        fs.readFileSync(path.join(outputPrefix, 'keep-me'), 'utf8'),
        'untouched'
    );
});

test('atomically publishes only owned outputs and rolls back failures', (t) => {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-output-publish-')
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const outputPrefix = path.join(root, 'runtime');
    fs.mkdirSync(outputPrefix);
    fs.writeFileSync(
        path.join(outputPrefix, OUTPUT_OWNERSHIP_MARKER),
        'iptvnator-embedded-mpv-linux-runtime-v1\n'
    );
    fs.writeFileSync(path.join(outputPrefix, 'state'), 'previous');

    const failedStagingPrefix = createOwnedStagingPrefix(outputPrefix, {
        token: 'failed',
    });
    fs.writeFileSync(path.join(failedStagingPrefix, 'state'), 'replacement');
    let renameCount = 0;
    const failingFileSystem = {
        ...fs,
        renameSync(source, destination) {
            renameCount += 1;
            if (renameCount === 2) {
                throw new Error('injected publication failure');
            }
            return fs.renameSync(source, destination);
        },
    };
    assert.throws(
        () =>
            publishOwnedOutput({
                fileSystem: failingFileSystem,
                outputPrefix,
                stagingPrefix: failedStagingPrefix,
                token: 'rollback',
            }),
        /injected publication failure/
    );
    assert.equal(
        fs.readFileSync(path.join(outputPrefix, 'state'), 'utf8'),
        'previous'
    );
    assert.equal(fs.existsSync(failedStagingPrefix), false);
    assert.deepEqual(
        fs.readdirSync(root).filter((name) => name.includes('backup')),
        []
    );

    const successfulStagingPrefix = createOwnedStagingPrefix(outputPrefix, {
        token: 'successful',
    });
    fs.writeFileSync(
        path.join(successfulStagingPrefix, 'state'),
        'replacement'
    );
    publishOwnedOutput({
        outputPrefix,
        stagingPrefix: successfulStagingPrefix,
        token: 'success',
    });
    assert.equal(
        fs.readFileSync(path.join(outputPrefix, 'state'), 'utf8'),
        'replacement'
    );
    assert.equal(
        fs.readFileSync(
            path.join(outputPrefix, OUTPUT_OWNERSHIP_MARKER),
            'utf8'
        ),
        'iptvnator-embedded-mpv-linux-runtime-v1\n'
    );
});

test('builds in an owned sibling before atomically publishing output', () => {
    const builderSource = fs.readFileSync(builderScript, 'utf8');
    assert.doesNotMatch(
        builderSource,
        /fs\.rmSync\(context\.prefix, \{ recursive: true, force: true \}\)/
    );
    const toolPreflight = builderSource.indexOf(
        'assertMinimumToolVersions(toolVersions)'
    );
    const stagingMutation = builderSource.indexOf(
        'createOwnedStagingPrefix(outputPrefix'
    );
    const publication = builderSource.indexOf('publishOwnedOutput({');
    assert.notEqual(stagingMutation, -1);
    assert.notEqual(publication, -1);
    assert.ok(toolPreflight < stagingMutation);
    assert.ok(stagingMutation < publication);
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
        'libdrm',
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
        'nasm',
        'ninja',
        'patchelf',
        'pkg-config',
        'readelf',
        'tar',
    ]) {
        assert.ok(REQUIRED_TOOLS.includes(tool), tool);
    }
});

test('preflights every required tool against a supported minimum version', () => {
    assert.deepEqual(
        Object.keys(MINIMUM_TOOL_VERSIONS).sort(),
        [...REQUIRED_TOOLS].sort()
    );
    assert.equal(MINIMUM_TOOL_VERSIONS.meson, '1.6.0');
    assert.equal(MINIMUM_TOOL_VERSIONS.nasm, '2.15.05');

    const supportedVersions = Object.fromEntries(
        REQUIRED_TOOLS.map((tool) => [
            tool,
            `${tool} ${MINIMUM_TOOL_VERSIONS[tool]}`,
        ])
    );
    assert.doesNotThrow(() => assertMinimumToolVersions(supportedVersions));

    const missingTool = { ...supportedVersions };
    delete missingTool.nasm;
    assert.throws(
        () => assertMinimumToolVersions(missingTool),
        /missing required tool version.*nasm/i
    );

    for (const [tool, oldVersion] of [
        ['meson', 'meson 1.5.9'],
        ['nasm', 'NASM version 2.15.04'],
    ]) {
        assert.throws(
            () =>
                assertMinimumToolVersions({
                    ...supportedVersions,
                    [tool]: oldVersion,
                }),
            new RegExp(`${tool}.*requires.*${MINIMUM_TOOL_VERSIONS[tool]}`, 'i')
        );
    }
});

test('completes tool and system-package preflight before filesystem mutation', () => {
    const builderSource = fs.readFileSync(builderScript, 'utf8');
    const buildRootMutation = builderSource.indexOf(
        'fs.mkdirSync(context.buildRoot'
    );
    const toolPreflight = builderSource.indexOf(
        'assertMinimumToolVersions(toolVersions)'
    );
    const packagePreflight = builderSource.indexOf(
        'verifySystemPkgConfigPackages(context)'
    );
    const mesonPolicyPreflight = builderSource.indexOf(
        'assertUniqueMesonOptionAssignments(BUILD_RECIPES)'
    );
    assert.notEqual(mesonPolicyPreflight, -1);
    assert.notEqual(toolPreflight, -1);
    assert.notEqual(packagePreflight, -1);
    assert.ok(mesonPolicyPreflight < buildRootMutation);
    assert.ok(toolPreflight < buildRootMutation);
    assert.ok(packagePreflight < buildRootMutation);
});

test('uses DESTDIR with standard fontconfig and OpenSSL runtime paths', () => {
    assert.deepEqual(RUNTIME_EXTERNAL_CONFIGURATION, {
        fontconfig: {
            configDirectory: '/etc/fonts',
            templateDirectory: '/usr/share/fontconfig',
            cacheDirectory: '/var/cache/fontconfig',
            ownership: 'system',
        },
        openssl: {
            configFile: '/etc/ssl/openssl.cnf',
            certificateFile: '/etc/ssl/cert.pem',
            certificateDirectory: '/etc/ssl/certs',
            ownership: 'system',
        },
    });
    assert.doesNotMatch(
        JSON.stringify(RUNTIME_EXTERNAL_CONFIGURATION),
        /build|prefix|tmp/i
    );

    const builderSource = fs.readFileSync(builderScript, 'utf8');
    assert.match(builderSource, /DESTDIR/);
    assert.match(builderSource, /installWithDestdir/);
    assert.doesNotMatch(
        builderSource,
        /--openssldir=\$\{path\.join\(context\.prefix/
    );
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
        '-Ddrm=enabled',
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
    assert.equal(MPV_MESON_FLAGS.includes('-Ddrm=disabled'), false);
    for (const optionName of ['drm', 'gbm', 'vaapi-drm']) {
        const assignments = MPV_MESON_FLAGS.filter((flag) =>
            flag.startsWith(`-D${optionName}=`)
        );
        assert.deepEqual(assignments, [`-D${optionName}=enabled`]);
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
 0x000000000000000e (SONAME)             Library soname: [libmpv.so.2]
 0x0000000000000001 (NEEDED)             Shared library: [libavcodec.so.62]
 0x0000000000000001 (NEEDED)             Shared library: [libEGL.so.1]
 0x0000000000000001 (NEEDED)             Shared library: [libc.so.6]
 0x000000000000001d (RUNPATH)            Library runpath: [$ORIGIN]
`);
    assert.deepEqual(mpvDynamic, {
        needed: ['libEGL.so.1', 'libavcodec.so.62', 'libc.so.6'],
        rpath: [],
        runpath: ['$ORIGIN'],
        soname: 'libmpv.so.2',
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
    assert.equal(closure.entries[1].soname, 'libmpv.so.2');

    const aliasClosure = validateRuntimeDependencyClosure({
        entries: [
            {
                name: 'libmpv.so',
                ...mpvDynamic,
            },
            {
                name: 'libmpv.so.2',
                ...mpvDynamic,
            },
            {
                name: 'libavcodec.so.62',
                needed: ['libm.so.6'],
                rpath: [],
                runpath: ['$ORIGIN'],
                soname: 'libavcodec.so.62',
            },
        ],
        runtimeFileNames: ['libavcodec.so.62', 'libmpv.so', 'libmpv.so.2'],
        buildPrefix: '/tmp/iptvnator-prefix',
    });
    assert.equal(
        aliasClosure.entries.find(({ name }) => name === 'libmpv.so').soname,
        'libmpv.so.2'
    );
    assert.throws(
        () =>
            validateRuntimeDependencyClosure({
                entries: aliasClosure.entries.map((entry) =>
                    entry.name === 'libmpv.so'
                        ? { ...entry, soname: 'libmpv.so.99' }
                        : entry
                ),
                runtimeFileNames: [
                    'libavcodec.so.62',
                    'libmpv.so',
                    'libmpv.so.2',
                ],
                buildPrefix: '/tmp/iptvnator-prefix',
            }),
        /libmpv\.so must declare a versioned SONAME present in the runtime closure/
    );

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

test('retains only the reachable SONAME closure plus the libmpv linker alias', (t) => {
    const entries = [
        {
            name: 'libmpv.so',
            soname: 'libmpv.so.2',
            needed: ['libavcodec.so.62', 'libc.so.6'],
        },
        {
            name: 'libmpv.so.2',
            soname: 'libmpv.so.2',
            needed: ['libavcodec.so.62', 'libc.so.6'],
        },
        {
            name: 'libmpv.so.2.0.0',
            soname: 'libmpv.so.2',
            needed: ['libavcodec.so.62', 'libc.so.6'],
        },
        {
            name: 'libavcodec.so',
            soname: 'libavcodec.so.62',
            needed: ['libm.so.6'],
        },
        {
            name: 'libavcodec.so.62',
            soname: 'libavcodec.so.62',
            needed: ['libm.so.6'],
        },
        {
            name: 'libavcodec.so.62.1.0',
            soname: 'libavcodec.so.62',
            needed: ['libm.so.6'],
        },
        {
            name: 'libunused.so.1',
            soname: 'libunused.so.1',
            needed: ['libc.so.6'],
        },
    ];
    const retainedNames = selectReachableRuntimeLibraryNames(entries);
    assert.deepEqual(retainedNames, [
        'libavcodec.so.62',
        'libmpv.so',
        'libmpv.so.2',
    ]);

    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-runtime-prune-')
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const libDir = path.join(root, 'lib');
    fs.mkdirSync(libDir);
    fs.writeFileSync(path.join(libDir, 'libmpv.so.2.0.0'), 'mpv');
    fs.symlinkSync('libmpv.so.2.0.0', path.join(libDir, 'libmpv.so.2'));
    fs.symlinkSync('libmpv.so.2', path.join(libDir, 'libmpv.so'));
    fs.writeFileSync(path.join(libDir, 'libavcodec.so.62.1.0'), 'codec');
    fs.symlinkSync(
        'libavcodec.so.62.1.0',
        path.join(libDir, 'libavcodec.so.62')
    );
    fs.symlinkSync('libavcodec.so.62', path.join(libDir, 'libavcodec.so'));
    fs.writeFileSync(path.join(libDir, 'libunused.so.1'), 'unused');

    retainRuntimeLibraries(libDir, retainedNames);
    assert.deepEqual(fs.readdirSync(libDir).sort(), retainedNames);
    for (const retainedName of retainedNames) {
        assert.equal(
            fs.lstatSync(path.join(libDir, retainedName)).isFile(),
            true,
            retainedName
        );
    }
});

test('enforces the Ubuntu 22.04 GLIBC and GLIBCXX symbol ceilings', () => {
    assert.deepEqual(PORTABLE_ABI_BASELINE, {
        distribution: 'Ubuntu 22.04',
        glibcMaximum: '2.35',
        glibcxxMaximum: '3.4.30',
    });
    const record = parseReadelfVersionInfo(
        `
  0x0010:   Name: GLIBC_2.2.5  Flags: none  Version: 7
  0x0020:   Name: GLIBC_2.34   Flags: none  Version: 5
  0x0030:   Name: GLIBCXX_3.4.21  Flags: none  Version: 4
  0x0040:   Name: GLIBCXX_3.4.29  Flags: none  Version: 3
`,
        'libmpv.so.2'
    );
    assert.deepEqual(record, {
        name: 'libmpv.so.2',
        requiredGlibc: '2.34',
        requiredGlibcxx: '3.4.29',
    });
    assert.doesNotThrow(() => assertPortableAbiRecords([record]));

    for (const [field, version] of [
        ['requiredGlibc', '2.36'],
        ['requiredGlibcxx', '3.4.31'],
    ]) {
        assert.throws(
            () =>
                assertPortableAbiRecords([
                    {
                        ...record,
                        [field]: version,
                    },
                ]),
            /portable ABI baseline.*newer symbol/i
        );
    }
});

test('rejects build hosts newer than the portable glibc baseline', () => {
    assert.doesNotThrow(() => assertPortableBuildHostGlibc('2.35'));
    assert.throws(
        () => assertPortableBuildHostGlibc('2.36'),
        /build host glibc 2\.36.*portable ABI baseline.*2\.35/i
    );
    assert.throws(
        () => assertPortableBuildHostGlibc(undefined),
        /unable to determine the Linux build host glibc version/i
    );
});

test('inspects every retained runtime file for portable symbol versions', () => {
    const builderSource = fs.readFileSync(builderScript, 'utf8');
    assert.match(
        builderSource,
        /runCapture\('readelf', \[\s*'--version-info',\s*libraryPath,\s*\]\)/
    );
    assert.match(builderSource, /retainRuntimeLibraries\(libDir,/);
    assert.match(builderSource, /assertPortableAbiRecords\(abiRecords\)/);
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
    fs.writeFileSync(path.join(libDir, 'libmpv.so'), 'mpv');
    fs.writeFileSync(path.join(libDir, 'libmpv.so.2'), 'mpv');
    const runtimeFiles = createRuntimeFileRecords(libDir);
    const sourceRecords = createPinnedSourceRecords();
    const abiRecords = runtimeFiles.map(({ name }) => ({
        name,
        requiredGlibc: '2.34',
        requiredGlibcxx: null,
    }));
    const manifest = createLinuxRuntimeManifest({
        sourceRecords,
        runtimeFiles,
        abiRecords,
        dependencyClosure: {
            entries: [
                {
                    name: 'libavcodec.so.62',
                    soname: 'libavcodec.so.62',
                    needed: ['libm.so.6'],
                    rpath: [],
                    runpath: ['$ORIGIN'],
                },
                {
                    name: 'libmpv.so',
                    soname: 'libmpv.so.2',
                    needed: ['libavcodec.so.62', 'libEGL.so.1'],
                    rpath: [],
                    runpath: ['$ORIGIN'],
                },
                {
                    name: 'libmpv.so.2',
                    soname: 'libmpv.so.2',
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
            glibcVersion: '2.35',
            systemPkgConfigDirs: [...DEFAULT_SYSTEM_PKG_CONFIG_DIRS],
            systemPkgConfigPackages: Object.fromEntries(
                EXPECTED_SYSTEM_PKG_CONFIG_PACKAGES.map((packageName) => [
                    packageName,
                    `${packageName} fixture version`,
                ])
            ),
            tools: Object.fromEntries(
                REQUIRED_TOOLS.map((tool) => [
                    tool,
                    `${tool} ${MINIMUM_TOOL_VERSIONS[tool]}`,
                ])
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
    assert.equal(
        manifest.runtimeDependencyClosure.entries.find(
            ({ name }) => name === 'libmpv.so'
        ).soname,
        'libmpv.so.2'
    );
    assert.deepEqual(
        manifest.externalSystemLibraries,
        EXTERNAL_SYSTEM_LIBRARIES
    );
    assert.deepEqual(manifest.runtimeAbi, {
        baseline: PORTABLE_ABI_BASELINE,
        files: abiRecords,
    });
    assert.deepEqual(
        manifest.runtimeExternalConfiguration,
        RUNTIME_EXTERNAL_CONFIGURATION
    );
    assert.equal(manifest.buildHost.glibcVersion, '2.35');
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
    assert.match(manifest.sourceDistribution, /libdisplay-info/i);
    assert.match(manifest.sourceDistribution, /hwdata/i);
    assert.match(manifest.sourceDistribution, /pnp\.ids/i);
    assert.deepEqual(manifest.packages.hwdata.buildInput, {
        consumer: 'libdisplay-info',
        relativePath: 'pnp.ids',
        purpose: 'PNP vendor lookup table compiled into libdisplay-info.',
    });
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
    assert.match(builderSource, /retainRuntimeLibraries\(libDir,/);
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
