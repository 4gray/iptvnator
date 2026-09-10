import { formatBitrate } from './controls-format.utils';
import {
    buildStreamStatsRows,
    formatAspectRatio,
    formatAudioChannels,
    formatSampleRate,
    formatBufferedSeconds,
    formatCodec,
    formatDroppedFrames,
    formatFrameRate,
    formatResolution,
} from './stream-stats-format.utils';
import { emptyStreamStats } from './stream-stats.spec-helpers';

describe('stream stats formatting', () => {
    describe('formatResolution', () => {
        it('renders both dimensions', () => {
            expect(formatResolution(1920, 1080)).toBe('1920 × 1080');
        });

        it('returns null when a dimension is missing or zero', () => {
            expect(formatResolution(0, 1080)).toBeNull();
            expect(formatResolution(1920, null)).toBeNull();
        });
    });

    describe('formatAspectRatio', () => {
        it('names common ratios', () => {
            expect(formatAspectRatio(1920, 1080)).toBe('16:9');
            expect(formatAspectRatio(1024, 768)).toBe('4:3');
            // Raw PAL pixels really are 5:4; mpv's dwidth already corrects for
            // the display aspect, so no 4:3 special case belongs here.
            expect(formatAspectRatio(720, 576)).toBe('5:4');
            expect(formatAspectRatio(1080, 1920)).toBe('9:16');
        });

        it('snaps a near-miss to the closest known ratio', () => {
            // 1920x816 is 2.3529 — cinema scope, not the exact 21:9 value.
            expect(formatAspectRatio(1920, 816)).toBe('2.35:1');
        });

        it('reduces an unusual but small ratio exactly', () => {
            expect(formatAspectRatio(1000, 700)).toBe('10:7');
        });

        it('falls back to a decimal ratio when the reduction is unreadable', () => {
            expect(formatAspectRatio(1000, 437)).toBe('2.29:1');
        });
    });

    describe('formatFrameRate', () => {
        it('drops the decimals of a whole rate', () => {
            expect(formatFrameRate(50)).toBe('50 fps');
            expect(formatFrameRate(24.999)).toBe('25 fps');
        });

        it('keeps two decimals for pulled-down rates', () => {
            expect(formatFrameRate(29.97)).toBe('29.97 fps');
        });

        it('preserves a measured zero and omits unknown or invalid rates', () => {
            expect(formatFrameRate(null)).toBeNull();
            expect(formatFrameRate(0)).toBe('0 fps');
            expect(formatFrameRate(-1)).toBeNull();
            expect(formatFrameRate(NaN)).toBeNull();
        });
    });

    describe('formatBitrate (shared with the quality-level labels)', () => {
        it('uses Mbps above one megabit', () => {
            expect(formatBitrate(4_600_000)).toBe('4.6 Mbps');
        });

        it('drops the decimal once the integer part carries the value', () => {
            expect(formatBitrate(12_000_000)).toBe('12 Mbps');
        });

        it('uses kbps below one megabit', () => {
            expect(formatBitrate(128_000)).toBe('128 kbps');
        });

        it('returns null for unknown bitrates', () => {
            expect(formatBitrate(null)).toBeNull();
            expect(formatBitrate(0)).toBeNull();
        });
    });

    describe('formatCodec', () => {
        it('strips the profile suffix of an engine codec id', () => {
            expect(formatCodec('avc1.640028')).toBe('avc1');
            expect(formatCodec('mp4a.40.2')).toBe('mp4a');
        });

        it('passes a plain codec name through', () => {
            expect(formatCodec('h264')).toBe('h264');
        });

        it('returns null for blank input', () => {
            expect(formatCodec('   ')).toBeNull();
            expect(formatCodec(null)).toBeNull();
        });
    });

    describe('formatAudioChannels', () => {
        it('names the layouts people recognise', () => {
            expect(formatAudioChannels(2)).toBe('Stereo');
            expect(formatAudioChannels(6)).toBe('5.1');
            expect(formatAudioChannels(8)).toBe('7.1');
            expect(formatAudioChannels(1)).toBe('Mono');
        });

        it('accepts a numeric string from a web manifest', () => {
            expect(formatAudioChannels('6')).toBe('5.1');
        });

        it('normalizes an mpv layout name', () => {
            expect(formatAudioChannels('stereo')).toBe('Stereo');
            expect(formatAudioChannels('5.1(side)')).toBe('5.1(side)');
        });

        it('falls back to a plain count for unusual layouts', () => {
            expect(formatAudioChannels(3)).toBe('3 ch');
        });

        it('returns null when unknown', () => {
            expect(formatAudioChannels(null)).toBeNull();
            expect(formatAudioChannels('  ')).toBeNull();
            expect(formatAudioChannels(0)).toBeNull();
        });
    });

    describe('formatSampleRate', () => {
        it('renders kHz without trailing zeros', () => {
            expect(formatSampleRate(48_000)).toBe('48 kHz');
            expect(formatSampleRate(44_100)).toBe('44.1 kHz');
            expect(formatSampleRate(22_050)).toBe('22.05 kHz');
        });

        it('returns null when unknown', () => {
            expect(formatSampleRate(null)).toBeNull();
            expect(formatSampleRate(0)).toBeNull();
        });
    });

    describe('formatBufferedSeconds', () => {
        it('renders one decimal, including zero', () => {
            expect(formatBufferedSeconds(12.34)).toBe('12.3 s');
            expect(formatBufferedSeconds(0)).toBe('0.0 s');
        });

        it('returns null when unknown', () => {
            expect(formatBufferedSeconds(null)).toBeNull();
        });
    });

    describe('formatDroppedFrames', () => {
        it('adds the drop rate when a total is known', () => {
            expect(formatDroppedFrames(12, 1200)).toBe('12 (1.00%)');
        });

        it('marks a vanishingly small rate rather than rounding it to zero', () => {
            expect(formatDroppedFrames(1, 1_000_000)).toBe('1 (<0.01%)');
        });

        it('reports the bare count without a total', () => {
            expect(formatDroppedFrames(3, null)).toBe('3');
        });

        it('returns null when the counter itself is unknown', () => {
            expect(formatDroppedFrames(null, 1200)).toBeNull();
        });
    });

    describe('buildStreamStatsRows', () => {
        it('emits one row per known value, in reading order', () => {
            const rows = buildStreamStatsRows(
                emptyStreamStats({
                    width: 1920,
                    height: 1080,
                    fps: 50,
                    videoCodec: 'h264',
                    videoBitrateBps: 4_600_000,
                    audioCodec: 'aac',
                    audioBitrateBps: 128_000,
                    audioChannels: 6,
                    audioSampleRateHz: 48_000,
                    container: 'mpegts',
                    bufferedAheadSeconds: 8.2,
                    droppedFrames: 2,
                    totalFrames: 4000,
                })
            );

            expect(rows).toEqual([
                {
                    labelKey: 'EMBEDDED_MPV.PLAYER.STATS_RESOLUTION',
                    value: '1920 × 1080 · 16:9',
                },
                {
                    labelKey: 'EMBEDDED_MPV.PLAYER.STATS_FRAME_RATE',
                    value: '50 fps',
                },
                {
                    labelKey: 'EMBEDDED_MPV.PLAYER.STATS_VIDEO',
                    value: 'h264 · 4.6 Mbps',
                },
                {
                    labelKey: 'EMBEDDED_MPV.PLAYER.STATS_AUDIO',
                    value: 'aac · 128 kbps',
                },
                {
                    labelKey: 'EMBEDDED_MPV.PLAYER.STATS_AUDIO_CHANNELS',
                    value: '5.1',
                },
                {
                    labelKey: 'EMBEDDED_MPV.PLAYER.STATS_SAMPLE_RATE',
                    value: '48 kHz',
                },
                {
                    labelKey: 'EMBEDDED_MPV.PLAYER.STATS_CONTAINER',
                    value: 'mpegts',
                },
                {
                    labelKey: 'EMBEDDED_MPV.PLAYER.STATS_BUFFER',
                    value: '8.2 s',
                },
                {
                    labelKey: 'EMBEDDED_MPV.PLAYER.STATS_DROPPED_FRAMES',
                    value: '2 (0.05%)',
                },
            ]);
        });

        it('omits the aspect suffix when only one dimension is known', () => {
            const rows = buildStreamStatsRows(
                emptyStreamStats({ width: 1920, height: null })
            );

            expect(rows).toEqual([]);
        });

        it('keeps a codec row without its bitrate and vice versa', () => {
            const rows = buildStreamStatsRows(
                emptyStreamStats({
                    videoCodec: 'hevc',
                    audioBitrateBps: 96_000,
                })
            );

            expect(rows).toEqual([
                { labelKey: 'EMBEDDED_MPV.PLAYER.STATS_VIDEO', value: 'hevc' },
                {
                    labelKey: 'EMBEDDED_MPV.PLAYER.STATS_AUDIO',
                    value: '96 kbps',
                },
            ]);
        });

        it('labels nominal FPS and aggregate bitrate separately from measured FPS and video', () => {
            const rows = buildStreamStatsRows({
                ...emptyStreamStats({ fps: 0, videoCodec: 'h264' }),
                nominalFps: 30,
                streamBitrateBps: 3_000_000,
            });
            expect(rows).toEqual([
                {
                    labelKey: 'EMBEDDED_MPV.PLAYER.STATS_FRAME_RATE',
                    value: '0 fps',
                },
                {
                    labelKey: 'EMBEDDED_MPV.PLAYER.STATS_NOMINAL_FRAME_RATE',
                    value: '30 fps',
                },
                {
                    labelKey: 'EMBEDDED_MPV.PLAYER.STATS_STREAM_BITRATE',
                    value: '3.0 Mbps',
                },
                { labelKey: 'EMBEDDED_MPV.PLAYER.STATS_VIDEO', value: 'h264' },
            ]);
        });

        it('returns nothing for an absent snapshot', () => {
            expect(buildStreamStatsRows(null)).toEqual([]);
        });
    });
});
