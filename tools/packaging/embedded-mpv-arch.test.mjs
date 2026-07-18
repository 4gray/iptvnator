import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
    DEFAULT_SYSTEM_PKG_CONFIG_DIRS,
    EXPECTED_SYSTEM_PKG_CONFIG_PACKAGES,
    MINIMUM_TOOL_VERSIONS,
    REQUIRED_TOOLS,
    SOURCE_PACKAGES,
    createLinuxRuntimeManifest,
} = require('../embedded-mpv/build-linux-runtime.cjs');
const {
    isForeignLinuxEmbeddedMpvArch,
    linuxUnpackedDirArch,
    resolveConfiguredLinuxTargetNames,
    resolveElectronBuilderArchName,
    validatePackagedEmbeddedMpv,
} = require('./embedded-mpv-packaging.cjs');
const {
    preparePackagedFrameCopyArtifacts,
} = require('./embedded-mpv-frame-copy-files.cjs');
const {
    LICENSE_PATHS_BY_PACKAGE,
    collectLinuxRuntimeLicenseInputs,
    generateLinuxRuntimeNotices,
} = require('../embedded-mpv/generate-linux-runtime-notices.cjs');
const {
    resolveLinuxFrameCopyPackagingContext,
} = require('./electron-after-pack.cjs');

const X64_ADDON_ENV = { IPTVNATOR_EMBEDDED_MPV_ARCH: 'x64' };
const SYSTEM_PACKAGE_DEPENDENCIES = {
    deb: ['libmpv2', 'libegl1', 'libopengl0', 'libgbm1'],
    rpm: ['mpv-libs', 'libglvnd-egl', 'libglvnd-opengl', 'mesa-libgbm'],
    pacman: ['mpv', 'libglvnd', 'mesa'],
};
const FRAME_COPY_ARTIFACTS = {
    addon: 'embedded_mpv.node',
    frameReader: 'embedded_mpv_frame_reader.node',
    helper: 'iptvnator_mpv_helper',
};

function sha256(contents) {
    return crypto.createHash('sha256').update(contents).digest('hex');
}

function sourcePackageRecord(sourcePackage) {
    return {
        version: sourcePackage.version,
        sourceUrl: sourcePackage.sourceUrl,
        ...(sourcePackage.sourceTag
            ? { sourceTag: sourcePackage.sourceTag }
            : {}),
        ...(sourcePackage.sourceKind === 'archive'
            ? { sourceSha256: sourcePackage.expectedSha256 }
            : {
                  sourceGitCommit: sourcePackage.expectedGitCommit,
                  sourceSubmodules: [`${'a'.repeat(40)} 3rdparty/example`],
              }),
        license: sourcePackage.license,
    };
}

