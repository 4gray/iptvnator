import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { formatJourneyOutputTimestamp } from './journey-summary';

/**
 * Summary written by `pnpm run perf:compositing`
 * (`src/compositing/compositing.report.ts`): one reading per route, with
 * the renderer's tile memory and the largest composited layers. Contract:
 * docs/architecture/performance-journeys.md#compositing-budget.
 */
export const COMPOSITING_SUMMARY_SCHEMA_VERSION = 1;

export interface CompositingLayerSummary {
    /** Device pixels the layer rasterizes at its scale, in MB of RGBA. */
    devicePixelsMB: number;
    height: number;
    /** `tag#id.class` of the owner node, or `(no owner node)`. */
    owner: string;
    reasons: string[];
    scale: number;
    width: number;
}

export interface CompositingRouteReading {
    /** Composited layers whose reasons include `BackdropFilter`. */
    backdropFilterLayers: number;
    /** Synthesized clip masks at least half the content area (`id: WxH`). */
    clipMasks: string[];
    drawingLayers: number;
    imageMB: number | null;
    largestLayers: CompositingLayerSummary[];
    route: string;
    tileMB: number | null;
    tileResources: number;
    /** "tile memory limits exceeded" lines on stderr while on the route. */
    tileWarnings: number;
    totalLayers: number;
    url: string;
}

export interface CompositingSummary {
    generatedAt: string;
    harness: {
        arch: string;
        electronVersion: string;
        /** `gpu_compositing` from `app.getGPUFeatureStatus()`. */
        gpuCompositing: string;
        platform: string;
        window: { dpr: number; height: number; width: number };
    };
    routes: CompositingRouteReading[];
    schemaVersion: number;
}

export function resolveCompositingSummaryPath(
    repositoryRoot: string,
    date: Date = new Date()
): string {
    return join(
        repositoryRoot,
        'dist',
        'performance',
        'compositing',
        formatJourneyOutputTimestamp(date),
        'summary.json'
    );
}

/** Writes the summary; an existing file is never overwritten. */
export async function writeCompositingSummary(
    summaryPath: string,
    summary: CompositingSummary
): Promise<void> {
    await mkdir(dirname(summaryPath), { recursive: true });
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, {
        flag: 'wx',
    });
}

function pad(value: string | number, width: number): string {
    return String(value).padStart(width);
}

/** A fixed-width table of the routes for the console. */
export function formatCompositingTable(summary: CompositingSummary): string {
    const { window } = summary.harness;
    const lines = [
        `compositing budget: ${window.width}x${window.height} @${window.dpr}x, gpu compositing ${summary.harness.gpuCompositing}, Electron ${summary.harness.electronVersion}`,
        `${'route'.padEnd(20)} ${pad('tile MB', 8)} ${pad('image MB', 9)} ${pad('layers', 7)} ${pad('backdrop', 9)} ${pad('masks', 6)} ${pad('warn', 5)}`,
    ];
    for (const route of summary.routes) {
        lines.push(
            `${route.route.padEnd(20)} ${pad(route.tileMB ?? '-', 8)} ${pad(route.imageMB ?? '-', 9)} ${pad(`${route.drawingLayers}/${route.totalLayers}`, 7)} ${pad(route.backdropFilterLayers, 9)} ${pad(route.clipMasks.length, 6)} ${pad(route.tileWarnings, 5)}`
        );
        for (const layer of route.largestLayers) {
            lines.push(
                `    ${pad(layer.devicePixelsMB.toFixed(1), 7)} MB ${layer.width}x${layer.height} s=${layer.scale} ${layer.owner} [${layer.reasons.join(',')}]`
            );
        }
    }
    return lines.join('\n');
}
