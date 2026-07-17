import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    LINUX_RUNTIME_MANIFEST_SCHEMA_VERSION,
    validateLinuxRuntimeManifest,
    validateLinuxSystemBuildInputManifest,
} = require('./linux-runtime-manifest.cjs');
const {
    DEFAULT_SYSTEM_PKG_CONFIG_DIRS,
    EXTERNAL_SYSTEM_LIBRARIES,
    EXPECTED_SYSTEM_PKG_CONFIG_PACKAGES,
    GLIBC_TOOLCHAIN_ALLOWLIST,
    REQUIRED_TOOLS,
    SOURCE_PACKAGES,
} = require('./build-linux-runtime.cjs');

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
const stageRuntimeScript = path.join(
    workspaceRoot,
    'tools',
    'embedded-mpv',
    'stage-runtime.mjs'
);
const stageRuntimeSource = fs.readFileSync(stageRuntimeScript, 'utf8');

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function runtimeFile(name, contents) {
    return {
        name,
        size: Buffer.byteLength(contents),
        sha256: sha256(contents),
    };
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

function createValidManifest(
    runtimeFiles = [
        runtimeFile('libmpv.so.2', 'libmpv-runtime'),
        runtimeFile('libavcodec.so.61', 'libavcodec-runtime'),
    ]
) {
    const packages = Object.fromEntries(
        SOURCE_PACKAGES.map((sourcePackage) => [
            sourcePackage.id,
            sourcePackageRecord(sourcePackage),
        ])
    );
    const runtimeNames = new Set(
        runtimeFiles
            .map((runtimeEntry) => runtimeEntry?.name)
            .filter((name) => typeof name === 'string')
    );
    const closureEntries = runtimeFiles
        .filter(
            (runtimeEntry) =>
                runtimeEntry && typeof runtimeEntry.name === 'string'
        )
        .map((runtimeEntry) => ({
            name: runtimeEntry.name,
            needed: runtimeEntry.name.startsWith('libmpv.so')
                ? [
                      ...(runtimeNames.has('libavcodec.so.61')
                          ? ['libavcodec.so.61']
                          : []),
                      'libEGL.so.1',
                      'libc.so.6',
                  ]
                : ['libm.so.6'],
            rpath: [],
            runpath: ['$ORIGIN'],
        }));
    const externalDependencies = [
        ...new Set(
            closureEntries
                .flatMap(({ needed }) => needed)
                .filter((neededName) => !runtimeNames.has(neededName))
        ),
    ].sort();

    return {
        schemaVersion: 1,
        origin: 'vendored-lgpl-source-build',
        platform: 'linux',
        arch: 'x64',
        packages,
        ffmpeg: {
            ...packages.ffmpeg,
            configureFlags: [
                '--enable-shared',
                '--disable-gpl',
                '--disable-nonfree',
            ],
        },
        mpv: {
            ...packages.mpv,
            mesonFlags: ['-Dlibmpv=true', '-Dgpl=false'],
        },
        sourceDistribution:
            'https://downloads.example.test/iptvnator/linux-runtime-sources.tar.zst',
        runtimeFiles,
        runtimeTotalBytes: runtimeFiles.reduce(
            (total, runtimeEntry) => total + (runtimeEntry?.size ?? 0),
            0
        ),
        runtimeDependencyClosure: {
            entries: closureEntries,
            externalDependencies,
        },
        externalSystemLibraries: EXTERNAL_SYSTEM_LIBRARIES.map(
            (externalLibrary) => ({ ...externalLibrary })
        ),
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
    };
}

function createSystemBuildInputManifest() {
    return {
        linuxBackend: 'process-isolated mpv --wid',
        buildInputs: {
            libmpvDevPackage: '2:0.40.0-3ubuntu2',
            mpvPackage: '0.40.0-3ubuntu2',
        },
        sourceDistribution:
            'Linux CI build inputs come from Ubuntu runner packages. Runtime playback uses the system mpv executable; IPTVnator does not bundle or load libmpv in the Electron process on Linux.',
    };
}

function createFixture(t, options = {}) {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-linux-runtime-test-')
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const prefix = path.join(root, 'prefix');
    const includeDir = path.join(prefix, 'include', 'mpv');
    const libDir = path.join(prefix, 'lib');
    fs.mkdirSync(includeDir, { recursive: true });
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(
        path.join(includeDir, 'client.h'),
        '/* libmpv header */\n'
    );

    const contentsByName = new Map([
        ['libmpv.so.2', 'libmpv-runtime'],
        ['libavcodec.so.61', 'libavcodec-runtime'],
    ]);

    for (const [name, contents] of contentsByName) {
        fs.writeFileSync(path.join(libDir, name), contents);
    }

    const manifest =
        options.manifest ??
        createValidManifest(
            [...contentsByName].map(([name, contents]) =>
                runtimeFile(name, contents)
            )
        );
    options.mutateManifest?.(manifest);

    if (options.removeRuntimeFile) {
        fs.rmSync(path.join(libDir, options.removeRuntimeFile), {
            force: true,
        });
    }
    if (options.removeHeader) {
        fs.rmSync(path.join(includeDir, 'client.h'), { force: true });
    }
    if (!options.omitManifest) {
        fs.writeFileSync(
            path.join(prefix, 'runtime-manifest.json'),
            `${JSON.stringify(manifest, null, 2)}\n`
        );
    }

    return { libDir, manifest, prefix, root };
}

function destinationRootFor(fixture) {
    return path.join(fixture.root, 'vendor', 'embedded-mpv', 'linux-x64');
}

function runStage(fixture) {
    return spawnSync(
        process.execPath,
        [stageRuntimeScript, 'linux', 'x64', fixture.prefix],
        {
            cwd: fixture.root,
            encoding: 'utf8',
        }
    );
}

function assertStageRejected(t, options, expectedError) {
    const fixture = createFixture(t, options);
    const result = runStage(fixture);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, expectedError);
}