function createSourceRuntime(runtimeContents) {
    const runtimeFiles = Object.entries(runtimeContents)
        .map(([name, contents]) => ({
            name,
            size: Buffer.byteLength(contents),
            sha256: sha256(contents),
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
    const runtimeNames = new Set(runtimeFiles.map(({ name }) => name));
    const entries = runtimeFiles.map(({ name }) => {
        const needed = name.startsWith('libmpv.so')
            ? [
                  ...(runtimeNames.has('libavcodec.so.61')
                      ? ['libavcodec.so.61']
                      : []),
                  'libEGL.so.1',
                  'libc.so.6',
              ]
            : ['libm.so.6'];
        return {
            name,
            soname: name === 'libmpv.so' ? 'libmpv.so.2' : null,
            needed: needed.sort(),
            rpath: [],
            runpath: ['$ORIGIN'],
        };
    });
    const externalDependencies = [
        ...new Set(
            entries
                .flatMap(({ needed }) => needed)
                .filter((name) => !runtimeNames.has(name))
        ),
    ].sort();
    const sourceRecords = Object.fromEntries(
        SOURCE_PACKAGES.map((sourcePackage) => [
            sourcePackage.id,
            {
                ...sourcePackage,
                ...sourcePackageRecord(sourcePackage),
            },
        ])
    );

    return createLinuxRuntimeManifest({
        sourceRecords,
        runtimeFiles,
        abiRecords: runtimeFiles.map(({ name }) => ({
            name,
            requiredGlibc: '2.34',
            requiredGlibcxx: null,
        })),
        dependencyClosure: {
            entries,
            externalDependencies,
        },
        buildHost: {
            platform: 'linux',
            arch: 'x64',
            release: 'fixture-kernel',
            glibcVersion: '2.35',
            systemPkgConfigDirs: [...DEFAULT_SYSTEM_PKG_CONFIG_DIRS],
            systemPkgConfigPackages: Object.fromEntries(
                EXPECTED_SYSTEM_PKG_CONFIG_PACKAGES.map((name) => [
                    name,
                    `${name}-fixture`,
                ])
            ),
            tools: Object.fromEntries(
                REQUIRED_TOOLS.map((name) => [
                    name,
                    `${name} ${MINIMUM_TOOL_VERSIONS[name]}`,
                ])
            ),
        },
        generatedAt: '2026-07-17T00:00:00.000Z',
    });
}

function createBuildManifest(runtimeContents) {
    const sourceRuntime = createSourceRuntime(runtimeContents);
    return {
        schemaVersion: 1,
        origin: 'linux-frame-copy-build',
        generatedAt: '2026-07-17T00:00:00.000Z',
        platform: 'linux',
        arch: 'x64',
        buildInputMode: 'bundled-runtime',
        sourceRuntimeValidated: true,
        allowedPackageRuntimeModes: ['system', 'bundled'],
        packageRuntimeAvailability: {
            system: true,
            bundled: true,
        },
        artifacts: { ...FRAME_COPY_ARTIFACTS },
        processIsolation: {
            addonLoadsLibmpv: false,
            helperLinksLibmpv: true,
            helperRunpath: ['$ORIGIN/lib'],
        },
        nativeViewFallback: 'process-isolated mpv --wid',
        libmpvSoname: 'libmpv.so.2',
        runtimeFiles: sourceRuntime.runtimeFiles.map((entry) => ({ ...entry })),
        runtimeTotalBytes: sourceRuntime.runtimeTotalBytes,
        sourceRuntime,
    };
}

function createNoticeFixture(fixtureRoot, sourceRuntime) {
    const sourceRoot = join(fixtureRoot, 'upstream-license-sources');
    for (const sourcePackage of SOURCE_PACKAGES) {
        for (const relativePath of LICENSE_PATHS_BY_PACKAGE[sourcePackage.id]) {
            const sourcePath = join(sourceRoot, sourcePackage.id, relativePath);
            fs.mkdirSync(dirname(sourcePath), { recursive: true });
            fs.writeFileSync(
                sourcePath,
                `verbatim ${sourcePackage.id} ${relativePath}\n`
            );
        }
    }
    const licenseInputRoot = join(fixtureRoot, 'license-inputs');
    const noticeSourceDir = join(fixtureRoot, 'generated-notices');
    collectLinuxRuntimeLicenseInputs({
        sourceRoot,
        outputRoot: licenseInputRoot,
        runtimeManifest: sourceRuntime,
    });
    generateLinuxRuntimeNotices({
        licenseInputRoot,
        outputRoot: noticeSourceDir,
        runtimeManifest: sourceRuntime,
    });
    return noticeSourceDir;
}

function createNativeFixture({
    runtimeContents = {
        'libavcodec.so.61': 'libavcodec-runtime',
        'libmpv.so': 'libmpv-runtime',
        'libmpv.so.2': 'libmpv-runtime',
    },
    buildManifest = createBuildManifest(runtimeContents),
} = {}) {
    const fixtureRoot = fs.mkdtempSync(
        join(os.tmpdir(), 'iptvnator-embedded-mpv-layout-')
    );
    const appOutDir = join(fixtureRoot, 'linux-unpacked');
    const resourceDir = join(appOutDir, 'resources');
    const nativeDir = join(
        resourceDir,
        'app.asar.unpacked',
        'electron-backend',
        'native'
    );
    fs.mkdirSync(join(nativeDir, 'lib'), { recursive: true });
    fs.writeFileSync(join(nativeDir, FRAME_COPY_ARTIFACTS.addon), 'addon');
    fs.writeFileSync(
        join(nativeDir, FRAME_COPY_ARTIFACTS.frameReader),
        'reader'
    );
    fs.writeFileSync(join(nativeDir, FRAME_COPY_ARTIFACTS.helper), 'helper', {
        mode: 0o644,
    });
    fs.writeFileSync(
        join(nativeDir, 'embedded-mpv-runtime.json'),
        `${JSON.stringify(buildManifest, null, 2)}\n`
    );
    for (const [name, contents] of Object.entries(runtimeContents)) {
        fs.writeFileSync(join(nativeDir, 'lib', name), contents);
    }
    const noticeSourceDir = createNoticeFixture(
        fixtureRoot,
        buildManifest.sourceRuntime
    );
    fs.cpSync(noticeSourceDir, nativeDir, { recursive: true });
    fs.writeFileSync(join(appOutDir, 'iptvnator.bin'), 'electron');
    return {
        fixtureRoot,
        resourceDir,
        appOutDir,
        nativeDir,
        noticeSourceDir,
    };
}

function readManifest(nativeDir) {
    return JSON.parse(
        fs.readFileSync(join(nativeDir, 'embedded-mpv-runtime.json'), 'utf8')
    );
}

function pureValidationOptions(options = {}) {
    return {
        platform: 'linux',
        required: true,
        foreignArch: false,
        hostPlatform: 'darwin',
        ...options,
    };
}

function validElfInspector(nativeDir, manifest, overrides = {}) {
    const libDir = join(nativeDir, 'lib');
    const records = new Map([
        ['iptvnator.bin', { needed: ['libc.so.6'], rpath: [], runpath: [] }],
        [
            FRAME_COPY_ARTIFACTS.addon,
            { needed: ['libX11.so.6'], rpath: [], runpath: [] },
        ],
        [
            FRAME_COPY_ARTIFACTS.frameReader,
            { needed: ['libc.so.6'], rpath: [], runpath: [] },
        ],
        [
            FRAME_COPY_ARTIFACTS.helper,
            {
                needed: [manifest.libmpvSoname, 'libEGL.so.1', 'libc.so.6'],
                rpath: [],
                runpath: ['$ORIGIN/lib'],
            },
        ],
    ]);
    for (const entry of manifest.runtimeDependencyClosure?.entries ?? []) {
        records.set(entry.name, {
            soname: entry.soname ?? null,
            needed: [...entry.needed],
            rpath: [...entry.rpath],
            runpath: [...entry.runpath],
        });
    }
    for (const [name, value] of Object.entries(overrides)) {
        records.set(name, value);
    }

    return (binaryPath) => {
        const name =
            dirname(binaryPath) === libDir
                ? basename(binaryPath)
                : basename(binaryPath);
        const record = records.get(name);
        if (!record) {
            throw new Error(`Missing ELF fixture for ${binaryPath}`);
        }
        return record;
    };
}

test('resolves the required Linux profile from afterPack targets before mutation', () => {
    assert.deepEqual(
        resolveLinuxFrameCopyPackagingContext(
            {
                electronPlatformName: 'linux',
                arch: 1,
                targets: [{ name: 'DEB' }, { name: 'rpm' }],
            },
            {
                required: true,
                environment: {
                    IPTVNATOR_LINUX_FRAME_COPY_PROFILE: 'system',
                    IPTVNATOR_EMBEDDED_MPV_ARCH: 'x64',
                },
            }
        ),
        {
            targetArch: 'x64',
            foreignArch: false,
            targetNames: ['deb', 'rpm'],
            profile: {
                name: 'system',
                runtimeMode: 'system',
                targets: ['deb', 'rpm', 'pacman'],
                manifestOrigin: 'system-libmpv-frame-copy',
            },
        }
    );
});

test('keeps every non-x64 Linux target marker-only even when the configured addon arch matches it', () => {
    const context = resolveLinuxFrameCopyPackagingContext(
        {
            electronPlatformName: 'linux',
            arch: 3,
            targets: [{ name: 'deb' }],
        },
        {
            required: true,
            environment: {
                IPTVNATOR_LINUX_FRAME_COPY_PROFILE: 'system',
                IPTVNATOR_EMBEDDED_MPV_ARCH: 'arm64',
            },
        }
    );

    assert.equal(context.targetArch, 'arm64');
    assert.equal(context.foreignArch, true);
});

test('rejects missing, mixed, and unknown required Linux packaging context', () => {
    const baseParams = {
        electronPlatformName: 'linux',
        arch: 1,
        targets: [{ name: 'deb' }],
    };

    assert.throws(
        () =>
            resolveLinuxFrameCopyPackagingContext(baseParams, {
                required: true,
                environment: { IPTVNATOR_EMBEDDED_MPV_ARCH: 'x64' },
            }),
        /Linux frame-copy profile is required/
    );
    assert.throws(
        () =>
            resolveLinuxFrameCopyPackagingContext(
                {
                    ...baseParams,
                    targets: [{ name: 'deb' }, { name: 'AppImage' }],
                },
                {
                    required: true,
                    environment: {
                        IPTVNATOR_LINUX_FRAME_COPY_PROFILE: 'system',
                        IPTVNATOR_EMBEDDED_MPV_ARCH: 'x64',
                    },
                }
            ),
        /cannot build target "appimage"/
    );
    assert.throws(
        () =>
            resolveLinuxFrameCopyPackagingContext(
                { ...baseParams, arch: 99 },
                {
                    required: true,
                    environment: {
                        IPTVNATOR_LINUX_FRAME_COPY_PROFILE: 'system',
                    },
                }
            ),
        /Unknown Electron Builder architecture/
    );
    assert.throws(
        () =>
            resolveLinuxFrameCopyPackagingContext(
                { ...baseParams, arch: 'mips64' },
                {
                    required: true,
                    environment: {
                        IPTVNATOR_LINUX_FRAME_COPY_PROFILE: 'system',
                    },
                }
            ),
        /Unknown Electron Builder architecture/
    );
    assert.throws(
        () =>
            resolveLinuxFrameCopyPackagingContext(baseParams, {
                required: true,
                environment: {
                    IPTVNATOR_EMBEDDED_MPV_ARCH: 'arm64',
                },
            }),
        /Linux frame-copy profile is required/
    );
});

test('validates a provided Linux profile even when embedded MPV is optional', () => {
    assert.throws(
        () =>
            resolveLinuxFrameCopyPackagingContext(
                {
                    electronPlatformName: 'linux',
                    arch: 1,
                    targets: [{ name: 'snap' }, { name: 'deb' }],
                },
                {
                    required: false,
                    environment: {
                        IPTVNATOR_LINUX_FRAME_COPY_PROFILE: 'portable',
                        IPTVNATOR_EMBEDDED_MPV_ARCH: 'x64',
                    },
                }
            ),
        /cannot build target "deb"/
    );
});

test('prepares a normalized system profile with no private runtime', (t) => {
    const fixture = createNativeFixture();
    t.after(() =>
        fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
    );
    fs.writeFileSync(
        join(fixture.nativeDir, 'iptvnator_mpv_helper.exe'),
        'stale'
    );
    fs.writeFileSync(
        join(fixture.nativeDir, 'embedded-mpv-unavailable.txt'),
        'stale'
    );

    const manifest = preparePackagedFrameCopyArtifacts(
        fixture.nativeDir,
        'linux',
        {
            profile: 'system',
            targetNames: ['deb', 'rpm', 'pacman'],
        }
    );

    assert.equal(manifest.profile, 'system');
    assert.equal(manifest.runtimeMode, 'system');
    assert.equal(manifest.origin, 'system-libmpv-frame-copy');
    assert.deepEqual(manifest.targets, ['deb', 'pacman', 'rpm']);
    assert.deepEqual(manifest.packageDependencies, SYSTEM_PACKAGE_DEPENDENCIES);
    assert.equal(manifest.libmpvSoname, 'libmpv.so.2');
    assert.deepEqual(manifest.runtimeFiles, []);
    assert.equal(manifest.runtimeTotalBytes, 0);
    assert.equal(fs.existsSync(join(fixture.nativeDir, 'lib')), false);
    assert.equal(
        fs.statSync(join(fixture.nativeDir, FRAME_COPY_ARTIFACTS.helper)).mode &
            0o777,
        0o755
    );
    assert.equal(
        fs.statSync(join(fixture.nativeDir, FRAME_COPY_ARTIFACTS.frameReader))
            .mode & 0o777,
        0o644
    );
    assert.equal(
        fs.existsSync(join(fixture.nativeDir, 'iptvnator_mpv_helper.exe')),
        false
    );
    assert.equal(
        fs.existsSync(join(fixture.nativeDir, 'embedded-mpv-unavailable.txt')),
        false
    );
    for (const legalPath of [
        'embedded-mpv-notices.json',
        'THIRD_PARTY_NOTICES.txt',
        'licenses',
    ]) {
        assert.equal(fs.existsSync(join(fixture.nativeDir, legalPath)), false);
    }
    assert.deepEqual(
        validatePackagedEmbeddedMpv(
            fixture.resourceDir,
            pureValidationOptions({
                profile: 'system',
                targetNames: ['deb', 'rpm', 'pacman'],
            })
        ),
        []
    );
});

test('prepares portable and Flatpak manifests with the exact bundled closure', (t) => {
    const portable = createNativeFixture();
    const flatpak = createNativeFixture();
    t.after(() => {
        for (const fixture of [portable, flatpak]) {
            fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
        }
    });
    for (const legalPath of [
        'embedded-mpv-notices.json',
        'THIRD_PARTY_NOTICES.txt',
        'licenses',
    ]) {
        fs.rmSync(join(portable.nativeDir, legalPath), {
            recursive: true,
            force: true,
        });
    }

    const portableManifest = preparePackagedFrameCopyArtifacts(
        portable.nativeDir,
        'linux',
        {
            profile: 'portable',
            targetNames: ['AppImage', 'SNAP'],
            noticeSourceDir: portable.noticeSourceDir,
        }
    );
    const flatpakManifest = preparePackagedFrameCopyArtifacts(
        flatpak.nativeDir,
        'linux',
        {
            profile: 'flatpak',
            targetNames: ['flatpak'],
        }
    );

    assert.equal(portableManifest.profile, 'portable');
    assert.equal(portableManifest.runtimeMode, 'bundled');
    assert.equal(portableManifest.origin, 'bundled-lgpl-frame-copy');
    assert.deepEqual(portableManifest.targets, ['appimage', 'snap']);
    assert.deepEqual(portableManifest.packageDependencies, {});
    assert.deepEqual(
        portableManifest.runtimeFiles.map(({ name }) => name).sort(),
        ['libavcodec.so.61', 'libmpv.so', 'libmpv.so.2']
    );
    assert.equal(
        portableManifest.runtimeTotalBytes,
        portableManifest.runtimeFiles.reduce(
            (total, runtimeFile) => total + runtimeFile.size,
            0
        )
    );
    assert.equal(
        portableManifest.sourceRuntime.origin,
        'vendored-lgpl-source-build'
    );
    assert.ok(portableManifest.sourceRuntime.packages.ffmpeg.sourceSha256);
    assert.ok(
        portableManifest.sourceRuntime.ffmpeg.configureFlags.includes(
            '--disable-gpl'
        )
    );
    const notices = JSON.parse(
        fs.readFileSync(
            join(portable.nativeDir, 'embedded-mpv-notices.json'),
            'utf8'
        )
    );
    assert.equal(notices.schemaVersion, 1);
    assert.equal(notices.origin, 'pinned-linux-runtime-upstream-licenses');
    assert.equal(notices.noticeFile.path, 'THIRD_PARTY_NOTICES.txt');
    assert.deepEqual(
        notices.packages.map(({ id }) => id),
        SOURCE_PACKAGES.map(({ id }) => id).sort()
    );
    assert.ok(notices.packages.every(({ files }) => files.length >= 1));
    assert.equal(flatpakManifest.profile, 'flatpak');
    assert.equal(flatpakManifest.runtimeMode, 'bundled');
    assert.equal(flatpakManifest.origin, 'bundled-lgpl-frame-copy');
    assert.deepEqual(
        validatePackagedEmbeddedMpv(
            portable.resourceDir,
            pureValidationOptions({
                profile: 'portable',
                targetNames: ['appimage', 'snap'],
            })
        ),
        []
    );
    assert.deepEqual(
        validatePackagedEmbeddedMpv(
            flatpak.resourceDir,
            pureValidationOptions({
                profile: 'flatpak',
                targetNames: ['flatpak'],
            })
        ),
        []
    );
});

test('rejects missing, tampered, undeclared, and symlinked bundled legal files', (t) => {
    const fixture = createNativeFixture();
    t.after(() =>
        fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
    );
    const manifest = preparePackagedFrameCopyArtifacts(
        fixture.nativeDir,
        'linux',
        {
            profile: 'portable',
            targetNames: ['appimage'],
        }
    );
    const options = pureValidationOptions({
        profile: 'portable',
        targetNames: ['appimage'],
        hostPlatform: 'linux',
        elfInspector: validElfInspector(fixture.nativeDir, manifest),
    });
    const notices = JSON.parse(
        fs.readFileSync(
            join(fixture.nativeDir, 'embedded-mpv-notices.json'),
            'utf8'
        )
    );
    const licensePath = join(
        fixture.nativeDir,
        notices.packages[0].files[0].path
    );
    const originalContents = fs.readFileSync(licensePath);

    fs.appendFileSync(licensePath, 'tampered\n');
    assert.match(
        validatePackagedEmbeddedMpv(fixture.resourceDir, options).join('\n'),
        /(?:Size|SHA-256) mismatch.*packaged license/i
    );

    fs.writeFileSync(licensePath, originalContents);
    fs.rmSync(licensePath);
    assert.match(
        validatePackagedEmbeddedMpv(fixture.resourceDir, options).join('\n'),
        /Missing .*packaged license/i
    );

    fs.writeFileSync(licensePath, originalContents);
    const undeclaredPath = join(fixture.nativeDir, 'licenses', 'stale.txt');
    fs.writeFileSync(undeclaredPath, 'stale\n');
    assert.match(
        validatePackagedEmbeddedMpv(fixture.resourceDir, options).join('\n'),
        /undeclared packaged legal file.*stale\.txt/i
    );

    fs.rmSync(undeclaredPath);
    fs.rmSync(licensePath);
    fs.symlinkSync(
        join(fixture.nativeDir, 'THIRD_PARTY_NOTICES.txt'),
        licensePath
    );
    assert.match(
        validatePackagedEmbeddedMpv(fixture.resourceDir, options).join('\n'),
        /packaged license.*symbolic link/i
    );
});

test('rejects invalid build provenance and incomplete bundled runtime input', (t) => {
    const extra = createNativeFixture();
    const missing = createNativeFixture();
    const invalidSource = createBuildManifest({
        'libavcodec.so.61': 'libavcodec-runtime',
        'libmpv.so': 'libmpv-runtime',
        'libmpv.so.2': 'libmpv-runtime',
    });
    invalidSource.sourceRuntime.ffmpeg.configureFlags.push('--enable-gpl');
    const invalid = createNativeFixture({ buildManifest: invalidSource });
    const unexpectedModeManifest = createBuildManifest({
        'libavcodec.so.61': 'libavcodec-runtime',
        'libmpv.so': 'libmpv-runtime',
        'libmpv.so.2': 'libmpv-runtime',
    });
    unexpectedModeManifest.allowedPackageRuntimeModes.push('development');
    const unexpectedMode = createNativeFixture({
        buildManifest: unexpectedModeManifest,
    });
    const wrongSonameManifest = createBuildManifest({
        'libavcodec.so.61': 'libavcodec-runtime',
        'libmpv.so': 'libmpv-runtime',
        'libmpv.so.2': 'libmpv-runtime',
    });
    wrongSonameManifest.libmpvSoname = 'libmpv.so.9';
    const wrongSoname = createNativeFixture({
        buildManifest: wrongSonameManifest,
    });
    t.after(() => {
        for (const fixture of [
            extra,
            missing,
            invalid,
            unexpectedMode,
            wrongSoname,
        ]) {
            fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
        }
    });
    fs.writeFileSync(join(extra.nativeDir, 'lib', 'libstale.so.1'), 'stale');
    fs.rmSync(join(missing.nativeDir, 'lib', 'libavcodec.so.61'));

    assert.throws(
        () =>
            preparePackagedFrameCopyArtifacts(extra.nativeDir, 'linux', {
                profile: 'portable',
                targetNames: ['appimage'],
            }),
        /undeclared bundled runtime file.*libstale\.so\.1/i
    );
    assert.throws(
        () =>
            preparePackagedFrameCopyArtifacts(missing.nativeDir, 'linux', {
                profile: 'flatpak',
                targetNames: ['flatpak'],
            }),
        /Missing bundled runtime file.*libavcodec\.so\.61/
    );
    assert.throws(
        () =>
            preparePackagedFrameCopyArtifacts(invalid.nativeDir, 'linux', {
                profile: 'portable',
                targetNames: ['snap'],
            }),
        /--enable-gpl/
    );
    assert.throws(
        () =>
            preparePackagedFrameCopyArtifacts(
                unexpectedMode.nativeDir,
                'linux',
                {
                    profile: 'portable',
                    targetNames: ['appimage'],
                }
            ),
        /allowedPackageRuntimeModes.*exactly/i
    );
    assert.throws(
        () =>
            preparePackagedFrameCopyArtifacts(wrongSoname.nativeDir, 'linux', {
                profile: 'portable',
                targetNames: ['appimage'],
            }),
        /derived from.*SONAME/i
    );
});

test('rejects profiled preparation without a concrete package target', (t) => {
    const fixture = createNativeFixture();
    t.after(() =>
        fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
    );

    assert.throws(
        () =>
            preparePackagedFrameCopyArtifacts(fixture.nativeDir, 'linux', {
                profile: 'portable',
                targetNames: [],
            }),
        /at least one target/
    );
});

test(
    'rejects symlinked frame-copy artifacts before chmod or packaging',
    { skip: process.platform === 'win32' },
    (t) => {
        const fixture = createNativeFixture();
        t.after(() =>
            fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
        );
        const readerPath = join(
            fixture.nativeDir,
            FRAME_COPY_ARTIFACTS.frameReader
        );
        fs.rmSync(readerPath);
        fs.symlinkSync(FRAME_COPY_ARTIFACTS.addon, readerPath);

        assert.throws(
            () =>
                preparePackagedFrameCopyArtifacts(fixture.nativeDir, 'linux', {
                    profile: 'system',
                    targetNames: ['deb'],
                }),
            /frame reader.*regular file/i
        );
        assert.equal(fs.lstatSync(readerPath).isSymbolicLink(), true);
    }
);

test('keeps optional unprofiled Linux packages explicitly native-view-only', (t) => {
    const fixture = createNativeFixture();
    t.after(() =>
        fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
    );

    const manifest = preparePackagedFrameCopyArtifacts(
        fixture.nativeDir,
        'linux'
    );

    assert.equal(manifest.origin, 'external-mpv-process');
    assert.equal(manifest.runtimeMode, 'native-view-only');
    assert.equal(manifest.frameCopyAvailable, false);
    assert.equal(
        fs.existsSync(join(fixture.nativeDir, FRAME_COPY_ARTIFACTS.addon)),
        true
    );
    assert.equal(
        fs.existsSync(join(fixture.nativeDir, FRAME_COPY_ARTIFACTS.helper)),
        false
    );
    assert.equal(
        fs.existsSync(
            join(fixture.nativeDir, FRAME_COPY_ARTIFACTS.frameReader)
        ),
        false
    );
    assert.equal(fs.existsSync(join(fixture.nativeDir, 'lib')), false);
    assert.notEqual(
        readManifest(fixture.nativeDir).origin,
        'linux-frame-copy-build'
    );
});

test('rejects incorrect artifact modes and profile mismatches deterministically', (t) => {
    const fixture = createNativeFixture();
    t.after(() =>
        fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
    );
    preparePackagedFrameCopyArtifacts(fixture.nativeDir, 'linux', {
        profile: 'system',
        targetNames: ['deb'],
    });
    fs.chmodSync(join(fixture.nativeDir, FRAME_COPY_ARTIFACTS.helper), 0o644);

    const modeErrors = validatePackagedEmbeddedMpv(
        fixture.resourceDir,
        pureValidationOptions({
            profile: 'system',
            targetNames: ['deb'],
        })
    );
    assert.match(modeErrors.join('\n'), /mode 0755/);

    fs.chmodSync(join(fixture.nativeDir, FRAME_COPY_ARTIFACTS.helper), 0o4755);
    assert.match(
        validatePackagedEmbeddedMpv(
            fixture.resourceDir,
            pureValidationOptions({
                profile: 'system',
                targetNames: ['deb'],
            })
        ).join('\n'),
        /mode 0755/
    );

    fs.chmodSync(join(fixture.nativeDir, FRAME_COPY_ARTIFACTS.helper), 0o755);
    const profileErrors = validatePackagedEmbeddedMpv(
        fixture.resourceDir,
        pureValidationOptions({
            profile: 'portable',
            targetNames: ['appimage'],
        })
    );
    assert.match(profileErrors.join('\n'), /profile.*portable.*system/i);
});

test('turns malformed packaged manifest JSON into a deterministic error', (t) => {
    const fixture = createNativeFixture();
    t.after(() =>
        fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
    );
    fs.writeFileSync(
        join(fixture.nativeDir, 'embedded-mpv-runtime.json'),
        '{not-json'
    );

    assert.doesNotThrow(() =>
        validatePackagedEmbeddedMpv(
            fixture.resourceDir,
            pureValidationOptions({
                profile: 'system',
                targetNames: ['deb'],
            })
        )
    );
    assert.match(
        validatePackagedEmbeddedMpv(
            fixture.resourceDir,
            pureValidationOptions({
                profile: 'system',
                targetNames: ['deb'],
            })
        ).join('\n'),
        /Invalid JSON in embedded MPV runtime manifest/
    );
});

test('validates Linux ELF process isolation, helper linkage, and bundled closure', (t) => {
    const fixture = createNativeFixture();
    t.after(() =>
        fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
    );
    const manifest = preparePackagedFrameCopyArtifacts(
        fixture.nativeDir,
        'linux',
        {
            profile: 'portable',
            targetNames: ['appimage'],
        }
    );
    const options = {
        platform: 'linux',
        required: true,
        foreignArch: false,
        profile: 'portable',
        targetNames: ['appimage'],
        hostPlatform: 'linux',
        elfInspector: validElfInspector(fixture.nativeDir, manifest),
    };

    assert.deepEqual(
        validatePackagedEmbeddedMpv(fixture.resourceDir, options),
        []
    );

    const addonLinkErrors = validatePackagedEmbeddedMpv(fixture.resourceDir, {
        ...options,
        elfInspector: validElfInspector(fixture.nativeDir, manifest, {
            [FRAME_COPY_ARTIFACTS.addon]: {
                needed: ['libmpv.so.2'],
                rpath: [],
                runpath: [],
            },
        }),
    });
    assert.match(addonLinkErrors.join('\n'), /must not link libmpv/);

    const pathBearingAddonLinkErrors = validatePackagedEmbeddedMpv(
        fixture.resourceDir,
        {
            ...options,
            elfInspector: validElfInspector(fixture.nativeDir, manifest, {
                [FRAME_COPY_ARTIFACTS.addon]: {
                    needed: ['/tmp/build/libmpv.so.2'],
                    rpath: [],
                    runpath: [],
                },
            }),
        }
    );
    assert.match(
        pathBearingAddonLinkErrors.join('\n'),
        /must not link libmpv.*\/tmp\/build\/libmpv\.so\.2/
    );

    const helperLinkErrors = validatePackagedEmbeddedMpv(fixture.resourceDir, {
        ...options,
        elfInspector: validElfInspector(fixture.nativeDir, manifest, {
            [FRAME_COPY_ARTIFACTS.helper]: {
                needed: ['libmpv.so.1'],
                rpath: [],
                runpath: ['$ORIGIN/lib'],
            },
        }),
    });
    assert.match(
        helperLinkErrors.join('\n'),
        /must directly need libmpv\.so\.2/
    );

    const unexpectedHelperLinkErrors = validatePackagedEmbeddedMpv(
        fixture.resourceDir,
        {
            ...options,
            elfInspector: validElfInspector(fixture.nativeDir, manifest, {
                [FRAME_COPY_ARTIFACTS.helper]: {
                    needed: [
                        manifest.libmpvSoname,
                        'libEGL.so.1',
                        'libc.so.6',
                        'libsurprise.so.1',
                    ],
                    rpath: [],
                    runpath: ['$ORIGIN/lib'],
                },
            }),
        }
    );
    assert.match(
        unexpectedHelperLinkErrors.join('\n'),
        /helper dependency is not bundled or allowlisted.*libsurprise\.so\.1/
    );

    const closureErrors = validatePackagedEmbeddedMpv(fixture.resourceDir, {
        ...options,
        elfInspector: validElfInspector(fixture.nativeDir, manifest, {
            'libavcodec.so.61': {
                needed: ['libsurprise.so.1'],
                rpath: [],
                runpath: ['/tmp/runtime-prefix'],
            },
        }),
    });
    assert.match(closureErrors.join('\n'), /RUNPATH must be exactly \$ORIGIN/);
    assert.match(
        closureErrors.join('\n'),
        /not bundled or allowlisted.*libsurprise\.so\.1/
    );

    fs.writeFileSync(
        join(fixture.appOutDir, 'libelectron-extra.so'),
        'electron library'
    );
    const electronLibraryErrors = validatePackagedEmbeddedMpv(
        fixture.resourceDir,
        {
            ...options,
            elfInspector: validElfInspector(fixture.nativeDir, manifest, {
                'libelectron-extra.so': {
                    needed: ['libmpv.so.2'],
                    rpath: [],
                    runpath: [],
                },
            }),
        }
    );
    assert.match(
        electronLibraryErrors.join('\n'),
        /Linux Electron library must not link libmpv.*libelectron-extra\.so/
    );
});

test('rejects undeclared helper dependencies in system-runtime packages', (t) => {
    const fixture = createNativeFixture();
    t.after(() =>
        fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
    );
    const manifest = preparePackagedFrameCopyArtifacts(
        fixture.nativeDir,
        'linux',
        {
            profile: 'system',
            targetNames: ['deb'],
        }
    );

    const errors = validatePackagedEmbeddedMpv(fixture.resourceDir, {
        platform: 'linux',
        required: true,
        foreignArch: false,
        profile: 'system',
        targetNames: ['deb'],
        hostPlatform: 'linux',
        elfInspector: validElfInspector(fixture.nativeDir, manifest, {
            [FRAME_COPY_ARTIFACTS.helper]: {
                needed: [
                    manifest.libmpvSoname,
                    'libEGL.so.1',
                    'libc.so.6',
                    'libsurprise.so.1',
                ],
                rpath: [],
                runpath: ['$ORIGIN/lib'],
            },
        }),
    });

    assert.match(
        errors.join('\n'),
        /helper dependency is not bundled or allowlisted.*libsurprise\.so\.1/
    );
});

test('resolveElectronBuilderArchName maps builder-util Arch enum values', () => {
    assert.equal(resolveElectronBuilderArchName(0), 'ia32');
    assert.equal(resolveElectronBuilderArchName(1), 'x64');
    assert.equal(resolveElectronBuilderArchName(2), 'armv7l');
    assert.equal(resolveElectronBuilderArchName(3), 'arm64');
    assert.equal(resolveElectronBuilderArchName('arm64'), 'arm64');
    assert.equal(resolveElectronBuilderArchName(99), null);
});

test('flags every non-x64 Linux package regardless of configured build arch', () => {
    assert.equal(
        isForeignLinuxEmbeddedMpvArch('linux', 3, X64_ADDON_ENV),
        true
    );
    assert.equal(
        isForeignLinuxEmbeddedMpvArch('linux', 'armv7l', X64_ADDON_ENV),
        true
    );
    assert.equal(
        isForeignLinuxEmbeddedMpvArch('linux', 'x64', X64_ADDON_ENV),
        false
    );
    assert.equal(
        isForeignLinuxEmbeddedMpvArch('linux', 'arm64', {
            IPTVNATOR_EMBEDDED_MPV_ARCH: 'arm64',
        }),
        true
    );
    // Only Linux fans out foreign arches from one dist tree.
    assert.equal(
        isForeignLinuxEmbeddedMpvArch('darwin', 'arm64', X64_ADDON_ENV),
        false
    );
    assert.equal(
        isForeignLinuxEmbeddedMpvArch('win32', 'arm64', X64_ADDON_ENV),
        false
    );
});

test('derives package arch from electron-builder Linux output directory names', () => {
    assert.equal(linuxUnpackedDirArch('linux-unpacked'), 'x64');
    assert.equal(linuxUnpackedDirArch('linux-arm64-unpacked'), 'arm64');
    assert.equal(linuxUnpackedDirArch('linux-armv7l-unpacked'), 'armv7l');
    assert.equal(linuxUnpackedDirArch('mac-arm64'), null);
    assert.equal(linuxUnpackedDirArch('win-unpacked'), null);
});

test('derives the exact selected Linux targets for each configured architecture', () => {
    const configuredTargets = [
        {
            target: 'AppImage',
            arch: ['x64', 'arm64'],
        },
        {
            target: 'deb',
            arch: ['x64'],
        },
        {
            target: 'Snap',
            arch: ['arm64'],
        },
        'rpm',
    ];

    assert.deepEqual(
        resolveConfiguredLinuxTargetNames(configuredTargets, 'x64'),
        ['appimage', 'deb', 'rpm']
    );
    assert.deepEqual(
        resolveConfiguredLinuxTargetNames(configuredTargets, 'arm64'),
        ['appimage', 'rpm', 'snap']
    );
});

function createResourceDir(files) {
    const resourceDir = fs.mkdtempSync(
        join(os.tmpdir(), 'iptvnator-embedded-mpv-arch-')
    );
    const nativeDir = join(
        resourceDir,
        'app.asar.unpacked',
        'electron-backend',
        'native'
    );
    fs.mkdirSync(nativeDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(join(nativeDir, name), content);
    }
    return resourceDir;
}

test('foreign-arch validation requires the unavailable marker and forbids the addon', (t) => {
    const withMarker = createResourceDir({
        'embedded-mpv-unavailable.txt': 'not bundled for arm64\n',
    });
    const withAddon = createResourceDir({
        'embedded-mpv-unavailable.txt': 'not bundled for arm64\n',
        'embedded_mpv.node': 'x64 machine code',
    });
    const empty = createResourceDir({});
    t.after(() => {
        for (const dir of [withMarker, withAddon, empty]) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    assert.deepEqual(
        validatePackagedEmbeddedMpv(withMarker, {
            platform: 'linux',
            required: true,
            foreignArch: true,
        }),
        []
    );

    const addonErrors = validatePackagedEmbeddedMpv(withAddon, {
        platform: 'linux',
        required: true,
        foreignArch: true,
    });
    assert.equal(addonErrors.length, 1);
    assert.match(addonErrors[0], /must not ship in foreign-architecture/);

    const markerErrors = validatePackagedEmbeddedMpv(empty, {
        platform: 'linux',
        required: true,
        foreignArch: true,
    });
    assert.equal(markerErrors.length, 1);
    assert.match(markerErrors[0], /unavailable marker/);
});

test('same-arch validation still requires the addon when embedded MPV is required', (t) => {
    const empty = createResourceDir({});
    t.after(() => fs.rmSync(empty, { recursive: true, force: true }));

    const errors = validatePackagedEmbeddedMpv(empty, {
        platform: 'linux',
        required: true,
        foreignArch: false,
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Missing embedded MPV native addon/);
});
