import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    collectEmbeddedMpvNativeArchiveEntries,
    collectAsarPackageDirs,
    findMissingPackagedDependencies,
    inspectPackagedDependencyClosure,
    listAsarPackageEntries,
    resolvePackagedDependency,
} from './asar-dependency-closure.mjs';

const require = createRequire(import.meta.url);
const {
    createPackage: createAsarPackage,
    listPackage: listAsarPackageWithDependency,
} = require('@electron/asar');

function writeSyntheticAsarHeader(archivePath, files) {
    const json = Buffer.from(JSON.stringify({ files }), 'utf8');
    const alignedJsonLength = Math.ceil(json.length / 4) * 4;
    const headerPayloadSize = 4 + alignedJsonLength;
    const headerSize = 4 + headerPayloadSize;
    const sizePrefix = Buffer.alloc(8);
    sizePrefix.writeUInt32LE(4, 0);
    sizePrefix.writeUInt32LE(headerSize, 4);
    const header = Buffer.alloc(headerSize);
    header.writeUInt32LE(headerPayloadSize, 0);
    header.writeInt32LE(json.length, 4);
    json.copy(header, 8);
    fs.writeFileSync(archivePath, Buffer.concat([sizePrefix, header]));
}

/**
 * Builds a `readManifest(dir)` backed by an in-memory map of
 * `{ packageDir: manifest }`, mirroring how manifests are read from an asar.
 */
function manifestReader(manifests) {
    return (packageDir) => manifests[packageDir] ?? null;
}

test('collectEmbeddedMpvNativeArchiveEntries finds stale native payloads on every host separator', () => {
    assert.deepEqual(
        collectEmbeddedMpvNativeArchiveEntries(
            [
                '/electron-backend/main.js',
                '/electron-backend/native/iptvnator_mpv_helper',
                '/electron-backend/native/lib/libmpv.so.2',
                '/web/index.html',
            ],
            '/'
        ),
        [
            '/electron-backend/native/iptvnator_mpv_helper',
            '/electron-backend/native/lib/libmpv.so.2',
        ]
    );
    assert.deepEqual(
        collectEmbeddedMpvNativeArchiveEntries(
            [
                '\\electron-backend\\native\\embedded-mpv-unavailable.txt',
                '\\electron-backend\\node_modules\\package.json',
            ],
            '\\'
        ),
        ['/electron-backend/native/embedded-mpv-unavailable.txt']
    );
});

test('listAsarPackageEntries matches Electron ASAR listings from a bounded header', async (t) => {
    const temporaryRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-asar-header-')
    );
    t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
    const sourceRoot = path.join(temporaryRoot, 'source');
    const archivePath = path.join(temporaryRoot, 'app.asar');
    fs.mkdirSync(path.join(sourceRoot, 'electron-backend', 'native'), {
        recursive: true,
    });
    fs.writeFileSync(path.join(sourceRoot, 'main.js'), 'main');
    fs.writeFileSync(
        path.join(
            sourceRoot,
            'electron-backend',
            'native',
            'embedded-mpv-runtime.json'
        ),
        '{}\n'
    );
    await createAsarPackage(sourceRoot, archivePath);

    assert.deepEqual(
        listAsarPackageEntries(archivePath),
        listAsarPackageWithDependency(archivePath)
    );
});

test('listAsarPackageEntries rejects an unbounded declared header before allocation', (t) => {
    const temporaryRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-asar-header-')
    );
    t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
    const archivePath = path.join(temporaryRoot, 'oversized.asar');
    const prefix = Buffer.alloc(8);
    prefix.writeUInt32LE(4, 0);
    prefix.writeUInt32LE(0xffffffff, 4);
    fs.writeFileSync(archivePath, prefix);

    assert.throws(
        () => listAsarPackageEntries(archivePath),
        /ASAR header exceeds.*limit/i
    );
});

