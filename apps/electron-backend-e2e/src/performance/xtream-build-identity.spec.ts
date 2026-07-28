import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    link,
    mkdir,
    mkdtemp,
    rm,
    symlink,
    unlink,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
    captureXtreamBuildIdentity,
    computeXtreamBuildFilesAggregate,
} from './xtream-build-identity';
import { assertXtreamBenchmarkManifest } from './xtream-exact-schema';
import { BUILD_IDENTITY, MANIFEST } from './xtream-benchmark-report.fixtures';

const directories: string[] = [];

afterEach(async () => {
    await Promise.all(
        directories
            .splice(0)
            .map((directory) => rm(directory, { force: true, recursive: true }))
    );
});

describe('Xtream benchmark build identity', () => {
    it('hashes exact Electron pairs and sorted top-level renderer code', async () => {
        const root = await buildFixture();

        const identity = await captureXtreamBuildIdentity(root);

        assert.deepEqual(identity.electron.main.javascript, {
            bytes: 4,
            path: 'dist/apps/electron-backend/main.js',
            sha256: sha256('main'),
        });
        assert.deepEqual(identity.electron.preload.sourceMap, {
            bytes: 11,
            path: 'dist/apps/electron-backend/main.preload.js.map',
            sha256: sha256('preload-map'),
        });
        assert.deepEqual(
            identity.renderer.files.map((file) => file.path),
            [
                'dist/apps/web/chunk-A.js',
                'dist/apps/web/chunk-A.js.map',
                'dist/apps/web/index.html',
                'dist/apps/web/main-A.js',
                'dist/apps/web/main-A.js.map',
            ]
        );
        assert.equal(identity.renderer.executableJavaScriptCount, 2);
        assert.equal(identity.renderer.sourceMapCount, 2);
        assert.equal(
            identity.renderer.bytes,
            identity.renderer.files.reduce(
                (total, file) => total + file.bytes,
                0
            )
        );
        assert.equal(
            identity.renderer.aggregateSha256,
            computeXtreamBuildFilesAggregate(identity.renderer.files)
        );
        assert.equal(
            identity.renderer.files.some((file) =>
                file.path.includes('app-config.js')
            ),
            false
        );
    });

    it('fails closed when an executable or its source map is missing', async () => {
        const missingElectron = await buildFixture();
        await unlink(
            join(
                missingElectron,
                'dist/apps/electron-backend/workers/database.worker.js.map'
            )
        );
        await assert.rejects(
            captureXtreamBuildIdentity(missingElectron),
            /invalid Xtream performance build/
        );

        const missingRendererMap = await buildFixture();
        await unlink(join(missingRendererMap, 'dist/apps/web/chunk-A.js.map'));
        await assert.rejects(
            captureXtreamBuildIdentity(missingRendererMap),
            /invalid Xtream performance build/
        );

        const orphanRendererMap = await buildFixture();
        await writeFile(
            join(orphanRendererMap, 'dist/apps/web/orphan.js.map'),
            'orphan'
        );
        await assert.rejects(
            captureXtreamBuildIdentity(orphanRendererMap),
            /invalid Xtream performance build/
        );
    });

    it('rejects symlinked and hard-linked build evidence', async () => {
        const symlinkRoot = await buildFixture();
        const mainPath = join(
            symlinkRoot,
            'dist/apps/electron-backend/main.js'
        );
        const external = join(symlinkRoot, 'external-main.js');
        await writeFile(external, 'main');
        await unlink(mainPath);
        await symlink(external, mainPath);
        await assert.rejects(
            captureXtreamBuildIdentity(symlinkRoot),
            /invalid Xtream performance build/
        );

        const hardLinkRoot = await buildFixture();
        await link(
            join(hardLinkRoot, 'dist/apps/web/main-A.js'),
            join(hardLinkRoot, 'main-alias.js')
        );
        await assert.rejects(
            captureXtreamBuildIdentity(hardLinkRoot),
            /invalid Xtream performance build/
        );
    });

    it('produces a different aggregate for path, byte, or hash drift', () => {
        const files = [
            { bytes: 1, path: 'a.js', sha256: 'a'.repeat(64) },
            { bytes: 2, path: 'a.js.map', sha256: 'b'.repeat(64) },
        ];
        const baseline = computeXtreamBuildFilesAggregate(files);

        for (const changed of [
            [{ ...files[0], path: 'b.js' }, files[1]],
            [{ ...files[0], bytes: 2 }, files[1]],
            [{ ...files[0], sha256: 'c'.repeat(64) }, files[1]],
        ]) {
            assert.notEqual(
                computeXtreamBuildFilesAggregate(changed),
                baseline
            );
        }
    });

    it('binds exact build descriptors into the persisted benchmark manifest', () => {
        assert.doesNotThrow(() => assertXtreamBenchmarkManifest(MANIFEST));
        const files = BUILD_IDENTITY.renderer.files;
        const invalidBuilds = [
            {
                ...BUILD_IDENTITY,
                renderer: {
                    ...BUILD_IDENTITY.renderer,
                    aggregateSha256: 'f'.repeat(64),
                },
            },
            {
                ...BUILD_IDENTITY,
                renderer: {
                    ...BUILD_IDENTITY.renderer,
                    bytes: BUILD_IDENTITY.renderer.bytes + 1,
                },
            },
            {
                ...BUILD_IDENTITY,
                renderer: {
                    ...BUILD_IDENTITY.renderer,
                    files: [...files].reverse(),
                },
            },
            {
                ...BUILD_IDENTITY,
                renderer: {
                    ...BUILD_IDENTITY.renderer,
                    files: files.slice(0, -1),
                },
            },
            {
                ...BUILD_IDENTITY,
                electron: {
                    ...BUILD_IDENTITY.electron,
                    main: {
                        ...BUILD_IDENTITY.electron.main,
                        javascript: {
                            ...BUILD_IDENTITY.electron.main.javascript,
                            path: 'dist/apps/electron-backend/other.js',
                        },
                    },
                },
            },
        ];
        for (const build of invalidBuilds) {
            assert.throws(
                () => assertXtreamBenchmarkManifest({ ...MANIFEST, build }),
                /invalid Xtream benchmark manifest/
            );
        }
    });
});

