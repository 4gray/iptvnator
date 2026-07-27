import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import {
    createSyntheticM3uFixture,
    SUPPORTED_SYNTHETIC_M3U_CHANNEL_COUNTS,
    SYNTHETIC_M3U_SEED,
} from './synthetic-m3u';

const GOLDEN_SHA256 = {
    10_000: '1d151ab2a878db8818f2bbfbdd689007cbe390182cdd1520c316bd163b7e7db3',
    50_000: '4a5336a5d1c66b8b706752784815617a012499cb7a231ab35c88df9bd55ee78a',
    100_000: '2ffe912f61ea106ba8de3414b0a927cdaa3264ac637d44c4b219f199eb94c353',
} as const;

describe('synthetic M3U performance fixture', () => {
    it('generates each supported catalog deterministically with exact metadata', () => {
        assert.deepEqual(
            SUPPORTED_SYNTHETIC_M3U_CHANNEL_COUNTS,
            [10_000, 50_000, 100_000]
        );
        assert.equal(SYNTHETIC_M3U_SEED, 240_724);

        for (const channelCount of SUPPORTED_SYNTHETIC_M3U_CHANNEL_COUNTS) {
            const fixture = createSyntheticM3uFixture(channelCount);
            const lines = fixture.body.trimEnd().split('\n');

            assert.equal(fixture.channelCount, channelCount);
            assert.equal(
                fixture.bytes,
                Buffer.byteLength(fixture.body, 'utf8')
            );
            assert.equal(
                fixture.sha256,
                createHash('sha256').update(fixture.body, 'utf8').digest('hex')
            );
            assert.equal(fixture.sha256, GOLDEN_SHA256[channelCount]);
            assert.equal(lines[0], '#EXTM3U');
            assert.equal(lines.length, 1 + channelCount * 2);
            assert.equal(
                lines.filter((line) => line.startsWith('#EXTINF:')).length,
                channelCount
            );
            assert.doesNotMatch(fixture.body, /\b(?:tvg-|logo|provider)\b/i);
            assertOnlyLoopbackUrls(fixture.body);
        }
    });

    it('rejects unsupported channel counts', () => {
        assert.throws(
            () => createSyntheticM3uFixture(9_999),
            /Unsupported synthetic M3U channel count/
        );
    });
});

function assertOnlyLoopbackUrls(body: string): void {
    const urls = body.match(/https?:\/\/[^\s"]+/g) ?? [];

    for (const rawUrl of urls) {
        const url = new URL(rawUrl);
        assert.equal(url.protocol, 'http:');
        assert.equal(url.hostname, '127.0.0.1');
        assert.equal(url.username, '');
        assert.equal(url.password, '');
    }
}
