import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
    expect,
    test,
    type LaunchedElectronApp,
} from './electron-test-fixtures';
import {
    getLatestSession,
    renderedFrameSignal,
} from './embedded-mpv-frame-copy-packaged-fixtures';

/**
 * Failure diagnostics for the packaged frame-copy smoke.
 *
 * A black canvas alone cannot tell whether the helper never published a
 * frame, published a black one, or published a real frame that the preload
 * pump failed to draw. The helper's POSIX shared-memory rings live in
 * /dev/shm on Linux, so the test runner can read them directly.
 */

const SHM_DIRECTORY = '/dev/shm';
const FRAME_SHM_MAGIC = 0x564d5046;
const FRAME_SHM_RING_SLOTS = 3;
const HEADER_BYTES = 56 + FRAME_SHM_RING_SLOTS * 16;

export interface FrameRingDiagnostics {
    name: string;
    valid: boolean;
    width?: number;
    height?: number;
    generation?: number;
    latestSeq?: number;
    slotSeqs?: number[];
    /** Per slot: pixels whose B+G+R exceeds 30 (null past the segment). */
    slotSignals?: Array<number | null>;
    heartbeatAgeMs?: number | null;
    /** `slotSignals` entry of the newest published frame. */
    latestFrameSignal?: number | null;
}

function countVisiblePixels(
    segment: Buffer,
    start: number,
    bytes: number
): number | null {
    if (start + bytes > segment.length) {
        return null;
    }
    let signal = 0;
    for (let pixel = start; pixel + 3 < start + bytes; pixel += 4) {
        if (segment[pixel] + segment[pixel + 1] + segment[pixel + 2] > 30) {
            signal += 1;
        }
    }
    return signal;
}

/**
 * Parses one frame ring (layout: FrameShmHeader in native/helper/frame_shm.h).
 * `nowNs` must come from CLOCK_MONOTONIC, as the helper's heartbeat does.
 */
export function describeFrameRing(
    name: string,
    segment: Buffer,
    nowNs: bigint
): FrameRingDiagnostics {
    if (
        segment.length < HEADER_BYTES ||
        segment.readUInt32LE(0) !== FRAME_SHM_MAGIC
    ) {
        return { name, valid: false };
    }

    const frameBytes = Number(segment.readBigUInt64LE(24));
    const dataOffset = Number(segment.readBigUInt64LE(32));
    const latestSeq = segment.readBigUInt64LE(40);
    const heartbeatNs = segment.readBigUInt64LE(48);
    const slotSeqs = Array.from({ length: FRAME_SHM_RING_SLOTS }, (_, slot) =>
        Number(segment.readBigUInt64LE(56 + slot * 16))
    );

    const slotSignals = slotSeqs.map((_, slot) =>
        countVisiblePixels(segment, dataOffset + slot * frameBytes, frameBytes)
    );

    return {
        name,
        valid: true,
        width: segment.readUInt32LE(8),
        height: segment.readUInt32LE(12),
        generation: segment.readUInt32LE(20),
        latestSeq: Number(latestSeq),
        slotSeqs,
        slotSignals,
        heartbeatAgeMs:
            heartbeatNs > BigInt(0) ? Number(nowNs - heartbeatNs) / 1e6 : null,
        latestFrameSignal:
            latestSeq > BigInt(0)
                ? slotSignals[Number(latestSeq % BigInt(FRAME_SHM_RING_SLOTS))]
                : null,
    };
}

/**
 * The helper names its rings `/<sessionId>-g<generation>`, so the prefix
 * keeps stale or concurrent sessions out of the report.
 */
export function describeFrameRings(
    sessionId: string
): FrameRingDiagnostics[] | string {
    try {
        return readdirSync(SHM_DIRECTORY)
            .filter((entry) => entry.startsWith(`${sessionId}-g`))
            .map((entry) =>
                describeFrameRing(
                    entry,
                    readFileSync(join(SHM_DIRECTORY, entry)),
                    process.hrtime.bigint()
                )
            );
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

/**
 * Waits for a visible frame on the smoke canvas; on timeout, attaches the
 * session snapshot, the helper's frame rings and mpv's own log (the session
 * sets `log-file`) before rethrowing.
 */
export async function expectRenderedFrame(
    app: LaunchedElectronApp,
    sessionId: string,
    timeout: number,
    mpvLogPath?: string
): Promise<void> {
    try {
        await expect
            .poll(() => renderedFrameSignal(app), { timeout })
            .toBeGreaterThan(0);
    } catch (error) {
        const session = await getLatestSession(app, sessionId).catch(
            () => null
        );
        const diagnostics = {
            session: session && {
                status: session.status,
                positionSeconds: session.positionSeconds,
                videoWidth: session.videoWidth,
                videoHeight: session.videoHeight,
                stats: session.stats,
            },
            frameRings: describeFrameRings(sessionId),
        };
        const body = JSON.stringify(diagnostics, null, 2);
        console.log(`[frame-copy smoke diagnostics] ${body}`);
        await test.info().attach('frame-copy-diagnostics', {
            body,
            contentType: 'application/json',
        });
        if (mpvLogPath && existsSync(mpvLogPath)) {
            const mpvLog = readFileSync(mpvLogPath, 'utf8');
            console.log(`[frame-copy smoke mpv log]\n${mpvLog}`);
            await test.info().attach('mpv-log', {
                body: mpvLog,
                contentType: 'text/plain',
            });
        }
        throw error;
    }
}
