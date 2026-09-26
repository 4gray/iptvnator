import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { SYNTHETIC_TITLE_VOCABULARY } from './synthetic-charset';
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

const CYRILLIC_GOLDEN_SHA256 = {
    10_000: 'bc4f3c2a3d507db459dff2d4a723d8fa8729fb957cc436f062e703564201a20b',
    50_000: '4a3fc713548a7ab50c70dc0751eb5b2483122af9d01f7d3975f309dc820c6a04',
    100_000: '94727a8452920c07727812f4ec78b77deac353f5a46ee096620efba2296b7e2b',
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

    it('keeps the latin1 option identical to the default fixture', () => {
        const byDefault = createSyntheticM3uFixture(10_000);
        const explicit = createSyntheticM3uFixture(10_000, {
            charset: 'latin1',
        });

        assert.equal(byDefault.charset, 'latin1');
        assert.equal(explicit.body, byDefault.body);
        assert.equal(explicit.sha256, GOLDEN_SHA256[10_000]);
        // UTF-8 byte length equals UTF-16 length only for ASCII-only text.
        assert.equal(byDefault.bytes, byDefault.body.length);
    });

    it('generates each cyrillic catalog deterministically', () => {
        for (const channelCount of SUPPORTED_SYNTHETIC_M3U_CHANNEL_COUNTS) {
            const cyrillic = createSyntheticM3uFixture(channelCount, {
                charset: 'cyrillic',
            });

            assert.equal(cyrillic.charset, 'cyrillic');
            assert.equal(cyrillic.channelCount, channelCount);
            assert.equal(cyrillic.sha256, CYRILLIC_GOLDEN_SHA256[channelCount]);
        }
    });

    it('keeps the cyrillic layout identical apart from titles', () => {
        const latin = createSyntheticM3uFixture(10_000);
        const cyrillic = createSyntheticM3uFixture(10_000, {
            charset: 'cyrillic',
        });

        assert.equal(cyrillic.bytes, Buffer.byteLength(cyrillic.body, 'utf8'));
        assert.equal(
            cyrillic.sha256,
            createHash('sha256').update(cyrillic.body, 'utf8').digest('hex')
        );
        assert.equal(cyrillic.body.length, latin.body.length);
        assert.equal(toLatinTitles(cyrillic.body), latin.body);
        assertOnlyLoopbackUrls(cyrillic.body);
    });

    it('puts characters outside Latin-1 into every cyrillic channel entry', () => {
        const lines = createSyntheticM3uFixture(10_000, { charset: 'cyrillic' })
            .body.trimEnd()
            .split('\n');

        for (const line of lines.filter((entry) =>
            entry.startsWith('#EXTINF:')
        )) {
            assert.ok(hasCharacterAbove(line, 0xff), line);
        }
        for (const line of lines.filter((entry) => entry.startsWith('http'))) {
            assert.equal(hasCharacterAbove(line, 0x7f), false, line);
        }
    });

    it('rejects unsupported charsets', () => {
        assert.throws(
            () =>
                createSyntheticM3uFixture(10_000, {
                    charset: 'greek' as never,
                }),
            /Unsupported synthetic charset/
        );
    });

    it('rejects unsupported channel counts', () => {
        assert.throws(
            () => createSyntheticM3uFixture(9_999),
            /Unsupported synthetic M3U channel count/
        );
    });
});

function toLatinTitles(body: string): string {
    const latin = SYNTHETIC_TITLE_VOCABULARY.latin1;
    const cyrillic = SYNTHETIC_TITLE_VOCABULARY.cyrillic;
    return replaceEvery(
        replaceEvery(body, cyrillic.group, latin.group),
        cyrillic.channel,
        latin.channel
    );
}

function hasCharacterAbove(text: string, maxCodeUnit: number): boolean {
    for (let index = 0; index < text.length; index += 1) {
        if (text.charCodeAt(index) > maxCodeUnit) {
            return true;
        }
    }
    return false;
}

function replaceEvery(text: string, search: string, replacement: string) {
    return text.split(search).join(replacement);
}

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
