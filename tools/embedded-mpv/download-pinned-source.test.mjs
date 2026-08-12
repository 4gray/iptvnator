import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const downloaderPath = path.join(currentDir, 'download-pinned-source.mjs');
const macosBuilderPath = path.join(currentDir, 'build-macos-runtime.mjs');
const linuxBuilderPath = path.join(currentDir, 'build-linux-runtime.mjs');
const workspaceRoot = path.resolve(currentDir, '..', '..');
const buildWorkflowPath = path.join(
    workspaceRoot,
    '.github',
    'workflows',
    'build-and-make.yaml'
);
const snapSourceBindingPath = path.join(
    workspaceRoot,
    'tools',
    'packaging',
    'release-snap-source-binding.cjs'
);
const require = createRequire(import.meta.url);
const { SOURCE_PACKAGES } = require('./build-linux-runtime.cjs');
const { downloadPinnedSource } = await import(pathToFileURL(downloaderPath));

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function withTemporaryDirectory(run) {
    const temporaryDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-pinned-source-test-')
    );
    try {
        return run(temporaryDirectory);
    } finally {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
}

test('provides the pinned source archive downloader', () => {
    assert.equal(fs.existsSync(downloaderPath), true);
});

test('pins official FreeType mirrors in the macOS runtime builder', () => {
    const builderSource = fs.readFileSync(macosBuilderPath, 'utf8');
    const sourceForgeUrl =
        'https://downloads.sourceforge.net/project/freetype/freetype2/2.13.3/freetype-2.13.3.tar.xz';
    const savannahUrl =
        'https://download.savannah.gnu.org/releases/freetype/freetype-2.13.3.tar.xz';

    assert.match(builderSource, /downloadPinnedSource/);
    assert.ok(builderSource.indexOf(sourceForgeUrl) >= 0);
    assert.ok(
        builderSource.indexOf(savannahUrl) >
            builderSource.indexOf(sourceForgeUrl)
    );
    assert.match(
        builderSource,
        /0550350666d427c74daeb85d5ac7bb353acba5f76956395995311a9c6f063289/
    );
    assert.match(
        builderSource,
        /const\s*\{\s*sourceSha256,\s*sourceUrl,\s*sourceUrls\s*\}\s*=\s*downloadPinnedSource/
    );
    assert.match(builderSource, /sourcePackage\.sourceUrl = sourceUrl/);
    assert.match(builderSource, /sourcePackage\.sourceUrls = sourceUrls/);
    assert.match(
        builderSource,
        /sourceUrl:\s*sourcePackage\.sourceUrl\s*\?\?\s*sourcePackage\.url/
    );
    assert.match(
        builderSource,
        /sourcePackage\.sourceUrls\s*\?\s*\{\s*sourceUrls:\s*sourcePackage\.sourceUrls\s*\}/
    );
});

test('includes the pinned downloader in the macOS runtime cache key', () => {
    assert.match(
        fs.readFileSync(buildWorkflowPath, 'utf8'),
        /tools\/embedded-mpv\/download-pinned-source\.mjs/
    );
});

test('routes the Linux runtime builder through the shared pinned downloader', () => {
    const builderSource = fs.readFileSync(linuxBuilderPath, 'utf8');

    assert.match(
        builderSource,
        /import \{ downloadPinnedSource \} from '\.\/download-pinned-source\.mjs';/
    );
    assert.match(
        builderSource,
        /const\s*\{\s*sourceSha256,\s*sourceUrl\s*\}\s*=\s*downloadPinnedSource/
    );
    assert.match(builderSource, /urls: sourceUrlsFor\(sourcePackage\)/);
    // The Linux manifest, its notices and the Snap publication boundary all
    // compare sourceUrl against the immutable pin, so unlike the macOS builder
    // the resolved mirror must never overwrite the recorded source URL.
    assert.doesNotMatch(builderSource, /sourcePackage\.sourceUrl =/);
    for (const flag of [
        "'--fail'",
        "'--location'",
        "'--proto'",
        "'=https'",
        "'--tlsv1.2'",
    ]) {
        assert.ok(builderSource.includes(flag), flag);
    }
});

