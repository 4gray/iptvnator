import {
    InlinePlaybackPlayer,
    type PlaybackDiagnostic,
} from '@iptvnator/playback/util';
import {
    createFakeShakaEnvironment,
    flushShakaMicrotasks as flush,
} from './shaka-player-test-double';
import { ShakaVideoSession } from './shaka-video-session';

type Filter = (type: number, response: { data: BufferSource }) => void;
const manifest = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period>
  <AdaptationSet contentType="video">
    <ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/>
    <ContentProtection schemeIdUri="urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95"/>
    <Representation codecs="avc1.64001e"/>
    <Representation codecs="https://secret.test/?token=secret"/>
  </AdaptationSet>
  <AdaptationSet mimeType="audio/mp4" codecs="mp4a.40.29"/>
  <BaseURL>https://secret.test/?token=secret</BaseURL>
</Period></MPD>`;

describe('Shaka diagnostic source evidence', () => {
    function setup() {
        const filters = new Set<Filter>();
        const issues: PlaybackDiagnostic[] = [];
        const environment = createFakeShakaEnvironment({
            onCreate: (player) =>
                Object.assign(player, {
                    getNetworkingEngine: () => ({
                        registerResponseFilter: (filter: Filter) =>
                            filters.add(filter),
                        unregisterResponseFilter: (filter: Filter) =>
                            filters.delete(filter),
                    }),
                }),
        });
        const session = new ShakaVideoSession({
            player: InlinePlaybackPlayer.Html5,
            emitPlaybackIssue: (issue) => issues.push(issue),
            loadShaka: environment.loader,
        });
        const respond = (xml: string, type = 0) => {
            const response = { data: new TextEncoder().encode(xml) };
            for (const filter of filters) filter(type, response);
            expect(new TextDecoder().decode(response.data)).toBe(xml);
        };
        return { filters, issues, environment, session, respond };
    }

    it('keeps advertised codecs and DRM on a terminal startup failure', async () => {
        const { filters, issues, environment, session, respond } = setup();
        session.start(
            document.createElement('video'),
            'https://example.test/live.mpd'
        );
        await flush();
        respond(manifest);
        environment.instances[0].dispatch('error', {
            severity: 2,
            category: 6,
            code: 6001,
        });
        expect(issues[0]).toMatchObject({
            code: 'drm-or-encryption',
            videoCodecs: ['avc1.64001e'],
            audioCodecs: ['mp4a.40.29'],
            drmSystems: ['widevine', 'playready'],
        });
        expect(JSON.stringify(issues)).not.toContain('secret');
        expect(filters.size).toBe(0);
    });

    it('does not let old response callbacks enrich the next channel', async () => {
        const { filters, issues, environment, session, respond } = setup();
        const video = document.createElement('video');
        session.start(video, 'https://example.test/first.mpd');
        await flush();
        const oldFilters = [...filters];
        respond(manifest);
        session.start(video, 'https://example.test/second.mpd');
        await flush();
        for (const filter of oldFilters)
            filter(0, { data: new TextEncoder().encode(manifest) });
        environment.instances[1].dispatch('error', {
            severity: 2,
            category: 1,
            code: 1003,
        });
        expect(issues[0].audioCodecs).toEqual([]);
        expect(issues[0].videoCodecs).toEqual([]);
        expect(issues[0]).not.toHaveProperty('drmSystems', [
            'widevine',
            'playready',
        ]);
    });

    it('retains a configured ClearKey name without exposing keys', async () => {
        const { session, issues, environment } = setup();
        session.start(
            document.createElement('video'),
            'https://example.test/live.mpd',
            {
                licenseType: 'clearkey',
                supported: true,
                clearKeys: { 'private-key-id': 'private-content-key' },
            }
        );
        await flush();
        environment.instances[0].dispatch('error', {
            severity: 2,
            category: 6,
            code: 6007,
        });
        expect(issues[0]).toHaveProperty('drmSystems', ['clearkey']);
        expect(JSON.stringify(issues)).not.toContain('private-');
    });

    it.each([
        ['malformed', '<MPD><broken>', 0],
        [
            'DTD-bearing',
            '<!DOCTYPE MPD [<!ENTITY label "secret">]>' + manifest,
            0,
        ],
        ['non-manifest response', manifest, 1],
        ['oversized', manifest + ' '.repeat(2 * 1024 * 1024), 0],
        ['non-DASH XML', manifest.replaceAll('MPD', 'other'), 0],
    ])(
        'ignores %s without interfering with playback',
        async (_name, xml, type) => {
            const { issues, environment, session, respond } = setup();
            session.start(
                document.createElement('video'),
                'https://example.test/live.mpd'
            );
            await flush();
            expect(() => respond(xml, type)).not.toThrow();
            environment.instances[0].dispatch('error', {
                severity: 2,
                category: 4,
                code: 4001,
            });
            expect(issues[0].videoCodecs).toEqual([]);
            expect(issues[0].code).toBe('unknown-playback-error');
        }
    );

    it('reports only a known configured DRM name, never its raw license value', () => {
        const { session, issues } = setup();
        session.start(
            document.createElement('video'),
            'https://example.test/live.mpd',
            {
                licenseType: 'com.widevine.alpha',
                supported: false,
            }
        );
        expect(issues[0]).toHaveProperty('drmSystems', ['widevine']);
        expect(JSON.stringify(issues)).not.toContain('com.widevine.alpha');
    });
});