test('listAsarPackageEntries traverses untrusted directory mappings without bulk Object.entries allocation', (t) => {
    const temporaryRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-asar-header-')
    );
    t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
    const archivePath = path.join(temporaryRoot, 'wide.asar');
    const files = Object.fromEntries(
        Array.from({ length: 4096 }, (_, index) => [
            `entry-${String(index).padStart(4, '0')}`,
            { size: 0, offset: '0' },
        ])
    );
    writeSyntheticAsarHeader(archivePath, files);

    const originalObjectEntries = Object.entries;
    Object.entries = () => {
        throw new Error(
            'untrusted ASAR mappings must not be materialized in bulk'
        );
    };
    try {
        assert.equal(listAsarPackageEntries(archivePath).length, 4096);
    } finally {
        Object.entries = originalObjectEntries;
    }
});

test('listAsarPackageEntries bounds cumulative paths under a wide long prefix', (t) => {
    const temporaryRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-asar-header-')
    );
    t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
    const archivePath = path.join(temporaryRoot, 'wide-prefix.asar');
    const children = Object.fromEntries(
        Array.from({ length: 64 }, (_, index) => [
            `leaf-${String(index).padStart(2, '0')}`,
            { size: 0, offset: '0' },
        ])
    );
    writeSyntheticAsarHeader(archivePath, {
        ['prefix-'.repeat(32)]: { files: children },
    });

    assert.throws(
        () =>
            listAsarPackageEntries(archivePath, {
                maxListedPathBytes: 1024,
            }),
        /cumulative ASAR entry paths exceed.*limit/i
    );
});

test('listAsarPackageEntries fails closed on malformed pickle, padding, and UTF-8', (t) => {
    const temporaryRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-asar-header-')
    );
    t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
    const validArchivePath = path.join(temporaryRoot, 'valid.asar');
    writeSyntheticAsarHeader(validArchivePath, {
        a: { size: 0, offset: '0' },
    });
    const validArchive = fs.readFileSync(validArchivePath);

    const malformedPickle = Buffer.from(validArchive);
    malformedPickle.writeUInt32LE(malformedPickle.readUInt32LE(8) - 4, 8);
    const malformedPicklePath = path.join(
        temporaryRoot,
        'malformed-pickle.asar'
    );
    fs.writeFileSync(malformedPicklePath, malformedPickle);
    assert.throws(
        () => listAsarPackageEntries(malformedPicklePath),
        /header pickle is malformed/i
    );

    const malformedPadding = Buffer.from(validArchive);
    malformedPadding[malformedPadding.length - 1] = 0xff;
    const malformedPaddingPath = path.join(
        temporaryRoot,
        'malformed-padding.asar'
    );
    fs.writeFileSync(malformedPaddingPath, malformedPadding);
    assert.throws(
        () => listAsarPackageEntries(malformedPaddingPath),
        /JSON framing is malformed/i
    );

    const malformedUtf8 = Buffer.from(validArchive);
    malformedUtf8[16] = 0xff;
    const malformedUtf8Path = path.join(temporaryRoot, 'malformed-utf8.asar');
    fs.writeFileSync(malformedUtf8Path, malformedUtf8);
    assert.throws(
        () => listAsarPackageEntries(malformedUtf8Path),
        /header JSON is invalid/i
    );
});

test('listAsarPackageEntries rejects unsafe archive path segments', (t) => {
    const temporaryRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-asar-header-')
    );
    t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

    for (const [index, unsafeSegment] of [
        '.',
        '..',
        'nested/name',
        'nul\0name',
    ].entries()) {
        const archivePath = path.join(
            temporaryRoot,
            `unsafe-${String(index)}.asar`
        );
        writeSyntheticAsarHeader(archivePath, {
            [unsafeSegment]: { size: 0, offset: '0' },
        });
        assert.throws(
            () => listAsarPackageEntries(archivePath),
            /invalid path segment/i
        );
    }
});

test('collectAsarPackageDirs keeps only genuine package roots', () => {
    const dirs = collectAsarPackageDirs([
        '/package.json',
        '/node_modules/debug/package.json',
        '/node_modules/debug/src/index.js',
        '/node_modules/@angular/core/package.json',
        '/node_modules/fast-uri/node_modules/uri-js/package.json',
        // Nested manifests that are NOT packages must be ignored.
        '/node_modules/fast-uri/benchmark/package.json',
        '/node_modules/@angular/core/schematics/package.json',
    ]);

    assert.ok(dirs.has('/node_modules/debug'));
    assert.ok(dirs.has('/node_modules/@angular/core'));
    assert.ok(dirs.has('/node_modules/fast-uri/node_modules/uri-js'));
    assert.equal(dirs.has(''), false);
    assert.equal(dirs.has('/node_modules/fast-uri/benchmark'), false);
    assert.equal(dirs.has('/node_modules/@angular/core/schematics'), false);
});

