import {
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