test('exports the Linux runtime manifest schema version', () => {
    assert.equal(LINUX_RUNTIME_MANIFEST_SCHEMA_VERSION, 1);
});

test('accepts a complete LGPL Linux x64 source-build manifest', () => {
    assert.deepEqual(validateLinuxRuntimeManifest(createValidManifest()), []);
});

test('requires the exact pinned source package set and provenance', () => {
    const expectedPackageNames = SOURCE_PACKAGES.map(({ id }) => id).sort();
    assert.deepEqual(
        Object.keys(createValidManifest().packages).sort(),
        expectedPackageNames
    );

    for (const packageName of expectedPackageNames) {
        const manifest = createValidManifest();
        delete manifest.packages[packageName];
        assert.match(
            validateLinuxRuntimeManifest(manifest).join('\n'),
            new RegExp(`packages\\.${packageName} must be an object`)
        );
    }

    const unexpectedPackage = createValidManifest();
    unexpectedPackage.packages.unpinned = {
        version: '1.0.0',
        sourceUrl: 'https://example.test/unpinned.tar.xz',
        sourceSha256: 'f'.repeat(64),
        license: 'MIT',
    };
    assert.match(
        validateLinuxRuntimeManifest(unexpectedPackage).join('\n'),
        /packages contains unexpected source package "unpinned"/
    );
});

test('requires pinned archive hashes and exact libplacebo git provenance', () => {
    const archiveMismatch = createValidManifest();
    archiveMismatch.packages.freetype.sourceSha256 = '0'.repeat(64);
    assert.match(
        validateLinuxRuntimeManifest(archiveMismatch).join('\n'),
        /packages\.freetype\.sourceSha256 must equal the pinned digest/
    );

    const commitMismatch = createValidManifest();
    commitMismatch.packages.libplacebo.sourceGitCommit = '0'.repeat(40);
    assert.match(
        validateLinuxRuntimeManifest(commitMismatch).join('\n'),
        /packages\.libplacebo\.sourceGitCommit must equal the pinned commit/
    );

    const validSubmoduleRecord = `${'a'.repeat(40)} 3rdparty/example`;
    for (const sourceSubmodules of [
        [],
        ['not-a-submodule-record'],
        [`${'a'.repeat(40)} ../escape`],
        [validSubmoduleRecord, validSubmoduleRecord],
    ]) {
        const invalidSubmodules = createValidManifest();
        invalidSubmodules.packages.libplacebo.sourceSubmodules =
            sourceSubmodules;
        assert.match(
            validateLinuxRuntimeManifest(invalidSubmodules).join('\n'),
            /packages\.libplacebo\.sourceSubmodules/
        );
    }
});

