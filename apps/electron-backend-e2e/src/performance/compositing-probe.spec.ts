import assert from 'node:assert/strict';
import test from 'node:test';

import {
    describeLayerSize,
    findOversizedClipMasks,
    isSynthesizedClipMask,
    layerDevicePixels,
    layerScale,
    readTileMemoryFromTrace,
    type CompositedLayerWithReasons,
    type TraceEvent,
} from './compositing-probe';

function layer(
    overrides: Partial<CompositedLayerWithReasons> = {}
): CompositedLayerWithReasons {
    return {
        drawsContent: true,
        height: 1874,
        layerId: '317',
        reasons: [],
        width: 3340,
        ...overrides,
    };
}

/** A column-major 4x4 matrix scaling x and y. */
function scaleMatrix(x: number, y: number): number[] {
    return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

const contentArea = { dpr: 2, height: 1874, width: 3340 };

test('layerScale reads the x and y scale of a column-major transform', () => {
    assert.deepEqual(layerScale(layer()), { x: 1, y: 1 });
    assert.deepEqual(
        layerScale(layer({ transform: scaleMatrix(0.96, 0.96) })),
        {
            x: 0.96,
            y: 0.96,
        }
    );
    // A rotation keeps the axis length.
    const rotated = layer({
        transform: [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    });
    assert.deepEqual(layerScale(rotated), { x: 1, y: 1 });
});

test('layerDevicePixels applies the transform scale to the bounds', () => {
    assert.equal(layerDevicePixels(layer({ height: 10, width: 10 })), 100);
    assert.equal(
        Math.round(
            layerDevicePixels(
                layer({ height: 10, transform: scaleMatrix(0.5, 2), width: 10 })
            )
        ),
        100
    );
});

test('a synthesized clip mask draws content without an owner node or a reason', () => {
    assert.equal(isSynthesizedClipMask(layer()), true);
    assert.equal(isSynthesizedClipMask(layer({ backendNodeId: 42 })), false);
    assert.equal(isSynthesizedClipMask(layer({ reasons: ['Overlap'] })), false);
    assert.equal(isSynthesizedClipMask(layer({ drawsContent: false })), false);
    // A content layer whose first paint chunk belongs to an anonymous box
    // has no owner node but keeps its reason.
    assert.equal(
        isSynthesizedClipMask(
            layer({ backendNodeId: undefined, reasons: ['Overlap'] })
        ),
        false
    );
});

test('findOversizedClipMasks keeps masks of at least half the content area, at their scale', () => {
    const chevronMask = layer({
        height: 1955,
        layerId: '330',
        transform: scaleMatrix(0.96, 0.96),
        width: 3482,
    });
    const smallMask = layer({ height: 6, layerId: '400', width: 18 });
    const track = layer({
        backendNodeId: 7,
        height: 635,
        layerId: '324',
        reasons: ['Overlap'],
        width: 7520,
    });
    const nodelessTrack = layer({
        height: 1874,
        layerId: '209',
        reasons: ['Overlap'],
        width: 3340,
    });
    const halfMinusOne = layer({
        height: 1874,
        layerId: '500',
        width: 1669,
    });
    const masks = findOversizedClipMasks(
        [layer(), chevronMask, smallMask, track, nodelessTrack, halfMinusOne],
        contentArea
    );
    assert.deepEqual(
        masks.map((mask) => mask.layerId),
        ['317', '330']
    );
    assert.deepEqual(masks.map(describeLayerSize), [
        '317: 3340x1874',
        '330: 3482x1955',
    ]);
    assert.deepEqual(
        findOversizedClipMasks([halfMinusOne], contentArea, 0.4).map(
            (mask) => mask.layerId
        ),
        ['500']
    );
});

function dump(
    pid: number,
    allocators: Record<string, number | null>
): TraceEvent {
    const entries = Object.entries(allocators).map(([name, bytes]) => [
        name,
        bytes === null
            ? {}
            : {
                  attrs: {
                      size: { units: 'bytes', value: bytes.toString(16) },
                  },
              },
    ]);
    return {
        args: { dumps: { allocators: Object.fromEntries(entries) } },
        pid,
        ph: 'v',
    };
}

const MB = 1_048_576;

test('readTileMemoryFromTrace reports the renderer dump with the most tile memory', () => {
    const reading = readTileMemoryFromTrace([
        { ph: 'X', pid: 1 },
        dump(1, { 'skia/gpu_resources': 200 * MB }),
        dump(2, {
            'cc/image_memory': 118 * MB,
            'cc/tile_memory': 537 * MB,
            'cc/tile_memory/provider_1': null,
            'cc/tile_memory/provider_1/resource_1': 24 * MB,
            'cc/tile_memory/provider_1/resource_2': 24 * MB,
            'cc/tile_memory/provider_1/resource_3': 6.5 * MB,
        }),
        dump(3, {
            'cc/tile_memory': 12 * MB,
            'cc/tile_memory/provider_2/resource_1': 12 * MB,
        }),
    ]);
    assert.deepEqual(reading, {
        imageMB: 118,
        largestResourcesMB: [24, 24, 6.5],
        pid: 2,
        resourceCount: 3,
        tileMB: 537,
    });
});

test('readTileMemoryFromTrace yields nulls without a tile memory dump', () => {
    assert.deepEqual(
        readTileMemoryFromTrace([dump(1, { 'skia/gpu_resources': 10 * MB })]),
        {
            imageMB: null,
            largestResourcesMB: [],
            pid: null,
            resourceCount: 0,
            tileMB: null,
        }
    );
    assert.equal(readTileMemoryFromTrace([]).tileMB, null);
});

test('readTileMemoryFromTrace ignores sizes that are not byte counts', () => {
    const reading = readTileMemoryFromTrace([
        {
            args: {
                dumps: {
                    allocators: {
                        'cc/tile_memory': {
                            attrs: { size: { units: 'objects', value: '10' } },
                        },
                        'cc/tile_memory/provider_1/resource_1': {
                            attrs: { size: { units: 'bytes', value: 'zz' } },
                        },
                    },
                },
            },
            ph: 'v',
            pid: 9,
        },
    ]);
    assert.equal(reading.tileMB, null);
    assert.equal(reading.resourceCount, 0);
});
