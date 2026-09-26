import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

import {
    DEFAULT_DIST_DIR,
    INITIAL_BYTES_COUNTER,
    extractInitialResources,
    formatReport,
    measureInitialBytes,
    parseArgs,
    stripInertHtml,
    toJourneySummary,
} from './measure-initial-bytes.mjs';

const scriptPath = fileURLToPath(
    new URL('./measure-initial-bytes.mjs', import.meta.url)
);

/** Mirrors the shape the Angular application builder emits for apps/web. */
const BUILT_INDEX_HTML = `<!doctype html>
<html><head>
<meta charset="utf-8"/>
<link rel="manifest" href="manifest.webmanifest"/>
<link rel="apple-touch-icon" href="assets/icons/apple-touch-icon.png"/>
<link rel="icon" type="image/x-icon" href="assets/icons/favicon.ico"/>
<script src="assets/app-config.js" defer=""></script>
<link rel="stylesheet" href="styles-VDU4SQ5F.css"></head>
<body class="mat-app-background"><app-root></app-root>
<link rel="modulepreload" href="chunk-B6uziQ1i.js"><link rel="modulepreload" href="chunk-Cn2Agfvf.js"><script src="polyfills-EBB6HFCX.js" type="module"></script><script src="main-EI6PCDGR.js" type="module"></script></body></html>`;

const BUILT_FILES = {
    'assets/app-config.js': 65,
    'styles-VDU4SQ5F.css': 311539,
    'chunk-B6uziQ1i.js': 1566,
    'chunk-Cn2Agfvf.js': 529624,
    'polyfills-EBB6HFCX.js': 35876,
    'main-EI6PCDGR.js': 1131437,
};

let workDir;

async function writeDist(
    name,
    { indexHtml = BUILT_INDEX_HTML, files = BUILT_FILES } = {}
) {
    const distDir = path.join(workDir, name);
    await mkdir(distDir, { recursive: true });
    if (indexHtml !== null) {
        await writeFile(path.join(distDir, 'index.html'), indexHtml);
    }
    for (const [file, bytes] of Object.entries(files)) {
        const target = path.join(distDir, file);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, 'x'.repeat(bytes));
    }
    return distDir;
}

before(async () => {
    workDir = await mkdtemp(path.join(os.tmpdir(), 'measure-initial-bytes-'));
});

after(async () => {
    await rm(workDir, { recursive: true, force: true });
});

test('extracts scripts, stylesheets and modulepreload chunks in document order', () => {
    assert.deepEqual(
        extractInitialResources(BUILT_INDEX_HTML).map(({ path, kind }) => ({
            path,
            kind,
        })),
        [
            { path: 'assets/app-config.js', kind: 'script' },
            { path: 'styles-VDU4SQ5F.css', kind: 'stylesheet' },
            { path: 'chunk-B6uziQ1i.js', kind: 'modulepreload' },
            { path: 'chunk-Cn2Agfvf.js', kind: 'modulepreload' },
            { path: 'polyfills-EBB6HFCX.js', kind: 'script' },
            { path: 'main-EI6PCDGR.js', kind: 'script' },
        ]
    );
});

test('ignores manifest, icon and external references', () => {
    const html = `
        <link rel="manifest" href="manifest.webmanifest">
        <link rel="icon" href="favicon.ico">
        <link rel="preconnect" href="https://fonts.gstatic.com">
        <link rel="stylesheet" href="https://cdn.example.com/theme.css">
        <script src="//cdn.example.com/analytics.js"></script>
        <script src="data:text/javascript,1"></script>
        <script>inline()</script>
        <script src="main.js" type="module"></script>`;
    assert.deepEqual(extractInitialResources(html), [
        { path: 'main.js', url: 'main.js', kind: 'script' },
    ]);
});

test('deduplicates by request URL, ignores fragments and normalizes relative URLs', () => {
    const html = `
        <LINK REL="modulepreload" HREF='./chunk-a.js'>
        <link rel="modulepreload" href="chunk-a.js">
        <link rel="modulepreload" href="chunk-a.js?v=2">
        <link rel="modulepreload" href="/chunk-b.js#hash">
        <link rel="modulepreload" href="chunk-b.js#other">
        <script src=main.js></script>
        <script src="main.js"></script>`;
    assert.deepEqual(extractInitialResources(html), [
        { path: 'chunk-a.js', url: 'chunk-a.js', kind: 'modulepreload' },
        { path: 'chunk-a.js', url: 'chunk-a.js?v=2', kind: 'modulepreload' },
        { path: 'chunk-b.js', url: 'chunk-b.js', kind: 'modulepreload' },
        { path: 'main.js', url: 'main.js', kind: 'script' },
    ]);
});

test('ignores commented-out tags and tag-like text inside inline scripts and styles', () => {
    const html = `
        <!-- <script src="old.js"></script> -->
        <!--
            <link rel="stylesheet" href="legacy.css">
        -->
        <script>const markup = '<script src="fake.js"><\\/script><link rel="modulepreload" href="fake-chunk.js">';</script>
        <style>/* <link rel="stylesheet" href="fake.css"> */ body { color: red; }</style>
        <script src="assets/app-config.js" defer></script>
        <script src="main.js" type="module"></script>`;
    assert.deepEqual(
        extractInitialResources(html).map((resource) => resource.url),
        ['assets/app-config.js', 'main.js']
    );
    assert.equal(stripInertHtml('<script>1 < 2</script>'), '<script></script>'); // Pieces around a removed comment must not assemble into a live tag.
    assert.deepEqual(
        extractInitialResources(
            '<!<!-- a -->-- <script src="x.js"></script> -->'
        ),
        []
    );
});