test('requires runtimeTotalBytes to equal the declared runtime file sizes', () => {
    const missingTotal = createValidManifest();
    delete missingTotal.runtimeTotalBytes;
    assert.match(
        validateLinuxRuntimeManifest(missingTotal).join('\n'),
        /runtimeTotalBytes must equal the sum/
    );

    const wrongTotal = createValidManifest();
    wrongTotal.runtimeTotalBytes += 1;
    assert.match(
        validateLinuxRuntimeManifest(wrongTotal).join('\n'),
        /runtimeTotalBytes must equal the sum/
    );
});

test('requires a complete ORIGIN-only runtime dependency closure', () => {
    const missingEntry = createValidManifest();
    missingEntry.runtimeDependencyClosure.entries.pop();
    assert.match(
        validateLinuxRuntimeManifest(missingEntry).join('\n'),
        /runtimeDependencyClosure\.entries must contain one record for every runtime file/
    );

    const duplicateEntry = createValidManifest();
    duplicateEntry.runtimeDependencyClosure.entries[1].name =
        duplicateEntry.runtimeDependencyClosure.entries[0].name;
    assert.match(
        validateLinuxRuntimeManifest(duplicateEntry).join('\n'),
        /runtimeDependencyClosure\.entries contains duplicate name/
    );

    const invalidNeeded = createValidManifest();
    invalidNeeded.runtimeDependencyClosure.entries[0].needed = 'libc.so.6';
    assert.match(
        validateLinuxRuntimeManifest(invalidNeeded).join('\n'),
        /needed must be an array of safe shared-library names/
    );

    const absoluteRpath = createValidManifest();
    absoluteRpath.runtimeDependencyClosure.entries[0].rpath = ['/tmp/lib'];
    assert.match(
        validateLinuxRuntimeManifest(absoluteRpath).join('\n'),
        /rpath must be an empty array/
    );

    const wrongRunpath = createValidManifest();
    wrongRunpath.runtimeDependencyClosure.entries[0].runpath = ['/tmp/lib'];
    assert.match(
        validateLinuxRuntimeManifest(wrongRunpath).join('\n'),
        /runpath must contain only "\$ORIGIN"/
    );

    const unknownDependency = createValidManifest();
    unknownDependency.runtimeDependencyClosure.entries[0].needed.push(
        'libsurprise.so.1'
    );
    unknownDependency.runtimeDependencyClosure.externalDependencies.push(
        'libsurprise.so.1'
    );
    assert.match(
        validateLinuxRuntimeManifest(unknownDependency).join('\n'),
        /libsurprise\.so\.1.*not in the deterministic system-library allowlist/
    );
});

test('requires the deterministic external-system-library records', () => {
    const manifest = createValidManifest();
    manifest.externalSystemLibraries.reverse();
    assert.match(
        validateLinuxRuntimeManifest(manifest).join('\n'),
        /externalSystemLibraries must exactly match the deterministic allowlist/
    );

    const allowedNames = new Set([
        ...GLIBC_TOOLCHAIN_ALLOWLIST,
        ...EXTERNAL_SYSTEM_LIBRARIES.map(({ name }) => name),
    ]);
    for (const dependencyName of createValidManifest().runtimeDependencyClosure
        .externalDependencies) {
        assert.equal(allowedNames.has(dependencyName), true, dependencyName);
    }
});

