import type { VodSourceCandidate } from '@iptvnator/shared/interfaces';
import {
    applyApiMetadata,
    audioDiffersFactually,
    factualOnly,
    parseTitleMetadata,
} from './vod-source-metadata.util';

function candidate(
    overrides: Partial<VodSourceCandidate> = {}
): VodSourceCandidate {
    return {
        id: 'p1:xtream:1',
        playlistId: 'p1',
        playlistName: 'SharkTV',
        portalType: 'xtream',
        contentId: 1,
        rawTitle: 'Dune',
        matchConfidence: 'exact',
        ...overrides,
    };
}

describe('parseTitleMetadata', () => {
    it('returns nothing for an empty title rather than inventing defaults', () => {
        expect(parseTitleMetadata('')).toEqual({});
        expect(parseTitleMetadata(null)).toEqual({});
        expect(parseTitleMetadata(undefined)).toEqual({});
    });

    it('leaves fields undefined when the title says nothing about them', () => {
        const parsed = parseTitleMetadata('Dune Part Two');

        expect(parsed.quality).toBeUndefined();
        expect(parsed.codec).toBeUndefined();
        expect(parsed.audio).toBeUndefined();
        expect(parsed.hdr).toBeUndefined();
    });

    it('marks every inferred value as a guess', () => {
        const parsed = parseTitleMetadata('Dune 2160p HEVC Дубляж HDR');

        expect(parsed.quality).toEqual({
            value: '2160p',
            provenance: 'parsed',
        });
        expect(parsed.codec).toEqual({ value: 'HEVC', provenance: 'parsed' });
        expect(parsed.audio).toEqual({ value: 'Дубляж', provenance: 'parsed' });
        expect(parsed.hdr).toEqual({ value: 'HDR', provenance: 'parsed' });
    });

    it.each([
        ['Dune 4K', '2160p'],
        ['Dune UHD', '2160p'],
        ['Dune 1080i', '1080p'],
        ['Dune 720P', '720p'],
    ])('normalizes quality tag %s', (title, expected) => {
        expect(parseTitleMetadata(title).quality?.value).toBe(expected);
    });

    it.each([
        ['Dune x265', 'HEVC'],
        ['Dune H.265', 'HEVC'],
        ['Dune x264', 'H.264'],
        ['Dune H264', 'H.264'],
        ['Dune AV1', 'AV1'],
    ])('normalizes codec tag %s', (title, expected) => {
        expect(parseTitleMetadata(title).codec?.value).toBe(expected);
    });

    it('prefers the more specific quality when several could match', () => {
        // "4K" and "1080p" both appear; the higher, more specific tag wins.
        expect(parseTitleMetadata('Dune 4K remux from 1080p').quality?.value)
            .toBe('2160p');
    });

    it('does not match quality tags embedded in unrelated words', () => {
        expect(parseTitleMetadata('Blade Runner 2049').quality).toBeUndefined();
    });
});

