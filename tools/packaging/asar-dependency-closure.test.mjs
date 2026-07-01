import assert from 'node:assert/strict';
import test from 'node:test';

import {
    collectAsarPackageDirs,
    findMissingPackagedDependencies,
    inspectPackagedDependencyClosure,
    resolvePackagedDependency,
} from './asar-dependency-closure.mjs';

/**
 * Builds a `readManifest(dir)` backed by an in-memory map of
 * `{ packageDir: manifest }`, mirroring how manifests are read from an asar.
 */
function manifestReader(manifests) {
    return (packageDir) => manifests[packageDir] ?? null;
}

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

    const missing = inspectPackagedDependencyClosure('app.asar', {
        listPackage,
        extractFile,
    });

    assert.deepEqual(missing, [
        { dependency: 'ms', requiredBy: '/node_modules/debug' },
    ]);
});