test('requires a Linux x64 build host and every required tool version', () => {
    const wrongPlatform = createValidManifest();
    wrongPlatform.buildHost.platform = 'darwin';
    assert.match(
        validateLinuxRuntimeManifest(wrongPlatform).join('\n'),
        /buildHost\.platform must be "linux"/
    );

    const wrongArch = createValidManifest();
    wrongArch.buildHost.arch = 'arm64';
    assert.match(
        validateLinuxRuntimeManifest(wrongArch).join('\n'),
        /buildHost\.arch must be "x64"/
    );

    for (const tool of REQUIRED_TOOLS) {
        const missingTool = createValidManifest();
        delete missingTool.buildHost.tools[tool];
        assert.match(
            validateLinuxRuntimeManifest(missingTool).join('\n'),
            new RegExp(`buildHost\\.tools\\.${tool.replace('-', '\\-')}`)
        );
    }

    const unexpectedTool = createValidManifest();
    unexpectedTool.buildHost.tools.unexpected = '1.0';
    assert.match(
        validateLinuxRuntimeManifest(unexpectedTool).join('\n'),
        /buildHost\.tools contains unexpected tool "unexpected"/
    );

    const relativePkgConfigDir = createValidManifest();
    relativePkgConfigDir.buildHost.systemPkgConfigDirs = ['relative/pkgconfig'];
    assert.match(
        validateLinuxRuntimeManifest(relativePkgConfigDir).join('\n'),
        /buildHost\.systemPkgConfigDirs must be a non-empty array of unique absolute paths/
    );

    for (const packageName of EXPECTED_SYSTEM_PKG_CONFIG_PACKAGES) {
        const missingPackage = createValidManifest();
        delete missingPackage.buildHost.systemPkgConfigPackages[packageName];
        assert.match(
            validateLinuxRuntimeManifest(missingPackage).join('\n'),
            new RegExp(
                `buildHost\\.systemPkgConfigPackages\\.${packageName.replace(
                    '-',
                    '\\-'
                )}`
            )
        );
    }

    const unexpectedPackage = createValidManifest();
    unexpectedPackage.buildHost.systemPkgConfigPackages.unexpected = '1.0';
    assert.match(
        validateLinuxRuntimeManifest(unexpectedPackage).join('\n'),
        /buildHost\.systemPkgConfigPackages contains unexpected package "unexpected"/
    );
});

test('accepts and stages the current Linux CI system build-input manifest', (t) => {
    const systemManifest = createSystemBuildInputManifest();
    assert.deepEqual(validateLinuxSystemBuildInputManifest(systemManifest), []);

    const fixture = createFixture(t, { manifest: systemManifest });
    const result = runStage(fixture);
    assert.equal(result.status, 0, result.stderr);

    const destinationRoot = destinationRootFor(fixture);
    assert.equal(
        fs.readFileSync(
            path.join(destinationRoot, 'include', 'mpv', 'client.h'),
            'utf8'
        ),
        '/* libmpv header */\n'
    );
    assert.equal(fs.existsSync(path.join(destinationRoot, 'lib')), false);

    const stagedManifest = JSON.parse(
        fs.readFileSync(
            path.join(destinationRoot, 'runtime-manifest.json'),
            'utf8'
        )
    );
    assert.equal(stagedManifest.origin, 'vendored-lgpl');
    assert.equal(stagedManifest.platform, 'linux');
    assert.equal(stagedManifest.arch, 'x64');
    assert.deepEqual(stagedManifest.runtimeFiles, []);
    assert.deepEqual(stagedManifest.buildInputs, systemManifest.buildInputs);
    assert.equal(stagedManifest.linuxBackend, systemManifest.linuxBackend);
    assert.equal('sourceBuildOrigin' in stagedManifest, false);
});

test('rejects malformed system build-input manifests without falling through', (t) => {
    const malformedSystemManifest = createSystemBuildInputManifest();
    malformedSystemManifest.buildInputs.mpvPackage = '';
    malformedSystemManifest.runtimeFiles = [];

    assert.deepEqual(
        validateLinuxSystemBuildInputManifest(malformedSystemManifest),
        [
            'Linux system build-input manifest buildInputs.mpvPackage must be a non-empty string.',
            'Linux system build-input manifest must not include runtimeFiles.',
        ]
    );

    const fixture = createFixture(t, { manifest: malformedSystemManifest });
    const result = runStage(fixture);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /buildInputs\.mpvPackage/);
    assert.match(result.stderr, /must not include runtimeFiles/);
});

test('returns deterministic validation errors for untrusted input', () => {
    assert.deepEqual(validateLinuxRuntimeManifest(null), [
        'Linux runtime manifest must be an object.',
    ]);
    assert.deepEqual(validateLinuxRuntimeManifest(null), [
        'Linux runtime manifest must be an object.',
    ]);

    const manifest = createValidManifest();
    manifest.runtimeFiles[0].sha256 = Symbol('not-a-digest');
    assert.doesNotThrow(() => validateLinuxRuntimeManifest(manifest));
    assert.match(
        validateLinuxRuntimeManifest(manifest).join('\n'),
        /runtimeFiles\[0\]\.sha256/
    );

    const hostileAllowlist = createValidManifest();
    hostileAllowlist.externalSystemLibraries = 1n;
    assert.doesNotThrow(() => validateLinuxRuntimeManifest(hostileAllowlist));
    assert.match(
        validateLinuxRuntimeManifest(hostileAllowlist).join('\n'),
        /externalSystemLibraries/
    );
});

