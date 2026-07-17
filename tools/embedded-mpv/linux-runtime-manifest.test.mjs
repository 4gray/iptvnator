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
} = require('./linux-runtime-manifest.cjs');

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
const stageRuntimeScript = path.join(
    workspaceRoot,
    'tools',
    'embedded-mpv',
    'stage-runtime.mjs'
);

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

function createValidManifest(
    runtimeFiles = [
        runtimeFile('libmpv.so.2', 'libmpv-runtime'),
        runtimeFile('libavcodec.so.61', 'libavcodec-runtime'),
    ]
) {
    return {
        schemaVersion: 1,
        origin: 'vendored-lgpl-source-build',
        platform: 'linux',
        arch: 'x64',
        packages: {
            ffmpeg: {
                version: '8.1',
                sourceUrl: 'https://ffmpeg.org/releases/ffmpeg-8.1.tar.xz',
                sourceSha256: 'a'.repeat(64),
                license: 'LGPL-2.1-or-later',
            },
            mpv: {
                version: '0.41.0',
                sourceUrl:
                    'https://github.com/mpv-player/mpv/archive/refs/tags/v0.41.0.tar.gz',
                sourceSha256: 'b'.repeat(64),
                license: 'LGPL-2.1-or-later',
            },
        },
        ffmpeg: {
            version: '8.1',
            sourceUrl: 'https://ffmpeg.org/releases/ffmpeg-8.1.tar.xz',
            sourceSha256: 'a'.repeat(64),
            configureFlags: [
                '--enable-shared',
                '--disable-gpl',
                '--disable-nonfree',
            ],
        },
        mpv: {
            version: '0.41.0',
            sourceUrl:
                'https://github.com/mpv-player/mpv/archive/refs/tags/v0.41.0.tar.gz',
            sourceSha256: 'b'.repeat(64),
            mesonFlags: ['-Dlibmpv=true', '-Dgpl=false'],
        },
        sourceDistribution:
            'https://downloads.example.test/iptvnator/linux-runtime-sources.tar.zst',
        runtimeFiles,
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

    const manifest = createValidManifest(
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

    assert.deepEqual(validateLinuxRuntimeManifest(manifest), [
        'Linux runtime manifest runtimeFiles[0].name must be a safe shared-library basename.',
        'Linux runtime manifest runtimeFiles[0].size must be a positive integer.',
        'Linux runtime manifest runtimeFiles[0].sha256 must be a lowercase 64-character hexadecimal digest.',
        'Linux runtime manifest runtimeFiles[1].name must end in ".so" or a numeric ".so.N" suffix.',
        'Linux runtime manifest runtimeFiles[2].name must end in ".so" or a numeric ".so.N" suffix.',
        'Linux runtime manifest runtimeFiles contains duplicate name "libcodec.a".',
        'Linux runtime manifest runtimeFiles must include a versioned libmpv.so.N entry.',
    ]);
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
    fs.writeFileSync(
        path.join(fixture.prefix, 'runtime-manifest.json'),
        `${JSON.stringify(fixture.manifest, null, 2)}\n`
    );

    const result = runStage(fixture);
    assert.equal(result.status, 0, result.stderr);

    const destinationRoot = path.join(
        fixture.root,
        'vendor',
        'embedded-mpv',
        'linux-x64'
    );
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