test('counts a file once per distinct request URL', async () => {
    const distDir = await writeDist('cache-busted', {
        indexHtml: `<link rel="modulepreload" href="chunk-a.js"><link rel="modulepreload" href="chunk-a.js?v=2">`,
        files: { 'chunk-a.js': 100 },
    });
    const measurement = await measureInitialBytes({ distDir });
    assert.equal(measurement.resources.length, 2);
    assert.equal(measurement.totals.modulepreload, 200);
});

test('sums index.html and every referenced file into the counter', async () => {
    const distDir = await writeDist('built');
    const measurement = await measureInitialBytes({ distDir });

    const indexBytes = Buffer.byteLength(BUILT_INDEX_HTML);
    const script = 65 + 35876 + 1131437;
    const stylesheet = 311539;
    const modulepreload = 1566 + 529624;

    assert.deepEqual(measurement.indexHtml, {
        path: 'index.html',
        bytes: indexBytes,
    });
    assert.equal(measurement.resources.length, 6);
    assert.deepEqual(measurement.totals, {
        indexHtml: indexBytes,
        script,
        stylesheet,
        modulepreload,
        initialBytes: indexBytes + script + stylesheet + modulepreload,
    });
    assert.deepEqual(measurement.counters, {
        [INITIAL_BYTES_COUNTER]:
            indexBytes + script + stylesheet + modulepreload,
    });
});

test('fails when index.html is missing instead of reporting zero bytes', async () => {
    const distDir = await writeDist('no-index', { indexHtml: null, files: {} });
    await assert.rejects(
        measureInitialBytes({ distDir }),
        /No index\.html under .*no-index.*pnpm nx build web/
    );
});

test('fails and names every referenced file that is missing from the build', async () => {
    const dropped = ['chunk-Cn2Agfvf.js', 'main-EI6PCDGR.js'];
    const files = Object.fromEntries(
        Object.entries(BUILT_FILES).filter(([file]) => !dropped.includes(file))
    );
    const distDir = await writeDist('missing-chunk', { files });
    await assert.rejects(
        measureInitialBytes({ distDir }),
        /not in .*missing-chunk: chunk-Cn2Agfvf\.js, main-EI6PCDGR\.js/
    );
});

test('journey summary carries the counter under the launch journey', async () => {
    const distDir = await writeDist('summary');
    const measurement = await measureInitialBytes({ distDir });
    const summary = toJourneySummary(measurement, {
        measuredAt: new Date('2026-09-26T00:00:00.000Z'),
    });
    assert.deepEqual(summary, {
        version: 1,
        measuredAt: '2026-09-26T00:00:00.000Z',
        journeys: {
            launch: {
                counters: {
                    [INITIAL_BYTES_COUNTER]: measurement.totals.initialBytes,
                },
            },
        },
    });
});

test('report lists the largest files first and ends with the counter', async () => {
    const distDir = await writeDist('report');
    const report = formatReport(await measureInitialBytes({ distDir }));
    const lines = report.split('\n');
    const mainLine = lines.findIndex((line) =>
        line.startsWith('main-EI6PCDGR.js')
    );
    const configLine = lines.findIndex((line) =>
        line.startsWith('assets/app-config.js')
    );
    assert.ok(mainLine > 0 && mainLine < configLine);
    assert.match(
        lines.at(-1),
        /^renderer\.initialBytes = [\d,]+ bytes \(6 files \+ index\.html\)$/
    );
});

test('parses CLI arguments and rejects unknown ones', () => {
    assert.deepEqual(parseArgs([]), {
        distDir: DEFAULT_DIST_DIR,
        json: false,
        summary: null,
    });
    assert.deepEqual(
        parseArgs(['--', '--dist', 'out', '--json', '--summary=s.json']),
        {
            distDir: 'out',
            json: true,
            summary: 's.json',
        }
    );
    assert.deepEqual(
        parseArgs(['--dist=out/web', '--summary', 'dist/s.json']).distDir,
        'out/web'
    );
    assert.throws(
        () => parseArgs(['--verbose']),
        /Unknown argument: --verbose/
    );
    assert.throws(() => parseArgs(['--dist']), /Missing value for --dist/);
});

test('CLI writes the journey summary and exits 0 on a complete build', async () => {
    const distDir = await writeDist('cli');
    const summaryPath = path.join(workDir, 'out', 'journey-summary.json');
    const stdout = execFileSync(
        process.execPath,
        [scriptPath, '--dist', distDir, '--summary', summaryPath],
        { encoding: 'utf8' }
    );
    assert.match(stdout, /renderer\.initialBytes = [\d,]+ bytes/);
    const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
    assert.equal(
        summary.journeys.launch.counters[INITIAL_BYTES_COUNTER],
        Buffer.byteLength(BUILT_INDEX_HTML) +
            Object.values(BUILT_FILES).reduce((sum, bytes) => sum + bytes, 0)
    );
});

test('CLI exits 1 with a readable message when the build is missing', () => {
    const result = spawnSync(
        process.execPath,
        [scriptPath, '--dist', path.join(workDir, 'does-not-exist')],
        { encoding: 'utf8' }
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /measure-initial-bytes: No index\.html under/);
});
