import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { StalkerSessionService } from '@iptvnator/portal/stalker/data-access';
import { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import {
    XtreamApiService,
    XtreamUrlService,
} from '@iptvnator/portal/xtream/data-access';
import {
    DataService,
    PlaylistsService,
    SettingsStore,
} from '@iptvnator/services';
import { Channel, ChannelDrm } from '@iptvnator/shared/interfaces';
import { StreamResolverService } from './stream-resolver.service';

// The main resolver spec is at the test line cap.
describe('StreamResolverService M3U collection DRM', () => {
    const clearKey: ChannelDrm = {
        licenseType: 'clearkey',
        supported: true,
        clearKeys: {
            '00112233445566778899aabbccddeeff':
                'ffeeddccbbaa99887766554433221100',
        },
    };
    const unsupported: ChannelDrm = {
        licenseType: 'com.widevine.alpha',
        supported: false,
    };
    const raw = [
        '#EXTINF:-1,Encrypted channel',
        '#KODIPROP:inputstream.adaptive.license_type=clearkey',
        '#KODIPROP:inputstream.adaptive.license_key=00112233445566778899aabbccddeeff:ffeeddccbbaa99887766554433221100',
        'https://example.test/live.mpd',
    ].join('\n');
    const item: UnifiedCollectionItem = {
        uid: 'm3u::playlist::channel',
        sourceType: 'm3u',
        contentType: 'live',
        playlistId: 'playlist',
        playlistName: 'Playlist',
        name: 'Channel',
        channelId: 'channel',
        streamUrl: 'https://example.test/live.mpd',
    };
    let service: StreamResolverService;
    let channel: Channel;

    beforeEach(() => {
        channel = {
            id: 'channel',
            name: 'Channel',
            url: item.streamUrl!,
            group: { title: '' },
            tvg: { id: '', name: '', logo: '', url: '', rec: '' },
            http: { referrer: '', 'user-agent': '', origin: '' },
            radio: 'false',
        };
        TestBed.configureTestingModule({
            providers: [
                StreamResolverService,
                {
                    provide: PlaylistsService,
                    useValue: {
                        getPlaylistById: () =>
                            of({
                                _id: 'playlist',
                                playlist: { items: [channel] },
                            }),
                    },
                },
                ...[
                    XtreamApiService,
                    XtreamUrlService,
                    StalkerSessionService,
                    DataService,
                    SettingsStore,
                ].map((provide) => ({ provide, useValue: {} })),
                {
                    provide: EpgRuntimeBridgeService,
                    useValue: { supportsProgramLookup: false },
                },
            ],
        });
        service = TestBed.inject(StreamResolverService);
    });

    describe.each([
        'resolvePlayback',
        'resolveLiveDetail',
        'resolveM3uPlaybackDetail',
    ] as const)('%s', (method) => {
        it.each([
            {
                name: 'stored ClearKey',
                metadata: { drm: clearKey },
                expected: clearKey,
            },
            {
                name: 'legacy raw KODIPROP',
                metadata: { raw },
                expected: clearKey,
            },
            {
                name: 'explicit unsupported DRM over raw fallback',
                metadata: { drm: unsupported, raw },
                expected: unsupported,
            },
            { name: 'unencrypted channel', metadata: {}, expected: undefined },
        ])('preserves $name', async ({ metadata, expected }) => {
            Object.assign(channel, metadata);
            const original = JSON.parse(JSON.stringify(channel));

            const result = await service[method](item);
            const playback = 'playback' in result ? result.playback : result;

            expect(playback.drm).toEqual(expected);
            expect(playback.streamUrl).toBe(channel.url);
            expect(channel).toEqual(original);
        });
    });
});
