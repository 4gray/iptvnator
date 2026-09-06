import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { ChannelActions } from '@iptvnator/m3u-state';
import { SettingsStore } from '@iptvnator/services';
import { Channel, EpgProgram } from '@iptvnator/shared/interfaces';
import { M3uEpgGuideSourceService } from './m3u-epg-guide-source.service';

function makeChannel(
    id: string,
    overrides: Partial<Channel> & { tvgId?: string; group?: string } = {}
): Channel {
    return {
        id,
        url: `https://example.com/${id}.m3u8`,
        name: overrides.name ?? `Channel ${id}`,
        group: { title: overrides.group ?? 'News' },
        tvg: {
            id: overrides.tvgId ?? '',
            name: '',
            url: '',
            logo: overrides.tvg?.logo ?? '',
            rec: '',
        },
        http: { referrer: '', 'user-agent': '', origin: '' },
        radio: overrides.radio ?? 'false',
    } as Channel;
}

function program(channel: string): EpgProgram {
    return {
        start: '2026-09-06T16:00:00.000Z',
        stop: '2026-09-06T17:00:00.000Z',
        channel,
        title: `${channel} show`,
        desc: null,
        category: null,
    };
}

describe('M3uEpgGuideSourceService', () => {
    const channels = signal<Channel[]>([]);
    const favoriteKeys = signal<string[]>([]);
    const activeChannel = signal<Channel | null>(null);
    const selectedGroup = signal<string | null>(null);
    const dispatch = jest.fn();
    const getProgramsForChannels = jest.fn();
    const getProgramCoverage = jest.fn();
    const searchPrograms = jest.fn();
    let service: M3uEpgGuideSourceService;
    let translateStub: { instant: (key: string) => string };
    let onLangChange: Subject<{ lang: string }>;

    beforeEach(() => {
        dispatch.mockReset();
        getProgramsForChannels.mockReset();
        getProgramCoverage.mockReset();
        searchPrograms.mockReset();
        onLangChange = new Subject<{ lang: string }>();
        translateStub = { instant: (key: string) => key };
        channels.set([
            makeChannel('a', { tvgId: 'a.tv', group: 'News' }),
            makeChannel('b', { name: 'Beta', group: 'Sports' }),
            makeChannel('c', { name: '   ', group: 'Sports' }),
        ]);
        favoriteKeys.set(['https://example.com/b.m3u8']);
        activeChannel.set(channels()[0]);
        selectedGroup.set(null);
        TestBed.configureTestingModule({
            providers: [
                M3uEpgGuideSourceService,
                { provide: Store, useValue: { dispatch } },
                {
                    provide: EpgRuntimeBridgeService,
                    useValue: {
                        getProgramsForChannels,
                        getProgramCoverage,
                        searchPrograms,
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: { stripCountryPrefix: signal(false) },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        get instant() {
                            return translateStub.instant;
                        },
                        onLangChange,
                    },
                },
            ],
        });
        service = TestBed.inject(M3uEpgGuideSourceService);
        service.bind({ channels, favoriteKeys, activeChannel, selectedGroup });
    });

    it('offers all / groups / favorites scopes and lists channels in playlist order', () => {
        expect(service.scopes().map((scope) => scope.id)).toEqual([
            'all',
            'favorites',
            'group:News',
            'group:Sports',
        ]);
        expect(service.channels().map((channel) => channel.number)).toEqual([
            1, 2, 3,
        ]);
        service.setScope('group:Sports');
        // Row ids are scope-local: the position inside the scope, then the
        // channel id.
        expect(service.channels().map((channel) => channel.id)).toEqual([
            '0:b',
            '1:c',
        ]);
        expect(service.channels()[0].number).toBe(1);
        service.setScope('favorites');
        expect(service.channels().map((channel) => channel.id)).toEqual([
            '0:b',
        ]);
        // Legacy rows saved before URL keys are still matched by channel id.
        favoriteKeys.set(['c']);
        expect(service.channels().map((channel) => channel.id)).toEqual([
            '0:c',
        ]);
    });

    it('derives the EPG key from tvg-id, then name, and null for blank names', () => {
        const keys = service.channels().map((channel) => channel.epgKey);
        expect(keys).toEqual(['a.tv', 'Beta', null]);
    });

    it('loads programmes and coverage through the bridge keyed back by channel id', async () => {
        getProgramsForChannels.mockResolvedValue({
            'a.tv': [program('a.tv')],
            Beta: [],
        });
        getProgramCoverage.mockResolvedValue(['a.tv']);
        const window = { channels: service.channels(), fromMs: 1, toMs: 2 };

        const programs = await service.loadPrograms(window);
        expect(getProgramsForChannels).toHaveBeenCalledWith({
            channelIds: ['a.tv', 'Beta'],
            fromMs: 1,
            toMs: 2,
        });
        expect(programs.get('0:a')?.[0].title).toBe('a.tv show');
        expect(programs.get('1:b')).toEqual([]);
        expect(programs.has('2:c')).toBe(false);

        const covered = await service.loadCoverage(window);
        expect(covered).toEqual(new Set(['0:a']));
    });

    it('answers empty results when the bridge is unavailable', async () => {
        getProgramsForChannels.mockResolvedValue(null);
        getProgramCoverage.mockResolvedValue(null);
        const window = { channels: service.channels(), fromMs: 1, toMs: 2 };
        expect((await service.loadPrograms(window)).size).toBe(0);
        expect((await service.loadCoverage(window)).size).toBe(0);
    });

    it('marks the duplicate whose stream url matches the playing channel', () => {
        const first = makeChannel('dup');
        const second = {
            ...makeChannel('dup'),
            url: 'https://example.com/second.m3u8',
        };
        channels.set([first, second]);
        activeChannel.set(second);
        expect(service.activeChannelId()).toBe('1:dup');
        activeChannel.set({
            ...makeChannel('dup'),
            url: 'https://example.com/unknown.m3u8',
        });
        expect(service.activeChannelId()).toBe('0:dup');
    });

    it('marks the copy in the selected group when a stream is listed twice', () => {
        const news = makeChannel('dup', { group: 'News' });
        const sports = makeChannel('dup', { group: 'Sports' });
        channels.set([news, sports]);
        activeChannel.set({ ...sports });
        expect(service.activeChannelId()).toBe('1:dup');
        activeChannel.set({ ...news });
        expect(service.activeChannelId()).toBe('0:dup');
    });

    it('marks the copy whose playback headers match when everything else is equal', () => {
        const plain = makeChannel('dup');
        const withUa = {
            ...makeChannel('dup'),
            http: { referrer: '', 'user-agent': 'VLC/3', origin: '' },
        };
        channels.set([plain, withUa]);
        activeChannel.set({ ...withUa, epgParams: '' });
        expect(service.activeChannelId()).toBe('1:dup');
        activeChannel.set({ ...plain, epgParams: '' });
        expect(service.activeChannelId()).toBe('0:dup');
    });

    it('propagates a coverage failure so the guide keeps coverage unknown', async () => {
        getProgramCoverage.mockRejectedValue(new Error('bridge down'));
        await expect(
            service.loadCoverage({
                channels: service.channels(),
                fromMs: 1,
                toMs: 2,
            })
        ).rejects.toThrow('bridge down');
    });

    it('mirrors the active channel and dispatches playback on activate', () => {
        expect(service.activeChannelId()).toBe('0:a');
        service.activate('1:b');
        expect(dispatch).toHaveBeenCalledWith(
            ChannelActions.setActiveChannel({
                channel: channels()[1],
                startPlayback: true,
            })
        );
        service.activate('missing');
        expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it('keeps duplicate channel ids apart and activates the row that was clicked', () => {
        // `createChannel` falls back to the URL as the id, so one stream
        // listed twice yields two channels sharing an id. A real id can also
        // look like a generated suffix (`x#1`), so suffixing the repeats made
        // the third row collide with the second; the position prefix cannot.
        const duplicated = signal<Channel[]>([
            makeChannel('x', { name: 'First copy', group: 'News' }),
            makeChannel('x', { name: 'Second copy', group: 'News' }),
            makeChannel('x#1', { name: 'Hashed id', group: 'News' }),
        ]);
        service.bind({
            channels: duplicated,
            favoriteKeys,
            activeChannel: signal<Channel | null>(duplicated()[0]),
            selectedGroup,
        });

        const rowIds = service.channels().map((channel) => channel.id);
        expect(rowIds).toEqual(['0:x', '1:x', '2:x#1']);
        expect(new Set(rowIds).size).toBe(3);
        // The playing channel marks the first of the two rows.
        expect(service.activeChannelId()).toBe('0:x');

        service.activate('1:x');
        expect(dispatch).toHaveBeenLastCalledWith(
            ChannelActions.setActiveChannel({
                channel: duplicated()[1],
                startPlayback: true,
            })
        );

        service.activate('2:x#1');
        expect(dispatch).toHaveBeenLastCalledWith(
            ChannelActions.setActiveChannel({
                channel: duplicated()[2],
                startPlayback: true,
            })
        );
    });

    it('seeds the initial scope from the sidebar view', () => {
        service.applyInitialScope('favorites');
        expect(service.scopeId()).toBe('favorites');
        service.applyInitialScope('groups');
        expect(service.scopeId()).toBe('group:News');
        service.applyInitialScope('all');
        expect(service.scopeId()).toBe('all');
    });

    it("prefers the sidebar's selected group over the playing channel's group", () => {
        selectedGroup.set('Sports');

        service.applyInitialScope('groups');

        expect(service.scopeId()).toBe('group:Sports');
    });

    it('falls back to the playing group when the selected one offers no rows', () => {
        selectedGroup.set('Nothing Here');

        service.applyInitialScope('groups');

        expect(service.scopeId()).toBe('group:News');
    });

    it("falls back to the all scope when the active channel's group has no eligible channels", () => {
        const sportsOnlyChannels = signal<Channel[]>([
            makeChannel('b', { name: 'Beta', group: 'Sports' }),
        ]);
        const newsActiveChannel = signal<Channel | null>(
            makeChannel('a', { tvgId: 'a.tv', group: 'News' })
        );
        service.bind({
            channels: sportsOnlyChannels,
            favoriteKeys,
            activeChannel: newsActiveChannel,
            selectedGroup,
        });

        service.applyInitialScope('groups');

        expect(service.scopeId()).toBe('all');
    });

    it('re-labels scopes when the active language changes', () => {
        expect(service.scopes()[0].label).toBe('CHANNELS.ALL_CHANNELS');

        translateStub.instant = (key: string) => `${key}!`;
        onLangChange.next({ lang: 'de' });

        expect(service.scopes()[0].label).toBe('CHANNELS.ALL_CHANNELS!');
    });

    it('forwards programme search to the bridge', async () => {
        searchPrograms.mockResolvedValue([program('a.tv'), program('x')]);
        const hits = await service.searchPrograms('news');
        expect(hits.map((hit) => hit.channelId)).toEqual(['0:a', null]);
        expect(hits[1].program.title).toBe('x show');
        expect(searchPrograms).toHaveBeenCalledWith('news', 20);
    });
});
