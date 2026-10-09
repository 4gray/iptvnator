import type { CDPSession, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import sharp = require('sharp');

/**
 * Compositing probe: the page's cc layers with their compositing reasons
 * and owner nodes (Chrome DevTools Protocol `LayerTree` domain) and the
 * renderer's tile memory (`Tracing` with a memory-infra dump). Shared by
 * the compositing E2E guard and the `perf:compositing` report. Contract:
 * docs/architecture/performance-journeys.md#compositing-budget.
 */

export interface CompositedLayer {
    backendNodeId?: number;
    drawsContent: boolean;
    height: number;
    layerId: string;
    paintCount?: number;
    /** 4x4 matrix, column major; identity when absent. */
    transform?: number[];
    width: number;
}

export interface CompositedLayerWithReasons extends CompositedLayer {
    /** `LayerTree.compositingReasons` ids, e.g. `BackdropFilter`. */
    reasons: string[];
}

/** The clipped area a mask would have to cover, in device pixels. */
export interface ContentArea {
    dpr: number;
    height: number;
    width: number;
}

export interface TileMemoryReading {
    /** Decoded image memory held by cc (`cc/image_memory`). */
    imageMB: number | null;
    /** The largest tile resources, in MB, largest first. */
    largestResourcesMB: number[];
    pid: number | null;
    /** Number of tile resources in the renderer's resource pool. */
    resourceCount: number;
    /** `cc/tile_memory` of the renderer process, null when no dump had it. */
    tileMB: number | null;
}

/**
 * The resource pool keeps a freed tile for reuse for a few seconds; a
 * reading taken sooner after a change still counts the old tiles.
 */
export const TILE_POOL_SETTLE_MS = 6_500;

/** A layer's x and y scale from its transform (identity when absent). */
export function layerScale(layer: CompositedLayer): { x: number; y: number } {
    const matrix = layer.transform;
    if (!matrix || matrix.length < 6) {
        return { x: 1, y: 1 };
    }
    return {
        x: Math.hypot(matrix[0], matrix[1]),
        y: Math.hypot(matrix[4], matrix[5]),
    };
}

/** The device pixels a layer rasterizes at its current scale. */
export function layerDevicePixels(layer: CompositedLayer): number {
    const scale = layerScale(layer);
    return layer.width * scale.x * layer.height * scale.y;
}

/**
 * A clip mask Blink synthesized for a rounded clip (or a clip path) around
 * a composited effect. It is not painted for any element, so it has no
 * owner node and no compositing reason; every content layer carries at
 * least one reason, and a content layer can lack an owner node when its
 * first paint chunk belongs to an anonymous box, so the node alone does
 * not identify a mask.
 */
export function isSynthesizedClipMask(
    layer: CompositedLayerWithReasons
): boolean {
    return (
        layer.drawsContent && !layer.backendNodeId && layer.reasons.length === 0
    );
}

/**
 * Synthesized clip masks at least `ratio` of the content area: a rounded
 * scroller gives every composited effect inside it one of these, each the
 * size of the whole clipped area.
 */
export function findOversizedClipMasks(
    layers: readonly CompositedLayerWithReasons[],
    area: ContentArea,
    ratio = 0.5
): CompositedLayerWithReasons[] {
    const threshold = area.width * area.height * ratio;
    return layers.filter(
        (layer) =>
            isSynthesizedClipMask(layer) &&
            layerDevicePixels(layer) >= threshold
    );
}

export function describeLayerSize(layer: CompositedLayer): string {
    return `${layer.layerId}: ${layer.width}x${layer.height}`;
}

/** The content scroller's client area in device pixels. */
export async function measureContentArea(
    page: Page,
    selector = 'main.workspace-content'
): Promise<ContentArea> {
    return page.locator(selector).evaluate((element) => ({
        dpr: window.devicePixelRatio,
        height: element.clientHeight * window.devicePixelRatio,
        width: element.clientWidth * window.devicePixelRatio,
    }));
}

/**
 * The composited layers of the page with their compositing reasons. Blink
 * fills the layer debug info (reasons, owner nodes) in its first
 * layerization after the domain is enabled, so the snapshot is retried
 * until a layer reports a reason. Layer bounds are in device pixels.
 */
export async function collectCompositedLayers(
    cdp: CDPSession,
    page: Page
): Promise<CompositedLayerWithReasons[]> {
    let layers: CompositedLayer[] = [];
    const onChange = (event: { layers?: CompositedLayer[] }) => {
        layers = event.layers ?? [];
    };
    cdp.on('LayerTree.layerTreeDidChange', onChange);
    let withReasons: CompositedLayerWithReasons[] = [];
    const snapshot = async () => {
        await page.evaluate(
            () =>
                new Promise((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(resolve))
                )
        );
        const result: CompositedLayerWithReasons[] = [];
        for (const layer of layers) {
            let reasons: string[] = [];
            try {
                const answer = (await cdp.send('LayerTree.compositingReasons', {
                    layerId: layer.layerId,
                })) as { compositingReasonIds?: string[] };
                reasons = answer.compositingReasonIds ?? [];
            } catch {
                // The layer went away between the snapshot and the query.
            }
            result.push({ ...layer, reasons });
        }
        return result;
    };
    try {
        await cdp.send('LayerTree.enable');
        await expect
            .poll(async () => {
                withReasons = await snapshot();
                return withReasons.filter((layer) => layer.reasons.length > 0)
                    .length;
            })
            .toBeGreaterThan(0);
        await cdp.send('LayerTree.disable');
    } finally {
        cdp.off('LayerTree.layerTreeDidChange', onChange);
    }
    return withReasons;
}

/**
 * `tag#id.class` of the layer's owner node, or `(no owner node)`: a
 * synthesized mask has none, and so has a content layer whose first paint
 * chunk belongs to an anonymous box.
 */
export async function describeLayerOwner(
    cdp: CDPSession,
    layer: CompositedLayer
): Promise<string> {
    if (!layer.backendNodeId) {
        return '(no owner node)';
    }
    try {
        const described = (await cdp.send('DOM.describeNode', {
            backendNodeId: layer.backendNodeId,
        })) as { node: { attributes?: string[]; nodeName: string } };
        const attributes = described.node.attributes ?? [];
        const idIndex = attributes.indexOf('id');
        const classIndex = attributes.indexOf('class');
        const id = idIndex >= 0 ? `#${attributes[idIndex + 1]}` : '';
        const classes =
            classIndex >= 0
                ? attributes[classIndex + 1]
                      .trim()
                      .split(/\s+/)
                      .filter((name) => name && !name.startsWith('ng-'))
                      .map((name) => `.${name}`)
                      .join('')
                : '';
        return `${described.node.nodeName.toLowerCase()}${id}${classes}`;
    } catch {
        return `backendNodeId:${layer.backendNodeId}`;
    }
}

interface TraceAllocator {
    attrs?: Record<string, { units?: string; value?: string }>;
}

export interface TraceEvent {
    args?: { dumps?: { allocators?: Record<string, TraceAllocator> } };
    ph?: string;
    pid?: number;
}

function allocatorMB(allocator: TraceAllocator | undefined): number | null {
    const size = allocator?.attrs?.['size'];
    if (!size || size.units !== 'bytes' || typeof size.value !== 'string') {
        return null;
    }
    const bytes = Number.parseInt(size.value, 16);
    return Number.isFinite(bytes)
        ? Number((bytes / 1_048_576).toFixed(1))
        : null;
}

/**
 * The renderer's tile memory from memory-infra dump events (`ph: "v"`).
 * `cc/tile_memory` is the resource pool's total; its children
 * `cc/tile_memory/provider_N/resource_M` are the tiles. Of several
 * processes with tile memory the largest is reported.
 */
export function readTileMemoryFromTrace(
    events: readonly TraceEvent[]
): TileMemoryReading {
    let best: TileMemoryReading = {
        imageMB: null,
        largestResourcesMB: [],
        pid: null,
        resourceCount: 0,
        tileMB: null,
    };
    for (const event of events) {
        const allocators = event.args?.dumps?.allocators;
        if (event.ph !== 'v' || !allocators?.['cc/tile_memory']) {
            continue;
        }
        const resources: number[] = [];
        for (const [name, allocator] of Object.entries(allocators)) {
            const parts = name.split('/');
            const isTile =
                parts.length === 4 &&
                parts[0] === 'cc' &&
                parts[1] === 'tile_memory';
            const size = isTile ? allocatorMB(allocator) : null;
            if (size !== null) {
                resources.push(size);
            }
        }
        const reading: TileMemoryReading = {
            imageMB: allocatorMB(allocators['cc/image_memory']),
            largestResourcesMB: resources.sort((a, b) => b - a).slice(0, 6),
            pid: event.pid ?? null,
            resourceCount: resources.length,
            tileMB: allocatorMB(allocators['cc/tile_memory']),
        };
        if ((reading.tileMB ?? 0) > (best.tileMB ?? -1)) {
            best = reading;
        }
    }
    return best;
}

async function captureTileMemoryOnce(
    cdp: CDPSession
): Promise<TileMemoryReading> {
    const events: TraceEvent[] = [];
    const onData = (event: { value?: TraceEvent[] }) => {
        events.push(...(event.value ?? []));
    };
    cdp.on('Tracing.dataCollected', onData);
    const complete = new Promise<void>((resolve) =>
        cdp.once('Tracing.tracingComplete', () => resolve())
    );
    try {
        await cdp.send('Tracing.start', {
            traceConfig: {
                includedCategories: ['disabled-by-default-memory-infra'],
                recordMode: 'recordContinuously',
            },
            transferMode: 'ReportEvents',
        });
        await cdp.send('Tracing.requestMemoryDump', {
            levelOfDetail: 'detailed',
        });
        // The dump's trace events reach the buffer shortly after the
        // request resolves; ending the trace at once can miss them.
        await new Promise((resolve) => setTimeout(resolve, 250));
        await cdp.send('Tracing.end');
        await complete;
    } finally {
        cdp.off('Tracing.dataCollected', onData);
    }
    return readTileMemoryFromTrace(events);
}

/**
 * One detailed memory-infra dump of the page's renderer. A dump that
 * carries no renderer tile memory (a process can skip a dump it is busy
 * for) is retried a few times before the reading stays null.
 */
export async function captureTileMemory(
    cdp: CDPSession,
    attempts = 3
): Promise<TileMemoryReading> {
    let reading = await captureTileMemoryOnce(cdp);
    for (let attempt = 1; attempt < attempts && reading.tileMB === null;) {
        reading = await captureTileMemoryOnce(cdp);
        attempt += 1;
    }
    return reading;
}

const artworkCache = new Map<string, Buffer>();

/**
 * Serves every picsum.photos request of the mock catalogs from memory: an
 * opaque gradient of the requested size, so the probe never leaves the
 * machine and every image loads (tile and image memory depend on an image
 * being there, not on what it shows).
 */
export async function routeDeterministicArtwork(page: Page): Promise<void> {
    await page.route(
        (url) => url.hostname === 'picsum.photos',
        async (route) => {
            const match = new URL(route.request().url()).pathname.match(
                /\/seed\/([^/]+)\/(\d+)\/(\d+)/
            );
            if (!match) {
                await route.fulfill({ body: '', status: 404 });
                return;
            }
            const [, seed, width, height] = match;
            const key = `${seed}-${width}x${height}`;
            let body = artworkCache.get(key);
            if (body === undefined) {
                let hash = 0;
                for (const char of seed) {
                    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
                }
                const r = 60 + (hash % 160);
                const g = 60 + ((hash >> 8) % 160);
                const b = 60 + ((hash >> 16) % 160);
                const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgb(${r},${g},${b})"/><stop offset="1" stop-color="rgb(${b},${r},${g})"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
                const generated: Buffer = await sharp(Buffer.from(svg))
                    .png()
                    .toBuffer();
                artworkCache.set(key, generated);
                body = generated;
            }
            await route.fulfill({
                body,
                contentType: 'image/png',
                status: 200,
            });
        }
    );
}
