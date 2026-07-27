import { createHash } from 'node:crypto';

export const SYNTHETIC_M3U_SEED = 240_724;
export const SYNTHETIC_M3U_CHANNEL_COUNT = 100_000;
export const SUPPORTED_SYNTHETIC_M3U_CHANNEL_COUNTS = [
    10_000,
    50_000,
    SYNTHETIC_M3U_CHANNEL_COUNT,
] as const;

export type SyntheticM3uChannelCount =
    (typeof SUPPORTED_SYNTHETIC_M3U_CHANNEL_COUNTS)[number];

export interface SyntheticM3uFixture {
    readonly body: string;
    readonly bytes: number;
    readonly channelCount: SyntheticM3uChannelCount;
    readonly sha256: string;
}

export function createSyntheticM3uFixture(
    channelCount: number = SYNTHETIC_M3U_CHANNEL_COUNT
): SyntheticM3uFixture {
    assertSupportedChannelCount(channelCount);
    const lines = new Array<string>(1 + channelCount * 2);
    lines[0] = '#EXTM3U';

    for (let offset = 0; offset < channelCount; offset += 1) {
        const index = offset + 1;
        const group = (offset % 100) + 1;
        const lineOffset = 1 + offset * 2;
        const stableIndex = String(index).padStart(6, '0');

        lines[lineOffset] = `#EXTINF:-1 group-title="Synthetic Group ${String(
            group
        ).padStart(
            3,
            '0'
        )}",Synthetic Channel ${SYNTHETIC_M3U_SEED}-${stableIndex}`;
        lines[lineOffset + 1] =
            `http://127.0.0.1/stream/${SYNTHETIC_M3U_SEED}/${index}`;
    }

    const body = `${lines.join('\n')}\n`;
    return Object.freeze({
        body,
        bytes: Buffer.byteLength(body, 'utf8'),
        channelCount,
        sha256: createHash('sha256').update(body, 'utf8').digest('hex'),
    });
}

function assertSupportedChannelCount(
    channelCount: number
): asserts channelCount is SyntheticM3uChannelCount {
    if (
        !SUPPORTED_SYNTHETIC_M3U_CHANNEL_COUNTS.some(
            (supported) => supported === channelCount
        )
    ) {
        throw new Error(
            `Unsupported synthetic M3U channel count: ${channelCount}`
        );
    }
}
