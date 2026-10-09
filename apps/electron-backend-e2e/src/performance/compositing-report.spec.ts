import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
    COMPOSITING_SUMMARY_SCHEMA_VERSION,
    formatCompositingTable,
    resolveCompositingSummaryPath,
    writeCompositingSummary,
    type CompositingSummary,
} from './compositing-report';

function summary(): CompositingSummary {
    return {
        generatedAt: '2026-10-09T10:00:00.000Z',
        harness: {
            arch: 'arm64',
            electronVersion: '43.3.0',
            gpuCompositing: 'enabled',
            platform: 'darwin',
            window: { dpr: 2, height: 1000, width: 1600 },
        },
        routes: [
            {
                backdropFilterLayers: 9,
                clipMasks: [],
                drawingLayers: 35,
                imageMB: 117.4,
                largestLayers: [
                    {
                        devicePixelsMB: 38.9,
                        height: 3060,
                        owner: 'main.workspace-content',
                        reasons: ['Overlap'],
                        scale: 1,
                        width: 3336,
                    },
                ],
                route: 'dashboard',
                tileMB: 241.6,
                tileResources: 51,
                tileWarnings: 0,
                totalLayers: 43,
                url: '/workspace/dashboard',
            },
            {
                backdropFilterLayers: 0,
                clipMasks: ['330: 3482x1955'],
                drawingLayers: 46,
                imageMB: null,
                largestLayers: [],
                route: 'settings',
                tileMB: null,
                tileResources: 0,
                tileWarnings: 7,
                totalLayers: 54,
                url: '/workspace/settings',
            },
        ],
        schemaVersion: COMPOSITING_SUMMARY_SCHEMA_VERSION,
    };
}

test('resolveCompositingSummaryPath puts one run under dist/performance/compositing', () => {
    assert.equal(
        resolveCompositingSummaryPath(
            '/repo',
            new Date('2026-10-09T10:11:12.345Z')
        ),
        join(
            '/repo',
            'dist',
            'performance',
            'compositing',
            '20261009T101112Z',
            'summary.json'
        )
    );
});

test('writeCompositingSummary writes the JSON once and never overwrites it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'compositing-summary-'));
    try {
        const path = join(directory, 'nested', 'summary.json');
        await writeCompositingSummary(path, summary());
        assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), summary());
        await assert.rejects(writeCompositingSummary(path, summary()), {
            code: 'EEXIST',
        });
    } finally {
        await rm(directory, { force: true, recursive: true });
    }
});

test('formatCompositingTable lists every route with its memory, masks and warnings', () => {
    const table = formatCompositingTable(summary());
    const lines = table.split('\n');
    assert.match(
        lines[0],
        /1600x1000 @2x, gpu compositing enabled, Electron 43\.3\.0/
    );
    assert.match(
        lines[1],
        /route\s+tile MB\s+image MB\s+layers\s+backdrop\s+masks\s+warn/
    );
    const dashboard = lines.find((line) => line.startsWith('dashboard'));
    assert.ok(dashboard);
    assert.match(dashboard, /241\.6\s+117\.4\s+35\/43\s+9\s+0\s+0$/);
    assert.match(
        lines[lines.indexOf(dashboard) + 1],
        /38\.9 MB 3336x3060 s=1 main\.workspace-content \[Overlap\]/
    );
    const settings = lines.find((line) => line.startsWith('settings'));
    assert.ok(settings);
    assert.match(settings, /-\s+-\s+46\/54\s+0\s+1\s+7$/);
});