async function buildFixture(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'iptvnator-xtream-build-'));
    directories.push(root);
    const backend = join(root, 'dist/apps/electron-backend');
    const workers = join(backend, 'workers');
    const renderer = join(root, 'dist/apps/web');
    await Promise.all([
        mkdir(workers, { recursive: true }),
        mkdir(join(renderer, 'assets'), { recursive: true }),
    ]);
    await Promise.all([
        writeFile(join(backend, 'main.js'), 'main'),
        writeFile(join(backend, 'main.js.map'), 'main-map'),
        writeFile(join(backend, 'main.preload.js'), 'preload'),
        writeFile(join(backend, 'main.preload.js.map'), 'preload-map'),
        writeFile(join(workers, 'database.worker.js'), 'database'),
        writeFile(join(workers, 'database.worker.js.map'), 'database-map'),
        writeFile(join(workers, 'playlist-refresh.worker.js'), 'refresh'),
        writeFile(
            join(workers, 'playlist-refresh.worker.js.map'),
            'refresh-map'
        ),
        writeFile(join(renderer, 'index.html'), '<app-root/>'),
        writeFile(join(renderer, 'main-A.js'), 'renderer-main'),
        writeFile(join(renderer, 'main-A.js.map'), 'renderer-main-map'),
        writeFile(join(renderer, 'chunk-A.js'), 'renderer-chunk'),
        writeFile(join(renderer, 'chunk-A.js.map'), 'renderer-chunk-map'),
        writeFile(join(renderer, 'styles.css'), 'ignored'),
        writeFile(join(renderer, 'assets/app-config.js'), 'ignored'),
    ]);
    return root;
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}
