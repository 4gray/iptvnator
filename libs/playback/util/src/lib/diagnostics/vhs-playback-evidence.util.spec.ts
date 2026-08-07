import { execFileSync } from 'node:child_process';
import type { NativePlaybackErrorInput } from './playback-diagnostics.model';
import * as diagnostics from './playback-diagnostics.util';

interface ExpectedVhsPlaybackEvidence {
    readonly engineType: string;
    readonly mediaErrorCode: number | string;
    readonly disposition: string;
    readonly stage: string;
    readonly httpStatus?: number;
}

type EvidenceFactory = (
    error: NativePlaybackErrorInput
) => ExpectedVhsPlaybackEvidence;

interface VideoJsErrorConstants {
    readonly [name: string]: string;
}

describe('VHS playback evidence', () => {
    it('matches the installed public videojs.Error identifiers', () => {
        expect(Object.values(getEngineTypes()).sort()).toEqual(
            Object.values(getInstalledVideoJsErrors()).sort()
        );
    });

    it('extracts only allowlisted fields from a real VHS bad-status shape', () => {
        const secret = 'vhs-evidence-secret';
        const evidence = createEvidence({
            code: 4,
            status: 503,
            message:
                'HLS playlist request error at URL: ' +
                `https://provider.example/live.m3u8?token=${secret}`,
            metadata: {
                errorType: getInstalledVideoJsErrors()['NetworkBadStatus'],
                requestType: 'hls-playlist',
                uri: `https://provider.example/live.m3u8?token=${secret}`,
                headers: { Authorization: `Bearer ${secret}` },
                responseText: `provider body ${secret}`,
            },
        } as NativePlaybackErrorInput);
        const serialized = JSON.stringify(evidence);

        expect(evidence).toEqual({
            engineType: 'networkbadstatus',
            mediaErrorCode: 4,
            disposition: 'terminal',
            stage: 'unknown',
            httpStatus: 503,
        });
        expect(serialized).not.toContain(secret);
        expect(serialized).not.toContain('provider.example');
        expect(serialized).not.toContain('Authorization');
        expect(serialized).not.toContain('hls-playlist');
        expect(Object.keys(evidence).sort()).toEqual(
            [
                'disposition',
                'engineType',
                'httpStatus',
                'mediaErrorCode',
                'stage',
            ].sort()
        );
    });

    it.each([
        {
            engineType: 'streaminghlsplaylistparsererror',
            stage: 'playlist',
        },
        {
            engineType: 'streamingdashmanifestparsererror',
            stage: 'manifest',
        },
        {
            engineType: 'streamingfailedtoselectnextsegment',
            stage: 'segment',
        },
        {
            engineType: 'streamingfailedtodecryptsegment',
            stage: 'segment',
        },
        {
            engineType: 'streamingfailedtotransmuxsegment',
            stage: 'segment',
        },
        {
            engineType: 'streamingfailedtoappendsegment',
            stage: 'segment',
        },
        {
            engineType: 'networkrequestfailed',
            stage: 'unknown',
        },
        {
            engineType: 'streamingcontentsteeringparsererror',
            stage: 'unknown',
        },
        {
            engineType: 'streamingvttparsererror',
            stage: 'unknown',
        },
        {
            engineType: 'streamingcodecschangeerror',
            stage: 'unknown',
        },
    ])(
        'maps public $engineType evidence only to the proven $stage stage',
        ({ engineType, stage }) => {
            expect(
                createEvidence({
                    code: 3,
                    metadata: { errorType: engineType },
                }).stage
            ).toBe(stage);
        }
    );

    it.each([
        { code: 0, expected: 0 },
        { code: 5, expected: 5 },
        { code: -1, expected: 'unknown' },
        { code: 6, expected: 'unknown' },
        { code: 3.5, expected: 'unknown' },
    ])(
        'retains MediaError code $code only inside the standard range',
        ({ code, expected }) => {
            expect(createEvidence({ code }).mediaErrorCode).toBe(expected);
        }
    );

    it.each([
        { status: 399, expected: undefined },
        { status: 400, expected: 400 },
        { status: 599, expected: 599 },
        { status: 600, expected: undefined },
        { status: 404.5, expected: undefined },
    ])(
        'retains HTTP status $status only for integer 4xx and 5xx failures',
        ({ status, expected }) => {
            expect(createEvidence({ code: 2, status }).httpStatus).toBe(
                expected
            );
        }
    );

    it('keeps unknown identifiers unknown without inspecting messages or request types', () => {
        const evidence = createEvidence({
            code: 3,
            status: 0,
            message:
                'CORS codec DRM failure in hls-key request at provider URL',
            metadata: {
                errorType: 'providerCorsCodecDrmFailure',
                requestType: 'hls-key',
            },
        } as NativePlaybackErrorInput);

        expect(evidence).toEqual({
            engineType: 'unknown',
            mediaErrorCode: 3,
            disposition: 'terminal',
            stage: 'unknown',
        });
    });

    it('populates player.error before the installed Video.js error listener runs', () => {
        expect(readInstalledVideoJsErrorFromListener()).toEqual({
            code: 4,
            status: 503,
            errorType: 'networkbadstatus',
        });
    });
});