test('requires schema, provenance, target, package, and source metadata', () => {
    const manifest = createValidManifest();
    manifest.schemaVersion = 2;
    manifest.origin = 'vendored-lgpl';
    manifest.platform = 'darwin';
    manifest.arch = 'arm64';
    manifest.packages.ffmpeg.sourceUrl = '';
    manifest.packages.mpv.version = '';
    manifest.sourceDistribution = ' ';

    assert.deepEqual(validateLinuxRuntimeManifest(manifest), [
        'Linux runtime manifest schemaVersion must be 1.',
        'Linux runtime manifest origin must be "vendored-lgpl-source-build".',
        'Linux runtime manifest platform must be "linux".',
        'Linux runtime manifest arch must be "x64".',
        'Linux runtime manifest packages.ffmpeg.sourceUrl must be a non-empty string.',
        'Linux runtime manifest packages.mpv.version must be a non-empty string.',
        'Linux runtime manifest sourceDistribution must be a non-empty string.',
    ]);

    manifest.packages = {};
    assert.match(
        validateLinuxRuntimeManifest(manifest).join('\n'),
        /packages must contain source package metadata/
    );
});

test('requires exact FFmpeg and mpv source package records', () => {
    const missingFfmpeg = createValidManifest();
    missingFfmpeg.packages.libavcodec = missingFfmpeg.packages.ffmpeg;
    delete missingFfmpeg.packages.ffmpeg;
    assert.match(
        validateLinuxRuntimeManifest(missingFfmpeg).join('\n'),
        /packages\.ffmpeg must be an object/
    );

    const missingMpv = createValidManifest();
    missingMpv.packages.libmpv = missingMpv.packages.mpv;
    delete missingMpv.packages.mpv;
    assert.match(
        validateLinuxRuntimeManifest(missingMpv).join('\n'),
        /packages\.mpv must be an object/
    );

    const substitutedPackages = createValidManifest();
    substitutedPackages.packages = {
        multimediaRuntime: {
            version: '1.0.0',
            sourceUrl: 'https://example.test/multimedia-runtime.tar.xz',
            sourceSha256: 'c'.repeat(64),
            license: 'LGPL-2.1-or-later',
        },
    };
    const substitutedErrors =
        validateLinuxRuntimeManifest(substitutedPackages).join('\n');
    for (const packageName of SOURCE_PACKAGES.map(({ id }) => id)) {
        assert.match(
            substitutedErrors,
            new RegExp(`packages\\.${packageName} must be an object`)
        );
    }
    assert.match(
        substitutedErrors,
        /packages contains unexpected source package "multimediaRuntime"/
    );
});

test('rejects GPL and nonfree FFmpeg configurations', () => {
    const cases = [
        {
            flags: ['--disable-nonfree'],
            expected: /must include "--disable-gpl"/,
        },
        {
            flags: ['--disable-gpl'],
            expected: /must include "--disable-nonfree"/,
        },
        {
            flags: ['--disable-gpl', '--disable-nonfree', '--enable-gpl'],
            expected: /must not include "--enable-gpl"/,
        },
        {
            flags: ['--disable-gpl', '--disable-nonfree', '--enable-nonfree'],
            expected: /must not include "--enable-nonfree"/,
        },
    ];

    for (const { flags, expected } of cases) {
        const manifest = createValidManifest();
        manifest.ffmpeg.configureFlags = flags;
        assert.match(
            validateLinuxRuntimeManifest(manifest).join('\n'),
            expected
        );
    }

    const manifest = createValidManifest();
    manifest.ffmpeg = { configureFlags: ['--enable-gpl'] };
    assert.match(validateLinuxRuntimeManifest(manifest)[0], /--enable-gpl/);
});

