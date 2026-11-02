import { type PlaybackDiagnostic } from '@iptvnator/playback/util';
import { createDiagnosticReport } from './playback-diagnostic-report.util';

const issue: PlaybackDiagnostic = {
    code: 'network-error',
    source: 'shaka',
    player: 'html5',
    sourceUrl: 'https://user:secret@private.test/live.mpd?token=secret',
    container: 'mpd',
    audioCodecs: ['opus'],
    videoCodecs: ['avc1.640028'],
    drmSystems: ['widevine'],
    httpStatus: 403,
    nativeErrorMessage: 'secret',
    nativeErrorType: 'secret',
    details: 'secret',
    shaka: {
        category: 'network',
        severity: 'critical',
        engineCode: 1001,
        stage: 'segment',
        failure: 'network',
        disposition: 'terminal',
    },
};

describe('safe diagnostic report', () => {
    it('copies bounded facts without raw URLs, messages or user agent', () => {
        const report = createDiagnosticReport(
            issue,
            '1.0.0',
            'Mozilla/5.0 (Macintosh) Electron/42 secret'
        );
        expect(JSON.parse(report)).toMatchObject({
            app: 'IPTVnator',
            appVersion: '1.0.0',
            os: 'macOS',
            runtime: 'electron',
            code: 'network-error',
            engine: 'shaka',
            player: 'html5',
            stage: 'segment',
            engineCode: 1001,
            httpStatus: 403,
            drmSystems: ['widevine'],
            videoCodecs: ['avc1.640028'],
        });
        for (const secret of [
            'secret',
            'private.test',
            'Mozilla',
            'sourceUrl',
            'nativeErrorMessage',
        ])
            expect(report).not.toContain(secret);
    });
    it('rejects unexpected strings even when a caller breaks the types', () => {
        const report = createDiagnosticReport(
            {
                ...issue,
                code: 'secret',
                source: 'secret',
                player: 'secret',
                container: 'secret',
                videoCodecs: ['secret'],
                audioCodecs: ['https://secret'],
                drmSystems: ['secret'],
                httpStatus: Infinity,
                nativeErrorCode: NaN,
                shaka: {
                    ...issue.shaka,
                    stage: 'secret',
                    engineCode: 'secret',
                },
            } as unknown as PlaybackDiagnostic,
            'secret',
            'secret'
        );
        expect(report).not.toContain('secret');
        expect(report).not.toContain('null');
    });
    it('does not carry another engine’s evidence', () => {
        expect(
            JSON.parse(
                createDiagnosticReport(
                    { ...issue, source: 'native' },
                    '1.0.0',
                    'Linux'
                )
            )
        ).not.toHaveProperty('stage');
    });
});
