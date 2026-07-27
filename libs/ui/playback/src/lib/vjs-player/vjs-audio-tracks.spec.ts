import {
    VjsAudioTracks,
    logVjsAudioTracks,
    setupVjsAudioTrackMenu,
    type VjsAudioTracksConfig,
} from './vjs-audio-tracks';
import type {
    VideoJsAudioTrack,
    VideoJsAudioTrackList,
    VideoJsPlayer,
} from './vjs-player.types';

type AudioTrackPlayer = Pick<
    VideoJsPlayer,
    'audioTracks' | 'getChild' | 'tech'
>;

type TestAudioTrackList = VideoJsAudioTrackList & {
    emit: (type: string) => void;
};

function createTrackList(tracks: VideoJsAudioTrack[]): TestAudioTrackList {
    const listeners = new Map<
        string,
        Set<EventListenerOrEventListenerObject>
    >();
    const list = {
        length: tracks.length,
        addEventListener: jest.fn(
            (type: string, listener: EventListenerOrEventListenerObject) => {
                const eventListeners = listeners.get(type) ?? new Set();
                eventListeners.add(listener);
                listeners.set(type, eventListeners);
            }
        ),
        removeEventListener: jest.fn(
            (type: string, listener: EventListenerOrEventListenerObject) => {
                listeners.get(type)?.delete(listener);
            }
        ),
        emit: (type: string) => {
            const event = { type } as Event;
            for (const listener of listeners.get(type) ?? []) {
                if (typeof listener === 'function') {
                    listener(event);
                } else {
                    listener.handleEvent(event);
                }
            }
        },
    } as TestAudioTrackList;
    tracks.forEach((track, index) => {
        list[index] = track;
    });
    return list;
}

function createPlayer(
    audioTracks: () => VideoJsAudioTrackList | null,
    overrides: Partial<AudioTrackPlayer> = {}
): AudioTrackPlayer {
    return {
        audioTracks,
        getChild: jest.fn(() => null),
        tech: jest.fn(() => null),
        ...overrides,
    };
}

function createAudioTracks(
    player: AudioTrackPlayer,
    refresh = jest.fn()
): VjsAudioTracks {
    const config: VjsAudioTracksConfig = { player, refresh };
    return new VjsAudioTracks(config);
}