test('requires libmpv and GPL-disabled mpv Meson flags', () => {
    const cases = [
        {
            flags: ['-Dgpl=false'],
            expected: /must include "-Dlibmpv=true"/,
        },
        {
            flags: ['-Dlibmpv=true'],
            expected: /must include "-Dgpl=false"/,
        },
        {
            flags: ['-Dlibmpv=true', '-Dgpl=false', '-Dgpl=true'],
            expected: /must not include "-Dgpl=true"/,
        },
    ];

    for (const { flags, expected } of cases) {
        const manifest = createValidManifest();
        manifest.mpv.mesonFlags = flags;
        assert.match(
            validateLinuxRuntimeManifest(manifest).join('\n'),
            expected
        );
    }

    const manifest = createValidManifest();
    manifest.mpv = { mesonFlags: ['-Dgpl=true'] };
    assert.match(validateLinuxRuntimeManifest(manifest)[0], /-Dgpl=false/);
});

test('rejects duplicate or contradictory required mpv Meson assignments', () => {
    const cases = [
        {
            flags: ['-Dlibmpv=true', '-Dlibmpv=false', '-Dgpl=false'],
            expected: /must assign "-Dlibmpv" exactly once/,
        },
        {
            flags: ['-Dlibmpv=true', '-Dgpl=false', '-Dgpl=true'],
            expected: /must assign "-Dgpl" exactly once/,
        },
        {
            flags: ['-Dlibmpv=true', '-Dlibmpv=true', '-Dgpl=false'],
            expected: /must assign "-Dlibmpv" exactly once/,
        },
    ];

    for (const { expected, flags } of cases) {
        const manifest = createValidManifest();
        manifest.mpv.mesonFlags = flags;
        assert.match(
            validateLinuxRuntimeManifest(manifest).join('\n'),
            expected
        );
    }
});

test('validates safe, unique shared-library metadata', () => {
    const manifest = createValidManifest([
        {
            name: '../libmpv.so.2',
            size: 0,
            sha256: 'ABC',
        },
        runtimeFile('libcodec.a', 'archive'),
        runtimeFile('libcodec.a', 'duplicate'),
    ]);

    const errors = validateLinuxRuntimeManifest(manifest);
    assert.deepEqual(errors.slice(0, 7), [
        'Linux runtime manifest runtimeFiles[0].name must be a safe shared-library basename.',
        'Linux runtime manifest runtimeFiles[0].size must be a positive integer.',
        'Linux runtime manifest runtimeFiles[0].sha256 must be a lowercase 64-character hexadecimal digest.',
        'Linux runtime manifest runtimeFiles[1].name must end in ".so" or a numeric ".so.N" suffix.',
        'Linux runtime manifest runtimeFiles[2].name must end in ".so" or a numeric ".so.N" suffix.',
        'Linux runtime manifest runtimeFiles contains duplicate name "libcodec.a".',
        'Linux runtime manifest runtimeFiles must include a versioned libmpv.so.N entry.',
    ]);
    assert.match(
        errors.join('\n'),
        /runtimeDependencyClosure\.entries\[0\]\.name must be a safe shared-library basename/
    );
    assert.match(
        errors.join('\n'),
        /runtimeDependencyClosure\.entries contains duplicate name "libcodec\.a"/
    );
});

test('rejects control characters in shared-library basenames', () => {
    const manifest = createValidManifest();
    manifest.runtimeFiles.push(
        runtimeFile('libinjected.so.1\n', 'unsafe-name')
    );

    assert.match(
        validateLinuxRuntimeManifest(manifest).join('\n'),
        /runtimeFiles\[2\]\.name must be a safe shared-library basename/
    );
});