test('pins second-host mirrors for single-source Linux archives', () => {
    const mirrored = SOURCE_PACKAGES.filter(({ mirrors }) => mirrors);
    assert.deepEqual(
        mirrored.map(({ id }) => id),
        ['freetype', 'fontconfig', 'libdisplay-info']
    );

    for (const sourcePackage of SOURCE_PACKAGES) {
        const primary = new URL(sourcePackage.sourceUrl);
        if (/(^|\.)freedesktop\.org$/.test(primary.hostname)) {
            // freedesktop.org rate-limits GitHub runners with HTTP 418, which
            // is what made a single pinned host flaky in the first place.
            assert.ok(
                sourcePackage.mirrors?.length > 0,
                `${sourcePackage.id} must pin a mirror`
            );
        }
        for (const mirror of sourcePackage.mirrors ?? []) {
            const mirrorUrl = new URL(mirror);
            assert.equal(mirrorUrl.protocol, 'https:');
            assert.notEqual(mirrorUrl.hostname, primary.hostname);
            assert.equal(
                path.posix.basename(mirrorUrl.pathname),
                path.posix.basename(primary.pathname)
            );
        }
    }
});

test('ships and cache-keys every released Linux runtime tooling file', () => {
    const workflow = fs.readFileSync(buildWorkflowPath, 'utf8');
    const releasedTooling = [
        ...fs
            .readFileSync(snapSourceBindingPath, 'utf8')
            .matchAll(/archivePath: 'tooling\/([^']+)'/g),
    ].map(([, name]) => name);

    assert.ok(releasedTooling.includes('download-pinned-source.mjs'));

    // The archive must carry every build script the Linux builder needs, so
    // the workflow's copy list has to stay in step with the released set.
    const [, copiedBlock] =
        workflow.match(
            /cp \\\n((?:\s+\S+ \\\n)+)\s+"\$\{SOURCE_BUNDLE_ROOT\}\/tooling\/"/
        ) ?? [];
    assert.ok(copiedBlock, 'source bundle tooling copy step');
    assert.deepEqual(
        copiedBlock
            .split('\n')
            .map((line) => line.trim().replace(/ \\$/, ''))
            .filter(Boolean)
            .map((toolingPath) => path.posix.basename(toolingPath))
            .sort(),
        [...releasedTooling].sort()
    );
    assert.match(
        workflow,
        /hashFiles\([^)]*tools\/embedded-mpv\/download-pinned-source\.mjs[^)]*\)/
    );
});

test('uses the next mirror when the primary source is unavailable', () => {
    withTemporaryDirectory((temporaryDirectory) => {
        const archive = Buffer.from('verified source archive');
        const archivePath = path.join(temporaryDirectory, 'source.tar.xz');
        const urls = [
            'https://primary.example/source.tar.xz',
            'https://fallback.example/source.tar.xz',
        ];
        const attempts = [];

        const result = downloadPinnedSource({
            archivePath,
            expectedSha256: sha256(archive),
            urls,
            download: ({ destinationPath, url }) => {
                attempts.push(url);
                if (url === urls[0]) {
                    throw new Error('primary unavailable');
                }
                fs.writeFileSync(destinationPath, archive);
            },
        });

        assert.deepEqual(attempts, urls);
        assert.deepEqual(fs.readFileSync(archivePath), archive);
        assert.deepEqual(result, {
            sourceSha256: sha256(archive),
            sourceUrl: urls[1],
            sourceUrls: urls,
        });
        assert.equal(fs.existsSync(`${archivePath}.partial`), false);
    });
});

test('rejects mirrors whose archive does not match the pinned checksum', () => {
    withTemporaryDirectory((temporaryDirectory) => {
        const archivePath = path.join(temporaryDirectory, 'source.tar.xz');
        const urls = [
            'https://primary.example/source.tar.xz',
            'https://fallback.example/source.tar.xz',
        ];

        assert.throws(
            () =>
                downloadPinnedSource({
                    archivePath,
                    expectedSha256: sha256('expected archive'),
                    urls,
                    download: ({ destinationPath }) =>
                        fs.writeFileSync(destinationPath, 'corrupt archive'),
                }),
            /Unable to download a verified source archive.*SHA-256 mismatch/is
        );
        assert.equal(fs.existsSync(archivePath), false);
        assert.equal(fs.existsSync(`${archivePath}.partial`), false);
    });
});
