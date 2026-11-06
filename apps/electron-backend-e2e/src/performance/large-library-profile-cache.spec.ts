import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
    LARGE_LIBRARY_MANIFEST_PREFIX,
    LARGE_LIBRARY_PROFILE_SPEC,
    type LargeLibraryProfileManifest,
} from './large-library-profile';
import {
    LARGE_LIBRARY_PROFILE_CACHE_DEFAULT,
    LARGE_LIBRARY_PROFILE_CACHE_ENV,
    largeLibraryProfileCacheKey,
    largeLibraryProfileCacheKeyInputs,
    parseGeneratorManifest,
    readLargeLibraryProfileManifest,
    resolveLargeLibraryProfileCacheRoot,
    type LargeLibraryProfileCacheKeyInputs,
} from './large-library-profile-cache';

const WORKSPACE_ROOT = join(__dirname, '../../../..');

function manifest(
    overrides: Partial<LargeLibraryProfileManifest> = {}
): LargeLibraryProfileManifest {
    return {
        cacheKey: 'abc',
        counts: { content: 10 },
        databaseBytes: 5,
        electron: '43.3.0',
        generationMs: 12,
        phasesMs: {},
        spec: LARGE_LIBRARY_PROFILE_SPEC,
        sqlite: '3.53.4',
        version: 1,
        ...overrides,
    };
}

function withTempDir(run: (directory: string) => void): void {
    const directory = mkdtempSync(join(tmpdir(), 'large-library-cache-'));
    try {
        run(directory);
    } finally {
        rmSync(directory, { force: true, recursive: true });
    }
}

test('the cache key covers the spec, the generator, the schema code and the native versions', () => {
    const inputs = largeLibraryProfileCacheKeyInputs(
        WORKSPACE_ROOT,
        LARGE_LIBRARY_PROFILE_SPEC
    );
    assert.deepEqual(Object.keys(inputs.packages).sort(), [
        'better-sqlite3',
        'drizzle-orm',
        'electron',
    ]);
    assert.match(inputs.databaseLibrarySha256, /^[0-9a-f]{64}$/);
    assert.match(inputs.generatorSha256, /^[0-9a-f]{64}$/);
    const key = largeLibraryProfileCacheKey(inputs);
    assert.match(key, /^[0-9a-f]{32}$/);
    assert.equal(largeLibraryProfileCacheKey(inputs), key);
    const variants: LargeLibraryProfileCacheKeyInputs[] = [
        { ...inputs, version: inputs.version + 1 },
        {
            ...inputs,
            spec: { ...inputs.spec, contentPerPortal: 7 },
        },
        { ...inputs, generatorSha256: 'f'.repeat(64) },
        { ...inputs, databaseLibrarySha256: 'f'.repeat(64) },
        { ...inputs, packages: { ...inputs.packages, electron: '0.0.0' } },
    ];
    const keys = new Set(variants.map(largeLibraryProfileCacheKey));
    assert.equal(keys.size, variants.length);
    assert.ok(!keys.has(key));
});

test('the schema hash follows the database library, not its tests', () => {
    withTempDir((root) => {
        const library = join(root, 'libs/shared/database/src/lib');
        mkdirSync(join(library, 'testing'), { recursive: true });
        for (const name of ['electron', 'better-sqlite3', 'drizzle-orm']) {
            mkdirSync(join(root, 'node_modules', name), { recursive: true });
            writeFileSync(
                join(root, 'node_modules', name, 'package.json'),
                JSON.stringify({ version: '1.0.0' })
            );
        }
        const generators = join(
            root,
            'apps/electron-backend-e2e/src/performance'
        );
        mkdirSync(generators, { recursive: true });
        writeFileSync(join(generators, 'large-library-profile.ts'), 'a');
        writeFileSync(
            join(generators, 'large-library-profile-generator.ts'),
            'b'
        );
        writeFileSync(join(library, 'schema.ts'), 'schema v1');
        const before = largeLibraryProfileCacheKeyInputs(
            root,
            LARGE_LIBRARY_PROFILE_SPEC
        );
        writeFileSync(join(library, 'schema.spec.ts'), 'a test');
        writeFileSync(join(library, 'testing/fixture.ts'), 'a fixture');
        const withTests = largeLibraryProfileCacheKeyInputs(
            root,
            LARGE_LIBRARY_PROFILE_SPEC
        );
        assert.equal(
            withTests.databaseLibrarySha256,
            before.databaseLibrarySha256
        );
        writeFileSync(join(library, 'schema.ts'), 'schema v2');
        const changed = largeLibraryProfileCacheKeyInputs(
            root,
            LARGE_LIBRARY_PROFILE_SPEC
        );
        assert.notEqual(
            changed.databaseLibrarySha256,
            before.databaseLibrarySha256
        );
        assert.equal(changed.generatorSha256, before.generatorSha256);
    });
});

test('the cache root defaults under node_modules and follows the override', () => {
    assert.equal(
        resolveLargeLibraryProfileCacheRoot('/ws', {}),
        join('/ws', LARGE_LIBRARY_PROFILE_CACHE_DEFAULT)
    );
    assert.equal(
        resolveLargeLibraryProfileCacheRoot('/ws', {
            [LARGE_LIBRARY_PROFILE_CACHE_ENV]: 'tmp/profiles',
        }),
        join('/ws', 'tmp/profiles')
    );
    assert.equal(
        resolveLargeLibraryProfileCacheRoot('/ws', {
            [LARGE_LIBRARY_PROFILE_CACHE_ENV]: '/elsewhere',
        }),
        '/elsewhere'
    );
});

test('the generator manifest is the last prefixed stdout line', () => {
    const printed = manifest();
    const stdout = [
        'noise',
        `${LARGE_LIBRARY_MANIFEST_PREFIX}${JSON.stringify(manifest({ cacheKey: 'old' }))}`,
        `${LARGE_LIBRARY_MANIFEST_PREFIX}${JSON.stringify(printed)}`,
        '',
    ].join('\n');
    assert.deepEqual(parseGeneratorManifest(stdout), printed);
    assert.throws(() => parseGeneratorManifest('nothing here'), /missing/);
});

test('a cached profile needs its manifest and a database of the recorded size', () => {
    withTempDir((directory) => {
        assert.equal(readLargeLibraryProfileManifest(directory), null);
        mkdirSync(join(directory, 'databases'));
        writeFileSync(join(directory, 'databases/iptvnator.db'), 'abcde');
        assert.equal(readLargeLibraryProfileManifest(directory), null);
        writeFileSync(
            join(directory, 'manifest.json'),
            JSON.stringify(manifest({ databaseBytes: 4 }))
        );
        assert.equal(readLargeLibraryProfileManifest(directory), null);
        writeFileSync(
            join(directory, 'manifest.json'),
            JSON.stringify(manifest({ databaseBytes: 5 }))
        );
        assert.deepEqual(
            readLargeLibraryProfileManifest(directory),
            manifest({ databaseBytes: 5 })
        );
    });
});