test('stages only declared Linux libraries and materializes source symlinks', (t) => {
    const fixture = createFixture(t);
    const versionedMpvContents = fs.readFileSync(
        path.join(fixture.libDir, 'libmpv.so.2')
    );
    fs.renameSync(
        path.join(fixture.libDir, 'libmpv.so.2'),
        path.join(fixture.libDir, 'libmpv.so.2.1.0')
    );
    fs.symlinkSync('libmpv.so.2.1.0', path.join(fixture.libDir, 'libmpv.so.2'));
    fs.symlinkSync('libmpv.so.2', path.join(fixture.libDir, 'libmpv.so'));
    fs.writeFileSync(path.join(fixture.libDir, 'libundeclared.so.1'), 'extra');
    fixture.manifest.runtimeFiles.push(
        runtimeFile('libmpv.so', versionedMpvContents)
    );
    fixture.manifest.runtimeTotalBytes += versionedMpvContents.length;
    fixture.manifest.runtimeDependencyClosure.entries.push({
        name: 'libmpv.so',
        needed: ['libmpv.so.2'],
        rpath: [],
        runpath: ['$ORIGIN'],
    });
    fs.writeFileSync(
        path.join(fixture.prefix, 'runtime-manifest.json'),
        `${JSON.stringify(fixture.manifest, null, 2)}\n`
    );

    const result = runStage(fixture);
    assert.equal(result.status, 0, result.stderr);

    const destinationRoot = destinationRootFor(fixture);
    const destinationLibDir = path.join(destinationRoot, 'lib');
    assert.deepEqual(fs.readdirSync(destinationLibDir).sort(), [
        'libavcodec.so.61',
        'libmpv.so',
        'libmpv.so.2',
    ]);
    for (const runtimeEntry of fixture.manifest.runtimeFiles) {
        const destinationPath = path.join(destinationLibDir, runtimeEntry.name);
        const stat = fs.lstatSync(destinationPath);
        assert.equal(stat.isFile(), true);
        assert.equal(stat.isSymbolicLink(), false);
        assert.equal(stat.size, runtimeEntry.size);
        assert.equal(
            sha256(fs.readFileSync(destinationPath)),
            runtimeEntry.sha256
        );
    }
    assert.equal(
        fs.readFileSync(
            path.join(destinationRoot, 'include', 'mpv', 'client.h'),
            'utf8'
        ),
        '/* libmpv header */\n'
    );

    const stagedManifest = JSON.parse(
        fs.readFileSync(
            path.join(destinationRoot, 'runtime-manifest.json'),
            'utf8'
        )
    );
    assert.equal(stagedManifest.origin, 'vendored-lgpl');
    assert.equal(
        stagedManifest.sourceBuildOrigin,
        'vendored-lgpl-source-build'
    );
    assert.equal(stagedManifest.platform, 'linux');
    assert.equal(stagedManifest.arch, 'x64');
    assert.deepEqual(
        stagedManifest.runtimeFiles,
        fixture.manifest.runtimeFiles
    );
    for (const field of [
        'packages',
        'runtimeTotalBytes',
        'runtimeDependencyClosure',
        'externalSystemLibraries',
        'buildHost',
    ]) {
        assert.deepEqual(stagedManifest[field], fixture.manifest[field], field);
    }
});

test('copies runtime libraries only from the verified byte snapshot', () => {
    assert.match(
        stageRuntimeSource,
        /function readVerifiedLinuxRuntimeFiles\(manifest\)/
    );
    assert.match(
        stageRuntimeSource,
        /contents = fs\.readFileSync\(sourcePath\)/
    );
    assert.match(
        stageRuntimeSource,
        /fs\.writeFileSync\(destinationPath, verifiedRuntimeFile\.contents\)/
    );
    assert.doesNotMatch(
        stageRuntimeSource,
        /function copyLinuxRuntimeFiles\(manifest\)/
    );
});

test('atomically replaces the complete Linux destination tree', (t) => {
    const fixture = createFixture(t);
    const destinationRoot = destinationRootFor(fixture);
    fs.mkdirSync(destinationRoot, { recursive: true });
    fs.writeFileSync(path.join(destinationRoot, 'stale-runtime.txt'), 'stale');

    const result = runStage(fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
        fs.existsSync(path.join(destinationRoot, 'stale-runtime.txt')),
        false
    );
    assert.deepEqual(
        fs
            .readdirSync(path.dirname(destinationRoot))
            .filter((name) => name.startsWith('.linux-x64.')),
        []
    );
});

test('rejects a libmpv header symlink that escapes the source prefix', (t) => {
    const fixture = createFixture(t);
    const outsideHeader = path.join(fixture.root, 'outside-client.h');
    const clientHeader = path.join(
        fixture.prefix,
        'include',
        'mpv',
        'client.h'
    );
    fs.writeFileSync(outsideHeader, '/* untrusted external header */\n');
    fs.rmSync(clientHeader);
    fs.symlinkSync(outsideHeader, clientHeader);

    const result = runStage(fixture);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(
        result.stderr,
        /Linux header resolves outside prefix\/include/
    );
});