describe('VjsAudioTracks', () => {
    it('projects labels and keeps track IDs stable when the list order changes', () => {
        const english: VideoJsAudioTrack = {
            label: 'English',
            enabled: true,
        };
        const german: VideoJsAudioTrack = {
            language: 'de',
            enabled: false,
        };
        const unnamed: VideoJsAudioTrack = { enabled: false };
        const list = createTrackList([english, german, unnamed]);
        const audioTracks = createAudioTracks(createPlayer(() => list));

        audioTracks.bind();

        expect(audioTracks.getAudioTracks()).toEqual([
            { id: 0, label: 'English', selected: true },
            { id: 1, label: 'de', selected: false },
            { id: 2, label: 'Audio 3', selected: false },
        ]);

        list[0] = german;
        list[1] = english;

        expect(audioTracks.getAudioTracks()).toEqual([
            { id: 1, label: 'de', selected: false },
            { id: 0, label: 'English', selected: true },
            { id: 2, label: 'Audio 3', selected: false },
        ]);
    });

    it('selects exactly one valid projected track', () => {
        const first: VideoJsAudioTrack = { enabled: true };
        const second: VideoJsAudioTrack = { enabled: false };
        const third: VideoJsAudioTrack = { enabled: false };
        const list = createTrackList([first, second, third]);
        const audioTracks = createAudioTracks(createPlayer(() => list));
        audioTracks.bind();
        const secondId = audioTracks.getAudioTracks()[1].id;

        audioTracks.setAudioTrack(secondId);

        expect([first.enabled, second.enabled, third.enabled]).toEqual([
            false,
            true,
            false,
        ]);
    });

    it('keeps selection unchanged for invalid and stale track IDs', () => {
        const first: VideoJsAudioTrack = { enabled: true };
        const removed: VideoJsAudioTrack = { enabled: false };
        const list = createTrackList([first, removed]);
        const audioTracks = createAudioTracks(createPlayer(() => list));
        audioTracks.bind();
        const staleId = audioTracks.getAudioTracks()[1].id;

        list.length = 1;
        delete list[1];

        audioTracks.setAudioTrack(staleId);
        audioTracks.setAudioTrack(99);
        audioTracks.setAudioTrack(0.5);

        expect(first.enabled).toBe(true);
    });

    it('binds stable add, remove, change, and label callbacks once per list', () => {
        const list = createTrackList([
            { label: 'English', enabled: true },
            { label: 'German', enabled: false },
        ]);
        const refresh = jest.fn();
        const audioTracks = createAudioTracks(
            createPlayer(() => list),
            refresh
        );

        audioTracks.bind();
        audioTracks.bind();

        expect(list.addEventListener).toHaveBeenCalledTimes(4);
        expect(
            (list.addEventListener as jest.Mock).mock.calls.map(
                ([type]) => type
            )
        ).toEqual(['addtrack', 'removetrack', 'change', 'labelchange']);

        list.emit('addtrack');
        list.emit('removetrack');
        list.emit('change');
        list.emit('labelchange');

        expect(refresh).toHaveBeenCalledTimes(4);
    });

    it('rebinds by list identity and removes the exact callbacks', () => {
        const firstList = createTrackList([{ enabled: true }]);
        const secondList = createTrackList([{ enabled: true }]);
        let currentList: VideoJsAudioTrackList | null = firstList;
        const audioTracks = createAudioTracks(createPlayer(() => currentList));

        audioTracks.bind();
        const firstListeners = new Map(
            (firstList.addEventListener as jest.Mock).mock.calls.map(
                ([type, listener]) => [type, listener]
            )
        );

        currentList = secondList;
        audioTracks.bind();

        expect(firstList.removeEventListener).toHaveBeenCalledTimes(4);
        for (const [type, listener] of firstListeners) {
            expect(firstList.removeEventListener).toHaveBeenCalledWith(
                type,
                listener
            );
        }
        expect(secondList.addEventListener).toHaveBeenCalledTimes(4);

        const secondListeners = new Map(
            (secondList.addEventListener as jest.Mock).mock.calls.map(
                ([type, listener]) => [type, listener]
            )
        );
        audioTracks.clear();
        audioTracks.clear();

        expect(secondList.removeEventListener).toHaveBeenCalledTimes(4);
        for (const [type, listener] of secondListeners) {
            expect(secondList.removeEventListener).toHaveBeenCalledWith(
                type,
                listener
            );
        }
    });

    it('resets the per-source ID allocation without replacing the list', () => {
        const list = createTrackList([{ label: 'Old A' }, { label: 'Old B' }]);
        const audioTracks = createAudioTracks(createPlayer(() => list));
        audioTracks.bind();
        expect(audioTracks.getAudioTracks().map(({ id }) => id)).toEqual([
            0, 1,
        ]);

        list[0] = { label: 'New A' };
        list[1] = { label: 'New B' };
        audioTracks.resetSource();

        expect(audioTracks.getAudioTracks()).toEqual([
            { id: 0, label: 'New A', selected: false },
            { id: 1, label: 'New B', selected: false },
        ]);
    });

    it('keeps the legacy menu refreshed when tracks are added or removed', () => {
        const list = createTrackList([
            { label: 'English', enabled: true },
            { label: 'German', enabled: false },
        ]);
        const audioButton = { show: jest.fn(), update: jest.fn() };
        const controlBar = {
            getChild: jest.fn(() => audioButton),
            addChild: jest.fn(),
        };
        const player = createPlayer(() => list, {
            getChild: jest.fn(() => controlBar),
        });
        const audioTracks = createAudioTracks(player);
        audioTracks.bind();

        list.emit('addtrack');
        list.emit('removetrack');

        expect(audioButton.show).toHaveBeenCalledTimes(2);
        expect(audioButton.update).toHaveBeenCalledTimes(2);
    });
});