test('resolvePackagedDependency walks node_modules boundaries upward', () => {
    const dirs = new Set([
        '/node_modules/ms',
        '/node_modules/electron-updater/node_modules/lazy-val',
    ]);

    // Hoisted to top level, requested from a deeply nested package.
    assert.equal(
        resolvePackagedDependency(
            '/node_modules/electron-updater/node_modules/builder-util-runtime',
            'ms',
            dirs
        ),
        '/node_modules/ms'
    );

    // Nested copy preferred over walking further up.
    assert.equal(
        resolvePackagedDependency(
            '/node_modules/electron-updater',
            'lazy-val',
            dirs
        ),
        '/node_modules/electron-updater/node_modules/lazy-val'
    );

    assert.equal(resolvePackagedDependency('', 'missing', dirs), null);
});

test('resolvePackagedDependency reaches root node_modules from app subdirectories', () => {
    // A package under an app subdirectory (e.g. /electron-backend/node_modules)
    // must still resolve a dependency hoisted to the archive root, exactly as
    // Node's resolver walks every ancestor directory.
    const dirs = new Set([
        '/electron-backend/node_modules/foo',
        '/node_modules/bar',
    ]);

    assert.equal(
        resolvePackagedDependency(
            '/electron-backend/node_modules/foo',
            'bar',
            dirs
        ),
        '/node_modules/bar'
    );
});

test('reports a deduplicated transitive dependency dropped from the archive (issue #1103)', () => {
    // `debug` is packaged but its transitive `ms` was dropped by the collector.
    const packageDirs = new Set([
        '',
        '/node_modules/electron-updater',
        '/node_modules/debug',
    ]);
    const manifests = {
        '': { dependencies: { 'electron-updater': '6.8.9' } },
        '/node_modules/electron-updater': { dependencies: { debug: '4.4.3' } },
        '/node_modules/debug': { dependencies: { ms: '2.1.3' } },
    };

    const missing = findMissingPackagedDependencies(
        packageDirs,
        manifestReader(manifests)
    );

    assert.deepEqual(missing, [
        { dependency: 'ms', requiredBy: '/node_modules/debug' },
    ]);
});

test('passes when the full runtime closure is present', () => {
    const packageDirs = new Set([
        '',
        '/node_modules/electron-updater',
        '/node_modules/debug',
        '/node_modules/ms',
    ]);
    const manifests = {
        '': { dependencies: { 'electron-updater': '6.8.9' } },
        '/node_modules/electron-updater': { dependencies: { debug: '4.4.3' } },
        '/node_modules/debug': { dependencies: { ms: '2.1.3' } },
        '/node_modules/ms': {},
    };

    assert.deepEqual(
        findMissingPackagedDependencies(packageDirs, manifestReader(manifests)),
        []
    );
});

test('does not flag frontend-only deps the app root declares but never ships', () => {
    // The app package.json lists Angular etc. (compiled into the web bundle),
    // which are intentionally absent from the shipped runtime node_modules.
    const packageDirs = new Set(['', '/node_modules/electron-updater']);
    const manifests = {
        '': {
            dependencies: {
                '@angular/core': '21.2.9',
                'electron-updater': '6.8.9',
            },
        },
        '/node_modules/electron-updater': {},
    };

    assert.deepEqual(
        findMissingPackagedDependencies(packageDirs, manifestReader(manifests)),
        []
    );
});

test('ignores missing optional dependencies', () => {
    const packageDirs = new Set(['', '/node_modules/pkg']);
    const manifests = {
        '': { dependencies: { pkg: '1.0.0' } },
        '/node_modules/pkg': {
            dependencies: { fsevents: '2.3.0' },
            optionalDependencies: { fsevents: '2.3.0' },
        },
    };

    assert.deepEqual(
        findMissingPackagedDependencies(packageDirs, manifestReader(manifests)),
        []
    );
});