test('rejects destination root and ancestor symlink redirection', (t) => {
    for (const symlinkLocation of ['destination', 'ancestor']) {
        const fixture = createFixture(t);
        const destinationRoot = destinationRootFor(fixture);
        const outsideRoot = path.join(
            fixture.root,
            `outside-${symlinkLocation}`
        );
        fs.mkdirSync(outsideRoot, { recursive: true });
        fs.writeFileSync(path.join(outsideRoot, 'untouched.txt'), 'untouched');

        if (symlinkLocation === 'destination') {
            fs.mkdirSync(path.dirname(destinationRoot), { recursive: true });
            fs.symlinkSync(outsideRoot, destinationRoot);
        } else {
            const embeddedMpvRoot = path.dirname(destinationRoot);
            fs.mkdirSync(path.dirname(embeddedMpvRoot), { recursive: true });
            fs.symlinkSync(outsideRoot, embeddedMpvRoot);
        }

        const result = runStage(fixture);
        assert.notEqual(result.status, 0, result.stdout);
        assert.match(
            result.stderr,
            /Linux runtime destination path contains a symbolic link/
        );
        assert.equal(
            fs.readFileSync(path.join(outsideRoot, 'untouched.txt'), 'utf8'),
            'untouched'
        );
    }
});

test('rejects missing Linux headers or manifests', (t) => {
    assertStageRejected(t, { removeHeader: true }, /Missing libmpv header/);
    assertStageRejected(
        t,
        { omitManifest: true },
        /Missing Linux runtime manifest/
    );
});

test('rejects unsafe or duplicate declared library names', (t) => {
    assertStageRejected(
        t,
        {
            mutateManifest(manifest) {
                manifest.runtimeFiles[0].name = '../libmpv.so.2';
            },
        },
        /safe shared-library basename/
    );
    assertStageRejected(
        t,
        {
            mutateManifest(manifest) {
                manifest.runtimeFiles.push({ ...manifest.runtimeFiles[0] });
            },
        },
        /duplicate name "libmpv.so.2"/
    );
});

test('rejects missing files and mismatched size or hash metadata', (t) => {
    assertStageRejected(
        t,
        { removeRuntimeFile: 'libavcodec.so.61' },
        /Missing declared Linux runtime file.*libavcodec\.so\.61/
    );
    assertStageRejected(
        t,
        {
            mutateManifest(manifest) {
                manifest.runtimeFiles[0].size += 1;
                manifest.runtimeTotalBytes += 1;
            },
        },
        /Size mismatch for Linux runtime file.*libmpv\.so\.2/
    );
    assertStageRejected(
        t,
        {
            mutateManifest(manifest) {
                manifest.runtimeFiles[0].sha256 = '0'.repeat(64);
            },
        },
        /SHA-256 mismatch for Linux runtime file.*libmpv\.so\.2/
    );
});

test('rejects forbidden build flags and a missing versioned libmpv entry', (t) => {
    const invalidConfigurations = [
        {
            mutateManifest(manifest) {
                manifest.ffmpeg.configureFlags.push('--enable-gpl');
            },
            expected: /must not include "--enable-gpl"/,
        },
        {
            mutateManifest(manifest) {
                manifest.ffmpeg.configureFlags.push('--enable-nonfree');
            },
            expected: /must not include "--enable-nonfree"/,
        },
        {
            mutateManifest(manifest) {
                manifest.mpv.mesonFlags = ['-Dlibmpv=true', '-Dgpl=true'];
            },
            expected: /must include "-Dgpl=false"/,
        },
        {
            mutateManifest(manifest) {
                manifest.mpv.mesonFlags = ['-Dgpl=false'];
            },
            expected: /must include "-Dlibmpv=true"/,
        },
        {
            mutateManifest(manifest) {
                manifest.mpv.mesonFlags = [
                    '-Dlibmpv=true',
                    '-Dlibmpv=false',
                    '-Dgpl=false',
                ];
            },
            expected: /must assign "-Dlibmpv" exactly once/,
        },
        {
            mutateManifest(manifest) {
                manifest.runtimeFiles = manifest.runtimeFiles.filter(
                    ({ name }) => name !== 'libmpv.so.2'
                );
            },
            expected: /must include a versioned libmpv\.so\.N entry/,
        },
    ];

    for (const { expected, mutateManifest } of invalidConfigurations) {
        assertStageRejected(t, { mutateManifest }, expected);
    }
});
