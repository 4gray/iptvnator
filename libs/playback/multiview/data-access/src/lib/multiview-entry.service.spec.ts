import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SettingsStore } from '@iptvnator/services';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import {
    MultiviewAnchorRegistry,
    type MultiviewAnchorHost,
} from './multiview-anchor-registry';
import { MultiviewEntryService } from './multiview-entry.service';
import {
    MULTIVIEW_SOURCE_PICKER,
    type MultiviewSourcePicker,
} from './multiview-ports';
import type { MultiviewTileSource } from './multiview-session.model';
import { MultiviewSessionStore } from './multiview-session.store';

function source(key: string): MultiviewTileSource {
    return {
        playback: {
            streamUrl: `https://stream.example/${key}.m3u8`,
            title: key,
        },
        playbackSessionKey: `session:${key}`,
        kind: 'live',
        playlistId: 'playlist-1',
        title: key,
    };
}

function host(
    anchorId: string,
    playing: MultiviewTileSource | null,
    engine = VideoPlayer.VideoJs
): MultiviewAnchorHost {
    return {
        anchorId,
        source: signal(playing),
        engine: signal(engine),
    };
}

function deferredSource() {
    let resolve!: (value: MultiviewTileSource) => void;
    const promise = new Promise<MultiviewTileSource>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

describe('MultiviewEntryService', () => {
    let picker: jest.Mocked<MultiviewSourcePicker> | null;

    function setup(): {
        entry: MultiviewEntryService;
        anchors: MultiviewAnchorRegistry;
        store: MultiviewSessionStore;
    } {
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: SettingsStore,
                    useValue: { player: signal(VideoPlayer.VideoJs) },
                },
                ...(picker
                    ? [{ provide: MULTIVIEW_SOURCE_PICKER, useValue: picker }]
                    : []),
            ],
        });
        return {
            entry: TestBed.inject(MultiviewEntryService),
            anchors: TestBed.inject(MultiviewAnchorRegistry),
            store: TestBed.inject(MultiviewSessionStore),
        };
    }

    beforeEach(() => {
        picker = null;
    });

    describe('anchors', () => {
        it('treats the most recently mounted anchor as current', () => {
            const { anchors } = setup();
            const first = { host: host('m3u', null), element: signal(null) };
            const second = {
                host: host('xtream', null),
                element: signal(null),
            };

            const unregister = anchors.register(first);
            anchors.register(second);
            expect(anchors.current()).toBe(second);

            unregister();
            expect(anchors.find('m3u')).toBeNull();
            expect(anchors.find('xtream')).toBe(second);
        });

        it('reports the placeholder element of an anchor', () => {
            const { anchors } = setup();
            const element = document.createElement('div');
            anchors.register({
                host: host('xtream', null),
                element: signal(element),
            });

            expect(anchors.elementFor('xtream')).toBe(element);
            expect(anchors.elementFor('other')).toBeNull();
            expect(anchors.elementFor(null)).toBeNull();
        });
    });

    describe('add', () => {
        it('starts a session on the current anchor with its source and engine', () => {
            const { entry, anchors, store } = setup();
            anchors.register({
                host: host('xtream', source('movie'), VideoPlayer.ArtPlayer),
                element: signal(null),
            });

            expect(entry.canAdd()).toBe(true);
            expect(entry.add(source('match'))).toBeNull();
            expect(store.anchorId()).toBe('xtream');
            expect(store.tiles().map((tile) => tile.engine)).toEqual([
                VideoPlayer.ArtPlayer,
                VideoPlayer.Html5Player,
            ]);
        });

        it('continues a VOD from the anchor position', () => {
            const { entry, anchors, store } = setup();
            anchors.register({
                host: host('m3u', { ...source('movie'), kind: 'vod' }),
                element: signal(null),
                position: () => 754,
            });

            entry.add(source('match'));

            expect(store.tiles()[0].position).toBe(754);
        });

        it('keeps a position the source already carries', () => {
            const { entry, anchors, store } = setup();
            anchors.register({
                host: host('vod', {
                    ...source('movie'),
                    kind: 'vod',
                    position: 30,
                }),
                element: signal(null),
                position: () => 754,
            });

            entry.add(source('match'));

            expect(store.tiles()[0].position).toBe(30);
        });

        it('adds to a running session', () => {
            const { entry, anchors, store } = setup();
            anchors.register({
                host: host('xtream', source('movie')),
                element: signal(null),
            });
            entry.add(source('match'));

            expect(entry.add(source('news'))).toMatchObject({
                type: 'replaced',
            });
            expect(store.tiles()[1].playbackSessionKey).toBe('session:news');
        });

        it.each([
            ['no anchor is mounted', null],
            ['the anchor plays nothing', host('xtream', null)],
        ])('refuses when %s', (_label, anchorHost) => {
            const { entry, anchors, store } = setup();
            if (anchorHost) {
                anchors.register({ host: anchorHost, element: signal(null) });
            }

            expect(entry.canAdd()).toBe(false);
            expect(entry.add(source('match'))).toEqual({
                type: 'rejected',
                reason: 'no-anchor',
            });
            expect(store.exists()).toBe(false);
        });

        it('refuses for a player multiview cannot run on', () => {
            const { entry, anchors } = setup();
            anchors.register({
                host: host('m3u', source('movie'), VideoPlayer.EmbeddedMpv),
                element: signal(null),
            });

            expect(entry.canAdd()).toBe(false);
            expect(entry.add(source('match'))).toEqual({
                type: 'rejected',
                reason: 'unsupported-player',
            });
        });
    });

    describe('pick', () => {
        it('has no picker without a provider', async () => {
            const { entry } = setup();

            expect(entry.hasPicker).toBe(false);
            await expect(entry.pick()).resolves.toBeNull();
        });

        it('adds the picked source', async () => {
            picker = { pick: jest.fn().mockResolvedValue(source('match')) };
            const { entry, anchors, store } = setup();
            anchors.register({
                host: host('xtream', source('movie')),
                element: signal(null),
            });

            expect(entry.hasPicker).toBe(true);
            await entry.pick();

            expect(picker.pick).toHaveBeenCalledWith({ context: 'add' });
            expect(store.tiles()).toHaveLength(2);
        });

        it('replaces the tile it was opened for', async () => {
            picker = { pick: jest.fn().mockResolvedValue(source('news')) };
            const { entry, anchors, store } = setup();
            anchors.register({
                host: host('xtream', source('movie')),
                element: signal(null),
            });
            entry.add(source('match'));
            const pipId = store.tiles()[1].id;

            await entry.pick({ context: 'replace', tileId: pipId });

            expect(store.tile(pipId)?.playbackSessionKey).toBe('session:news');
        });

        it('takes a picker installed at run time until it is removed', async () => {
            const { entry, anchors, store } = setup();
            anchors.register({
                host: host('xtream', source('movie')),
                element: signal(null),
            });
            const installed = {
                pick: jest.fn().mockResolvedValue(source('match')),
            };

            const remove = entry.usePicker(installed);
            expect(entry.hasPicker).toBe(true);
            await entry.pick();
            expect(store.tiles()).toHaveLength(2);

            remove();
            expect(entry.hasPicker).toBe(false);
        });

        it('changes nothing when the viewer closes the picker', async () => {
            picker = { pick: jest.fn().mockResolvedValue(null) };
            const { entry, anchors, store } = setup();
            anchors.register({
                host: host('xtream', source('movie')),
                element: signal(null),
            });

            await expect(entry.pick()).resolves.toBeNull();
            expect(store.exists()).toBe(false);
        });
    });

    describe('channels from lists (R5)', () => {
        const channel = {
            uid: 'xtream::playlist-1::live:9',
            name: 'Synthetic Channel 9',
            contentType: 'live',
            sourceType: 'xtream',
            playlistId: 'playlist-1',
            playlistName: 'Synthetic Provider',
            xtreamId: 9,
        } as const;

        it('needs an installed resolver and an anchor that can add', () => {
            const { entry, anchors } = setup();
            anchors.register({
                host: host('xtream', source('movie')),
                element: signal(null),
            });
            expect(entry.canAddChannel()).toBe(false);

            const remove = entry.useChannelResolver({
                resolve: jest.fn().mockResolvedValue(source('ch9')),
            });
            expect(entry.canAddChannel()).toBe(true);

            remove();
            expect(entry.canAddChannel()).toBe(false);
        });

        it('adds a resolved channel, starting a session', async () => {
            const { entry, anchors, store } = setup();
            anchors.register({
                host: host('xtream', source('movie')),
                element: signal(null),
            });
            const resolve = jest.fn().mockResolvedValue(source('ch9'));
            entry.useChannelResolver({ resolve });

            await entry.addChannel(channel);

            expect(resolve).toHaveBeenCalledWith(channel);
            expect(store.tiles().map((t) => t.playbackSessionKey)).toEqual([
                'session:movie',
                'session:ch9',
            ]);
        });

        it('replaces the tile a channel is dropped on', async () => {
            const { entry, anchors, store } = setup();
            anchors.register({
                host: host('xtream', source('movie')),
                element: signal(null),
            });
            entry.add(source('match'));
            entry.useChannelResolver({
                resolve: jest.fn().mockResolvedValue(source('ch9')),
            });

            await entry.replaceWithChannel(store.tiles()[0].id, channel);

            expect(store.tiles()[0].playbackSessionKey).toBe('session:ch9');
        });

        it('drops a channel that resolves after the session ended', async () => {
            const { entry, anchors, store } = setup();
            anchors.register({
                host: host('xtream', source('movie')),
                element: signal(null),
            });
            entry.add(source('match'));
            const later = deferredSource();
            entry.useChannelResolver({ resolve: () => later.promise });

            const pending = entry.addChannel(channel);
            store.exit();
            later.resolve(source('ch9'));

            await expect(pending).resolves.toBeNull();
            expect(store.exists()).toBe(false);
        });

        it('drops a channel resolved for a session that was replaced by another', async () => {
            const { entry, anchors, store } = setup();
            anchors.register({
                host: host('xtream', source('movie')),
                element: signal(null),
            });
            entry.add(source('match'));
            const later = deferredSource();
            entry.useChannelResolver({ resolve: () => later.promise });

            const pending = entry.addChannel(channel);
            store.exit();
            entry.add(source('news'));
            later.resolve(source('ch9'));

            await expect(pending).resolves.toBeNull();
            expect(store.tiles()[1].playbackSessionKey).toBe('session:news');
        });

        it('drops a drop whose tile changed meanwhile', async () => {
            const { entry, anchors, store } = setup();
            anchors.register({
                host: host('xtream', source('movie')),
                element: signal(null),
            });
            entry.add(source('match'));
            const later = deferredSource();
            entry.useChannelResolver({ resolve: () => later.promise });
            const pipId = store.tiles()[1].id;

            const pending = entry.replaceWithChannel(pipId, channel);
            store.replace(pipId, source('news'));
            later.resolve(source('ch9'));

            await expect(pending).resolves.toBeNull();
            expect(store.tile(pipId)?.playbackSessionKey).toBe('session:news');
        });

        it('changes nothing when the channel cannot be resolved', async () => {
            const { entry, anchors, store } = setup();
            anchors.register({
                host: host('xtream', source('movie')),
                element: signal(null),
            });
            entry.useChannelResolver({
                resolve: jest.fn().mockRejectedValue(new Error('locked')),
            });

            await expect(entry.addChannel(channel)).resolves.toBeNull();
            expect(store.exists()).toBe(false);
        });
    });
});