describe('applyApiMetadata', () => {
    it('overrides a guess with a provider-stated fact', () => {
        const withGuess = candidate({
            container: { value: 'mkv', provenance: 'parsed' },
        });

        const result = applyApiMetadata(withGuess, {
            containerExtension: 'mp4',
        });

        expect(result.container).toEqual({ value: 'mp4', provenance: 'api' });
    });

    it('keeps an existing guess when the provider states nothing', () => {
        const withGuess = candidate({
            quality: { value: '1080p', provenance: 'parsed' },
        });

        const result = applyApiMetadata(withGuess, {
            containerExtension: null,
            height: null,
        });

        // Erasing a marked guess in favour of nothing helps no one.
        expect(result.quality).toEqual({
            value: '1080p',
            provenance: 'parsed',
        });
    });

    it('derives quality from a standard frame height as a fact', () => {
        expect(applyApiMetadata(candidate(), { height: 2160 }).quality).toEqual({
            value: '2160p',
            provenance: 'api',
        });
    });

    it('prefers width, which cropping does not distort', () => {
        // A 2.39:1 1080p master is 1920x800 — the width still says 1080p.
        expect(
            applyApiMetadata(candidate(), { width: 1920, height: 800 }).quality
        ).toEqual({ value: '1080p', provenance: 'api' });
    });

    it('does not call every small stream 480p', () => {
        // The old rule labelled ANY width under 900 as 480p, published with
        // `api` provenance — so a 640x360 stream stated 480p as a fact.
        expect(
            applyApiMetadata(candidate(), { width: 640, height: 360 }).quality
        ).toEqual({ value: '360p', provenance: 'api' });
        expect(
            applyApiMetadata(candidate(), { width: 854, height: 480 }).quality
        ).toEqual({ value: '480p', provenance: 'api' });
    });

    it('reads the height when one width covers two formats', () => {
        // 720 wide is NTSC 480p or PAL 576p; only the height separates them,
        // and without one there is no honest answer to give.
        expect(
            applyApiMetadata(candidate(), { width: 720, height: 576 }).quality
        ).toEqual({ value: '576p', provenance: 'api' });
        expect(
            applyApiMetadata(candidate(), { width: 720, height: 480 }).quality
        ).toEqual({ value: '480p', provenance: 'api' });
        expect(
            applyApiMetadata(candidate(), { width: 720 }).quality
        ).toBeUndefined();
    });

    it('emits nothing for a width below every known format', () => {
        expect(
            applyApiMetadata(candidate(), { width: 320, height: 240 }).quality
        ).toBeUndefined();
    });

    it('emits no quality for an ambiguous cropped height', () => {
        // 800 lines alone could be a cropped 1080p or a 1280x800 encode.
        // Guessing here would publish a wrong value labelled as a fact.
        expect(applyApiMetadata(candidate(), { height: 800 }).quality)
            .toBeUndefined();
    });

    it('ignores a nonsensical dimension instead of emitting a bogus fact', () => {
        expect(applyApiMetadata(candidate(), { height: 0 }).quality)
            .toBeUndefined();
        expect(applyApiMetadata(candidate(), { height: -5 }).quality)
            .toBeUndefined();
        expect(applyApiMetadata(candidate(), { height: NaN }).quality)
            .toBeUndefined();
        expect(applyApiMetadata(candidate(), { width: 0, height: 1080 }).quality)
            .toEqual({ value: '1080p', provenance: 'api' });
    });

    it('normalizes provider codec names', () => {
        expect(applyApiMetadata(candidate(), { videoCodec: 'hevc' }).codec)
            .toEqual({ value: 'HEVC', provenance: 'api' });
        expect(applyApiMetadata(candidate(), { videoCodec: 'h264' }).codec)
            .toEqual({ value: 'H.264', provenance: 'api' });
    });

    it('does not mutate the input candidate', () => {
        const original = candidate();
        applyApiMetadata(original, { containerExtension: 'mp4' });
        expect(original.container).toBeUndefined();
    });
});

describe('factualOnly', () => {
    it('hides guessed values from ranking decisions', () => {
        const mixed = candidate({
            quality: { value: '2160p', provenance: 'parsed' },
            container: { value: 'mp4', provenance: 'api' },
        });

        const facts = factualOnly(mixed);

        // The whole point: a filename claiming 4K must not outrank a source
        // we actually verified.
        expect(facts.quality).toBeUndefined();
        expect(facts.container).toEqual({ value: 'mp4', provenance: 'api' });
    });

    it('keeps probe-sourced values', () => {
        const probed = candidate({
            codec: { value: 'HEVC', provenance: 'probe' },
        });

        expect(factualOnly(probed).codec).toEqual({
            value: 'HEVC',
            provenance: 'probe',
        });
    });
});

describe('audioDiffersFactually', () => {
    it('warns only when both sides are known facts that differ', () => {
        const from = candidate({
            audio: { value: 'Дубляж', provenance: 'api' },
        });
        const to = candidate({ audio: { value: 'Eng', provenance: 'api' } });

        expect(audioDiffersFactually(from, to)).toBe(true);
    });

    it('stays silent when either side is only a guess', () => {
        const from = candidate({
            audio: { value: 'Дубляж', provenance: 'api' },
        });
        const guessed = candidate({
            audio: { value: 'MVO', provenance: 'parsed' },
        });

        expect(audioDiffersFactually(from, guessed)).toBe(false);
    });

    it('stays silent when either side is unknown', () => {
        const known = candidate({
            audio: { value: 'Дубляж', provenance: 'api' },
        });

        expect(audioDiffersFactually(known, candidate())).toBe(false);
        expect(audioDiffersFactually(candidate(), known)).toBe(false);
        expect(audioDiffersFactually(null, known)).toBe(false);
    });

    it('stays silent when both sides state the same track', () => {
        const from = candidate({
            audio: { value: 'Дубляж', provenance: 'api' },
        });
        const to = candidate({ audio: { value: 'Дубляж', provenance: 'api' } });

        expect(audioDiffersFactually(from, to)).toBe(false);
    });
});