describe('legacy Video.js audio-track helpers', () => {
    it('skips the menu when fewer than two tracks are available', () => {
        const getChild = jest.fn();

        setupVjsAudioTrackMenu(
            createPlayer(() => createTrackList([{ enabled: true }]), {
                getChild,
            })
        );
        setupVjsAudioTrackMenu(
            createPlayer(() => null, {
                getChild,
            })
        );

        expect(getChild).not.toHaveBeenCalled();
    });

    it('reuses either supported audio button name', () => {
        const lowerButton = { show: jest.fn(), update: jest.fn() };
        const lowerControlBar = {
            getChild: jest.fn((name: string) =>
                name === 'audioTrackButton' ? lowerButton : null
            ),
            addChild: jest.fn(),
        };
        setupVjsAudioTrackMenu(
            createPlayer(
                () => createTrackList([{ enabled: true }, { enabled: false }]),
                { getChild: jest.fn(() => lowerControlBar) }
            )
        );

        const capitalButton = { show: jest.fn(), update: jest.fn() };
        const capitalControlBar = {
            getChild: jest.fn((name: string) =>
                name === 'AudioTrackButton' ? capitalButton : null
            ),
            addChild: jest.fn(),
        };
        setupVjsAudioTrackMenu(
            createPlayer(
                () => createTrackList([{ enabled: true }, { enabled: false }]),
                { getChild: jest.fn(() => capitalControlBar) }
            )
        );

        expect(lowerControlBar.addChild).not.toHaveBeenCalled();
        expect(lowerButton.show).toHaveBeenCalledTimes(1);
        expect(lowerButton.update).toHaveBeenCalledTimes(1);
        expect(capitalControlBar.addChild).not.toHaveBeenCalled();
        expect(capitalButton.show).toHaveBeenCalledTimes(1);
        expect(capitalButton.update).toHaveBeenCalledTimes(1);
    });

    it('adds the legacy audio button when the control bar lacks one', () => {
        const audioButton = { show: jest.fn(), update: jest.fn() };
        const controlBar = {
            getChild: jest.fn(() => null),
            addChild: jest.fn(() => audioButton),
        };
        setupVjsAudioTrackMenu(
            createPlayer(
                () => createTrackList([{ enabled: true }, { enabled: false }]),
                { getChild: jest.fn(() => controlBar) }
            )
        );

        expect(controlBar.addChild).toHaveBeenCalledWith(
            'audioTrackButton',
            {}
        );
        expect(audioButton.show).toHaveBeenCalledTimes(1);
        expect(audioButton.update).toHaveBeenCalledTimes(1);
    });

    it('logs tracks and reads main or legacy master HLS audio groups', () => {
        const list = createTrackList([
            {
                label: 'English',
                language: 'en',
                enabled: true,
                kind: 'main',
            },
        ]);
        const mainTech = jest.fn(() => ({
            vhs: {
                playlists: {
                    main: { mediaGroups: { AUDIO: { english: {} } } },
                },
            },
        }));
        const masterTech = jest.fn(() => ({
            vhs: {
                playlists: {
                    master: { mediaGroups: { AUDIO: { german: {} } } },
                },
            },
        }));

        expect(() =>
            logVjsAudioTracks(createPlayer(() => list, { tech: mainTech }))
        ).not.toThrow();
        expect(() =>
            logVjsAudioTracks(createPlayer(() => list, { tech: masterTech }))
        ).not.toThrow();

        expect(mainTech).toHaveBeenCalledWith({
            IWillNotUseThisInPlugins: true,
        });
        expect(masterTech).toHaveBeenCalledWith({
            IWillNotUseThisInPlugins: true,
        });
    });
});
