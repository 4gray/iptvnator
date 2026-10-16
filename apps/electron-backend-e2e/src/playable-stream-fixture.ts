import { expect, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { xtreamMockServer } from './electron-test-fixtures';

/**
 * Local, deterministic media for flows that must really play.
 *
 * A channel, movie or episode is only recorded as recently viewed once its
 * stream has advanced for two seconds, so history tests can no longer use
 * unreachable URLs or the public HLS streams the portal mocks redirect to.
 * These routes answer those requests from the renderer with fixtures that
 * the Electron player actually decodes:
 * - `.m3u8` → a one-segment HLS playlist over the H.264/AAC MPEG-TS clip;
 * - `.ts` → that clip (6 s) directly;
 * - anything else (mp4, mkv, avi, webm) → the VP8 WebM clip (30 s), which
 *   Chromium sniffs from its bytes regardless of the declared type.
 */
const SEGMENT_URL = 'https://playable-stream-fixture.test/segment.ts';
const transportStream = readFileSync(
    join(__dirname, '../../xtream-mock-server/src/fixtures/live.mpegts')
);
const webmClip = readFileSync(
    join(__dirname, '../../web-e2e/src/fixtures/playback/episode.webm')
);
const hlsPlaylist = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:6',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXTINF:6,',
    SEGMENT_URL,
    '#EXT-X-ENDLIST',
    '',
].join('\n');

/** Hosts whose streams tests play: fixtures, portal mocks, mock redirects. */
const PLAYABLE_STREAM_HOSTS = [
    'https://streams.example.test',
    'https://playable-stream-fixture.test',
    // Stalker mock `create_link` answers and the Xtream mock redirect target.
    'https://test-streams.mux.dev',
    'https://devstreaming-cdn.apple.com',
    'https://playertest.longtailvideo.com',
];
const XTREAM_MEDIA_PATH = /^\/(live|movie|series)\//;

export async function routePlayableStreams(page: Page): Promise<void> {
    await page.route(
        (url) =>
            PLAYABLE_STREAM_HOSTS.includes(url.origin) ||
            (url.origin === new URL(xtreamMockServer).origin &&
                XTREAM_MEDIA_PATH.test(url.pathname)),
        (route) => fulfillPlayableStream(route)
    );
}

/**
 * Runs `start` and waits until a media element it brought up has played for
 * `seconds` of real stream time — longer than the two seconds after which
 * the app records the item. Elements already on the page are ignored, so a
 * still-mounted previous player cannot satisfy the wait.
 */
export async function startAndConfirmPlayback(
    page: Page,
    start: () => Promise<void>,
    seconds = 2.5
): Promise<void> {
    await page.evaluate(() =>
        document
            .querySelectorAll('video, audio')
            .forEach((media) => media.setAttribute('data-e2e-previous', ''))
    );
    await start();
    await expect
        .poll(
            () =>
                page.evaluate((minimum) => {
                    const starts = ((
                        window as unknown as {
                            __e2eMediaStarts?: WeakMap<Element, number>;
                        }
                    ).__e2eMediaStarts ??= new WeakMap());
                    return [
                        ...document.querySelectorAll<HTMLMediaElement>(
                            'video:not([data-e2e-previous]), audio:not([data-e2e-previous])'
                        ),
                    ].some((media) => {
                        if (media.paused || media.readyState < 2) {
                            return false;
                        }
                        if (!starts.has(media)) {
                            starts.set(media, media.currentTime);
                        }
                        return (
                            media.currentTime - (starts.get(media) ?? 0) >=
                            minimum
                        );
                    });
                }, seconds),
            { timeout: 45_000 }
        )
        .toBe(true);
}

async function fulfillPlayableStream(route: Route): Promise<void> {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('.m3u8')) {
        await route.fulfill({
            status: 200,
            contentType: 'application/vnd.apple.mpegurl',
            body: hlsPlaylist,
        });
        return;
    }
    if (pathname.endsWith('.ts')) {
        await route.fulfill({
            status: 200,
            contentType: 'video/mp2t',
            body: transportStream,
        });
        return;
    }
    await fulfillRange(route, webmClip, 'video/webm');
}

/**
 * Chromium's media pipeline reads files through byte ranges; answering a
 * Range request with the whole body would clamp every read to the start.
 */
async function fulfillRange(
    route: Route,
    body: Buffer,
    contentType: string
): Promise<void> {
    const range = /^bytes=(\d*)-(\d*)$/.exec(
        route.request().headers()['range'] ?? ''
    );
    const last = body.length - 1;
    const start = range?.[1]
        ? Number(range[1])
        : range?.[2]
          ? Math.max(0, body.length - Number(range[2]))
          : 0;
    const end =
        range?.[1] && range[2] ? Math.min(Number(range[2]), last) : last;
    await route.fulfill({
        status: range ? 206 : 200,
        headers: {
            'accept-ranges': 'bytes',
            'content-length': String(end - start + 1),
            'content-type': contentType,
            ...(range
                ? { 'content-range': `bytes ${start}-${end}/${body.length}` }
                : {}),
        },
        body: body.subarray(start, end + 1),
    });
}
