import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Request, Response } from 'express';

/** Share of the clip after which the provider loses the first connection. */
export const DROPPING_EPISODE_CUT_RATIO = 0.35;
/**
 * How long the stream is refused after the cut: long enough to defeat
 * ffmpeg's own HTTP reconnect, short enough for an app-level retry.
 */
export const DROPPING_EPISODE_REFUSE_MS = 4_000;

let fixture: Buffer | null = null;
/** Stream id → when its connection was cut. Every episode drops once. */
const droppedAt = new Map<string, number>();

export function resetDroppingEpisodes(): void {
    droppedAt.clear();
}

/**
 * `dropping-episode` fixture: every episode plays a local 60 s clip with
 * byte ranges, but the first response that reaches a third of the file is
 * cut there, and the stream answers 403 for a few seconds — a panel still
 * holding the dropped connection's slot. mpv reports such a drop as EOF in
 * the middle of the episode (issue #1902).
 */
export function streamDroppingEpisode(
    request: Request,
    response: Response
): void {
    const body = (fixture ??= readFileSync(
        join(process.cwd(), 'apps/xtream-mock-server/src/fixtures/episode.mkv')
    ));
    const streamId = String(request.params['streamId']);
    const cutAt = droppedAt.get(streamId);
    response.set('Cache-Control', 'no-store');
    if (
        cutAt !== undefined &&
        Date.now() - cutAt < DROPPING_EPISODE_REFUSE_MS
    ) {
        response.status(403).end();
        return;
    }

    const range = /^bytes=(\d+)-(\d*)$/.exec(request.get('range') ?? '');
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2]
        ? Math.min(Number(range[2]), body.length - 1)
        : body.length - 1;
    if (start > end) {
        response
            .status(416)
            .set('Content-Range', `bytes */${body.length}`)
            .end();
        return;
    }
    response
        .status(range ? 206 : 200)
        .type('video/x-matroska')
        .set('Accept-Ranges', 'bytes')
        .set('Content-Length', String(end - start + 1));
    if (range) {
        response.set('Content-Range', `bytes ${start}-${end}/${body.length}`);
    }

    const cut = Math.floor(body.length * DROPPING_EPISODE_CUT_RATIO);
    if (cutAt === undefined && start < cut && end >= cut) {
        response.write(body.subarray(start, cut), () => {
            droppedAt.set(streamId, Date.now());
            response.socket?.destroy();
        });
        return;
    }
    response.end(body.subarray(start, end + 1));
}