test('ignores host-provided deps declared in both dependencies and peerDependencies', () => {
    // e.g. a package listing `electron` in dependencies for dev installs while
    // the Electron runtime provides it — never shipped inside app.asar.
    const packageDirs = new Set(['', '/node_modules/pkg']);
    const manifests = {
        '': { dependencies: { pkg: '1.0.0' } },
        '/node_modules/pkg': {
            dependencies: { electron: '41.0.0' },
            peerDependencies: { electron: '>=30' },
        },
    };

    assert.deepEqual(
        findMissingPackagedDependencies(packageDirs, manifestReader(manifests)),
        []
    );
});

test('tolerates dependency cycles without infinite recursion', () => {
    const packageDirs = new Set(['', '/node_modules/a', '/node_modules/b']);
    const manifests = {
        '': { dependencies: { a: '1.0.0' } },
        '/node_modules/a': { dependencies: { b: '1.0.0' } },
        '/node_modules/b': { dependencies: { a: '1.0.0' } },
    };

    assert.deepEqual(
        findMissingPackagedDependencies(packageDirs, manifestReader(manifests)),
        []
    );
});

test('inspectPackagedDependencyClosure wires injected asar IO', () => {
    const files = {
        'package.json': { dependencies: { debug: '4.4.3' } },
        'node_modules/debug/package.json': { dependencies: { ms: '2.1.3' } },
    };
    const listPackage = () => [
        '/package.json',
        '/node_modules/debug/package.json',
    ];
    const extractFile = (_asarPath, relativePath) => {
        const manifest = files[relativePath];
        if (!manifest) {
            throw new Error(`not found: ${relativePath}`);
        }
        return Buffer.from(JSON.stringify(manifest));
    };

    const { missing, packageCount, manifestReadFailures } =
        inspectPackagedDependencyClosure('app.asar', {
            listPackage,
            extractFile,
            pathSep: '/',
        });

    assert.deepEqual(missing, [
        { dependency: 'ms', requiredBy: '/node_modules/debug' },
    ]);
    assert.equal(packageCount, 1);
    assert.deepEqual(manifestReadFailures, []);
});

test('inspectPackagedDependencyClosure handles Windows-separator asar IO', () => {
    // @electron/asar builds listing entries with the host separator and
    // resolves extractFile paths by splitting on path.sep — on Windows both
    // are backslash-based. The guard must normalize listings to posix and
    // hand extractFile backslash paths, otherwise it audits nothing.
    const files = {
        'package.json': { dependencies: { debug: '4.4.3' } },
        'node_modules\\debug\\package.json': {
            dependencies: { ms: '2.1.3' },
        },
    };
    const listPackage = () => [
        '\\package.json',
        '\\node_modules\\debug\\package.json',
        '\\node_modules\\debug\\src\\index.js',
    ];
    const extractFile = (_asarPath, relativePath) => {
        // Mimic asar on win32: forward-slash lookups do not resolve.
        const manifest = files[relativePath];
        if (!manifest) {
            throw new Error(`${relativePath} was not found in this archive`);
        }
        return Buffer.from(JSON.stringify(manifest));
    };

    const { missing, packageCount, manifestReadFailures } =
        inspectPackagedDependencyClosure('app.asar', {
            listPackage,
            extractFile,
            pathSep: '\\',
        });

    assert.equal(packageCount, 1);
    assert.deepEqual(manifestReadFailures, []);
    assert.deepEqual(missing, [
        { dependency: 'ms', requiredBy: '/node_modules/debug' },
    ]);
});

test('inspectPackagedDependencyClosure surfaces manifest read failures instead of swallowing them', () => {
    const listPackage = () => ['/node_modules/broken/package.json'];
    const extractFile = () => {
        throw new Error('corrupt entry');
    };

    const { missing, packageCount, manifestReadFailures } =
        inspectPackagedDependencyClosure('app.asar', {
            listPackage,
            extractFile,
            pathSep: '/',
        });

    assert.deepEqual(missing, []);
    assert.equal(packageCount, 1);
    assert.deepEqual(manifestReadFailures, [
        { packageDir: '/node_modules/broken', message: 'corrupt entry' },
    ]);
});
