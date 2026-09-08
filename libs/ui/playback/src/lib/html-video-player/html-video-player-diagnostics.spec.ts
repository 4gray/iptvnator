import { ErrorDetails, ErrorTypes, type ErrorData } from 'hls.js';
import type { PlaybackDiagnostic } from '@iptvnator/playback/util';
import {
    emitFatalHlsPlaybackError,
    emitMpegTsPlaybackError,
} from './html-video-player-diagnostics';

describe('HTML5 engine codec evidence', () => {
    it('keeps advertised HLS codecs on an ordinary segment network error', () => {
        const issues: PlaybackDiagnostic[] = [];
        emitFatalHlsPlaybackError(
            'https://example.test/live.m3u8',
            {
                fatal: true,
                type: ErrorTypes.NETWORK_ERROR,
                details: ErrorDetails.FRAG_LOAD_ERROR,
            } as ErrorData,
            (issue) => issues.push(issue),
            [{ audioCodec: 'mp4a.40.2', videoCodec: 'avc1.64001e' }]
        );
        expect(issues[0]).toMatchObject({
            code: 'network-error',
            audioCodecs: ['mp4a.40.2'],
            videoCodecs: ['avc1.64001e'],
        });
    });

    it('keeps MPEG-TS media-info codecs without copying its private fields', () => {
        const issues: PlaybackDiagnostic[] = [];
        emitMpegTsPlaybackError(
            'https://example.test/live.ts',
            {
                type: 'MediaError',
                details: 'MediaMSEError',
                info: {},
            },
            (issue) => issues.push(issue),
            {
                audioCodec: 'aac',
                videoCodec: 'h264',
            }
        );
        expect(issues[0]).toMatchObject({
            audioCodecs: ['aac'],
            videoCodecs: ['h264'],
        });
    });
});
