import {
    decodeExternalSubtitleBytes,
    detectExternalSubtitleFormat,
    parseExternalSubtitleCues,
} from './external-subtitle-cues.util';

describe('external-subtitle-cues.util', () => {
    describe('detectExternalSubtitleFormat', () => {
        it('detects srt and vtt by extension, case-insensitively', () => {
            expect(detectExternalSubtitleFormat('movie.srt')).toBe('srt');
            expect(detectExternalSubtitleFormat('Movie.SRT')).toBe('srt');
            expect(detectExternalSubtitleFormat('movie.en.vtt')).toBe('vtt');
        });

        it('rejects unsupported extensions', () => {
            expect(detectExternalSubtitleFormat('movie.ass')).toBeNull();
            expect(detectExternalSubtitleFormat('movie.sub')).toBeNull();
            expect(detectExternalSubtitleFormat('movie')).toBeNull();
        });
    });

    describe('decodeExternalSubtitleBytes', () => {
        const toBuffer = (bytes: number[]): ArrayBuffer =>
            Uint8Array.from(bytes).buffer;

        it('decodes valid UTF-8 as-is', () => {
            const utf8 = new TextEncoder().encode('Привет\nmonde');
            expect(decodeExternalSubtitleBytes(utf8.buffer)).toBe(
                'Привет\nmonde'
            );
        });

        it('decodes Cyrillic Windows-1251 bytes (high-byte-heavy text)', () => {
            // "Привет мир" in CP1251: every letter is a high byte.
            const cp1251 = [
                0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x20, 0xec, 0xe8, 0xf0,
            ];
            expect(decodeExternalSubtitleBytes(toBuffer(cp1251))).toBe(
                'Привет мир'
            );
        });

        it('detects CP1251 in a short-dialogue SRT where ASCII timing bytes dominate', () => {
            // "Да" / "Нет" in CP1251 among full SRT timing scaffolding: only
            // 5 of ~70 bytes are high, but ALL letter bytes are — the
            // discriminator must ignore the timing lines.
            const ascii = (text: string) =>
                Array.from(text).map((c) => c.charCodeAt(0));
            const srt = [
                ...ascii('1\n00:00:01,000 --> 00:00:02,000\n'),
                0xc4, 0xe0, // Да
                ...ascii('\n\n2\n00:00:03,000 --> 00:00:04,000\n'),
                0xcd, 0xe5, 0xf2, // Нет
                ...ascii('\n'),
            ];
            expect(decodeExternalSubtitleBytes(toBuffer(srt))).toContain('Да');
            expect(decodeExternalSubtitleBytes(toBuffer(srt))).toContain(
                'Нет'
            );
        });

        it('keeps accent-dense CP1252 words Latin ("Été" must not become Cyrillic)', () => {
            // É=0xC9, t, é=0xE9 — more accented than ASCII letters, so a
            // byte-ratio heuristic flips to CP1251 and renders "Йtй". The
            // mixed-script plausibility check must keep this Windows-1252.
            const cp1252 = [
                0xc9, 0x74, 0xe9, // Été
                ...Array.from(' 1\n00:00:01,000 --> 00:00:02,000\n').map((c) =>
                    c.charCodeAt(0)
                ),
                0xc0, // À
                ...Array.from(' table !').map((c) => c.charCodeAt(0)),
            ];
            const decoded = decodeExternalSubtitleBytes(toBuffer(cp1252));
            expect(decoded).toContain('Été');
            expect(decoded).toContain('À table');
        });

        it('keeps a minimal isolated-accent CP1252 caption Latin ("À la")', () => {
            // One lone Cyrillic-looking letter and two ASCII letters passed
            // the earlier share guard; single-letter words must carry no
            // script evidence at all.
            const cp1252 = [
                0xc0, // À
                ...Array.from(
                    ' la\n1\n00:00:01,000 --> 00:00:02,000\n'
                ).map((c) => c.charCodeAt(0)),
            ];
            expect(decodeExternalSubtitleBytes(toBuffer(cp1252))).toContain(
                'À la'
            );
        });

        it('keeps an isolated accented CP1252 word Latin ("À table")', () => {
            // À=0xC0 decodes under CP1251 to the pure-Cyrillic one-letter
            // word "А"; without the letter-share guard that single vote
            // flips the whole file to Cyrillic.
            const cp1252 = [
                0xc0, // À
                ...Array.from(
                    ' table !\n1\n00:00:01,000 --> 00:00:02,000\n'
                ).map((c) => c.charCodeAt(0)),
            ];
            expect(decodeExternalSubtitleBytes(toBuffer(cp1252))).toContain(
                'À table'
            );
        });

        it('decodes mostly-ASCII Windows-1252 bytes (sparse accents)', () => {
            // "resume: cafe" with two accented letters among ASCII.
            const cp1252 = [
                ...Array.from('r').map((c) => c.charCodeAt(0)),
                0xe9, // é
                ...Array.from('sum').map((c) => c.charCodeAt(0)),
                0xe9, // é
                ...Array.from(': cafe and plain ascii words').map((c) =>
                    c.charCodeAt(0)
                ),
            ];
            expect(decodeExternalSubtitleBytes(toBuffer(cp1252))).toBe(
                'résumé: cafe and plain ascii words'
            );
        });

        it('honors a UTF-16LE byte-order mark', () => {
            const text = '1\n00:00:01,000';
            const bytes: number[] = [0xff, 0xfe];
            for (const char of text) {
                const code = char.charCodeAt(0);
                bytes.push(code & 0xff, code >> 8);
            }
            expect(decodeExternalSubtitleBytes(toBuffer(bytes))).toBe(text);
        });
    });

    describe('parseExternalSubtitleCues', () => {
        it('parses a standard SRT file', () => {
            const content = [
                '1',
                '00:00:01,000 --> 00:00:03,500',
                'First line',
                'second row',
                '',
                '2',
                '00:01:00,250 --> 00:01:02,000',
                'Later',
                '',
            ].join('\r\n');

            expect(
                parseExternalSubtitleCues({ format: 'srt', content })
            ).toEqual([
                {
                    startSeconds: 1,
                    endSeconds: 3.5,
                    text: 'First line\nsecond row',
                },
                { startSeconds: 60.25, endSeconds: 62, text: 'Later' },
            ]);
        });

        it('parses a WebVTT file with header, notes, and settings', () => {
            const content = [
                '﻿WEBVTT',
                '',
                'NOTE this is a comment',
                '',
                'intro',
                '00:05.000 --> 00:07.000 align:start line:90%',
                'Short-form timestamps work',
                '',
                '01:00:00.000 --> 01:00:04.000',
                '<i>Styled</i> text survives',
            ].join('\n');

            expect(
                parseExternalSubtitleCues({ format: 'vtt', content })
            ).toEqual([
                {
                    startSeconds: 5,
                    endSeconds: 7,
                    text: 'Short-form timestamps work',
                },
                {
                    startSeconds: 3600,
                    endSeconds: 3604,
                    text: '<i>Styled</i> text survives',
                },
            ]);
        });

        it('skips malformed blocks instead of failing the file', () => {
            const content = [
                '1',
                '00:00:05,000 --> 00:00:01,000',
                'End before start is dropped',
                '',
                '2',
                '00:00:10,000 --> 00:00:12,000',
                'Valid',
                '',
                'not a timing line at all',
                'trailing junk',
            ].join('\n');

            expect(
                parseExternalSubtitleCues({ format: 'srt', content })
            ).toEqual([
                { startSeconds: 10, endSeconds: 12, text: 'Valid' },
            ]);
        });

        it('sorts cues by start time and drops empty-text cues', () => {
            const content = [
                '00:00:30.000 --> 00:00:31.000',
                'Second',
                '',
                '00:00:02.000 --> 00:00:03.000',
                'First',
                '',
                '00:00:40.000 --> 00:00:41.000',
                '<00:00:40.500>',
                '',
            ].join('\n');

            expect(
                parseExternalSubtitleCues({ format: 'vtt', content })
            ).toEqual([
                { startSeconds: 2, endSeconds: 3, text: 'First' },
                { startSeconds: 30, endSeconds: 31, text: 'Second' },
            ]);
        });
    });
});