function createEvidence(
    error: NativePlaybackErrorInput
): ExpectedVhsPlaybackEvidence {
    const factory = (
        diagnostics as unknown as {
            readonly createVhsPlaybackEvidence?: EvidenceFactory;
        }
    ).createVhsPlaybackEvidence;

    expect(factory).toBeDefined();
    if (!factory) {
        throw new Error('createVhsPlaybackEvidence is not exported');
    }
    return factory(error);
}

function getEngineTypes(): VideoJsErrorConstants {
    const engineTypes = (
        diagnostics as unknown as {
            readonly VhsPlaybackEngineType?: VideoJsErrorConstants;
        }
    ).VhsPlaybackEngineType;

    expect(engineTypes).toBeDefined();
    if (!engineTypes) {
        throw new Error('VhsPlaybackEngineType is not exported');
    }
    return engineTypes;
}

function getInstalledVideoJsErrors(): VideoJsErrorConstants {
    const script =
        "import videoJs from 'video.js';" +
        'process.stdout.write(JSON.stringify(videoJs.Error));';
    const output = execFileSync(
        process.execPath,
        ['--input-type=module', '-e', script],
        {
            cwd: process.cwd(),
            encoding: 'utf8',
        }
    );

    return JSON.parse(output) as VideoJsErrorConstants;
}

function readInstalledVideoJsErrorFromListener(): {
    readonly code: number;
    readonly status: number;
    readonly errorType: string;
} {
    const script = `
        import { createRequire } from 'node:module';
        const rootRequire = createRequire(import.meta.url);
        const environmentPath = rootRequire.resolve(
            'jest-environment-jsdom/package.json'
        );
        const environmentRequire = createRequire(environmentPath);
        const { JSDOM } = environmentRequire('jsdom');
        const dom = new JSDOM(
            '<!doctype html><html><body></body></html>',
            { url: 'http://localhost/', pretendToBeVisual: true }
        );
        dom.window.HTMLMediaElement.prototype.load = () => {};
        for (const name of [
            'window',
            'document',
            'navigator',
            'Element',
            'HTMLElement',
            'HTMLVideoElement',
            'HTMLMediaElement',
            'Event',
            'CustomEvent',
            'Node',
        ]) {
            Object.defineProperty(globalThis, name, {
                value: dom.window[name],
                configurable: true,
            });
        }
        const { default: videoJs } = await import('video.js');
        videoJs.log.level('off');
        const video = document.createElement('video');
        document.body.append(video);
        const player = videoJs(video);
        let observed = null;
        player.on('error', () => {
            observed = player.error();
        });
        player.error({
            code: 4,
            status: 503,
            metadata: {
                errorType: videoJs.Error.NetworkBadStatus,
            },
        });
        process.stdout.write(JSON.stringify({
            code: observed.code,
            status: observed.status,
            errorType: observed.metadata.errorType,
        }));
        player.dispose();
        dom.window.close();
    `;
    const output = execFileSync(
        process.execPath,
        ['--input-type=module', '-e', script],
        {
            cwd: process.cwd(),
            encoding: 'utf8',
        }
    );

    return JSON.parse(output) as {
        readonly code: number;
        readonly status: number;
        readonly errorType: string;
    };
}
