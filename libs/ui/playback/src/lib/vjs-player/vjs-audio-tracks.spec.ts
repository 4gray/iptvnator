import {
    logVjsAudioTracks,
    readVjsAudioTracks,
    selectVjsAudioTrack,
    setupVjsAudioTrackMenu,
    type VideoJsAudioTrackList,
    type VjsAudioTrackPlayer,
} from './vjs-audio-tracks';

function createTrackList(
    tracks: Array<{ label?: string; language?: string; enabled?: boolean }>
): VideoJsAudioTrackList {
    const list = {
        length: tracks.length,
        addEventListener: jest.fn(),
    } as unknown as VideoJsAudioTrackList;
    tracks.forEach((track, index) => {
        (list as Record<number, unknown>)[index] = { ...track };
    });
    return list;
}

function createPlayer(
    overrides: Partial<VjsAudioTrackPlayer> = {}
): VjsAudioTrackPlayer {
    return {
        audioTracks: () => null,
        tech: () => null,
        getChild: () => null,
        ...overrides,
    };
}

describe('vjs-audio-tracks', () => {
    it('projects the audio track list onto PlayerTrack with labels and selection', () => {
        const list = createTrackList([
            { label: 'English', enabled: true },
            { language: 'de', enabled: false },
            {},
        ]);
        const player = createPlayer({ audioTracks: () => list });

        expect(readVjsAudioTracks(player)).toEqual([
            { id: 0, label: 'English', selected: true },
            { id: 1, label: 'de', selected: false },
            { id: 2, label: 'Audio 3', selected: false },
        ]);
    });

    it('returns an empty list when no audio tracks exist', () => {
        expect(readVjsAudioTracks(createPlayer())).toEqual([]);
    });

    it('enables only the selected track index', () => {
        const list = createTrackList([
            { enabled: true },
            { enabled: false },
        ]);
        selectVjsAudioTrack(createPlayer({ audioTracks: () => list }), 1);

        expect((list as Record<number, { enabled: boolean }>)[0].enabled).toBe(
            false
        );
        expect((list as Record<number, { enabled: boolean }>)[1].enabled).toBe(
            true
        );
    });

    it('does not build a control-bar menu for a single track', () => {
        const getChild = jest.fn();
        const player = createPlayer({
            audioTracks: () => createTrackList([{ enabled: true }]),
            getChild,
        });

        setupVjsAudioTrackMenu(player);

        expect(getChild).not.toHaveBeenCalled();
    });

    it('adds and shows the audio track button for multiple tracks', () => {
        const audioButton = { show: jest.fn(), update: jest.fn() };
        const controlBar = {
            getChild: jest.fn(() => null),
            addChild: jest.fn(() => audioButton),
        };
        const player = createPlayer({
            audioTracks: () =>
                createTrackList([{ enabled: true }, { enabled: false }]),
            getChild: jest.fn(() => controlBar),
        });

        setupVjsAudioTrackMenu(player);

        expect(controlBar.addChild).toHaveBeenCalledWith(
            'audioTrackButton',
            {}
        );
        expect(audioButton.show).toHaveBeenCalled();
        expect(audioButton.update).toHaveBeenCalled();
    });

    it('reuses an existing audio track button instead of adding a new one', () => {
        const audioButton = { show: jest.fn(), update: jest.fn() };
        const controlBar = {
            getChild: jest.fn((name: string) =>
                name === 'audioTrackButton' ? audioButton : null
            ),
            addChild: jest.fn(),
        };
        const player = createPlayer({
            audioTracks: () =>
                createTrackList([{ enabled: true }, { enabled: false }]),
            getChild: jest.fn(() => controlBar),
        });

        setupVjsAudioTrackMenu(player);

        expect(controlBar.addChild).not.toHaveBeenCalled();
        expect(audioButton.show).toHaveBeenCalled();
    });

    it('falls back to the capitalized AudioTrackButton child name', () => {
        const audioButton = { show: jest.fn(), update: jest.fn() };
        const controlBar = {
            getChild: jest.fn((name: string) =>
                name === 'AudioTrackButton' ? audioButton : null
            ),
            addChild: jest.fn(),
        };
        const player = createPlayer({
            audioTracks: () =>
                createTrackList([{ enabled: true }, { enabled: false }]),
            getChild: jest.fn(() => controlBar),
        });

        setupVjsAudioTrackMenu(player);

        expect(controlBar.addChild).not.toHaveBeenCalled();
        expect(audioButton.show).toHaveBeenCalled();
    });

    it('tolerates a missing control bar and a missing audio button', () => {
        const noControlBar = createPlayer({
            audioTracks: () =>
                createTrackList([{ enabled: true }, { enabled: false }]),
            getChild: jest.fn(() => null),
        });
        expect(() => setupVjsAudioTrackMenu(noControlBar)).not.toThrow();

        // Control bar exposes neither an existing button nor addChild.
        const bareControlBar = { getChild: jest.fn(() => null) };
        const noButton = createPlayer({
            audioTracks: () =>
                createTrackList([{ enabled: true }, { enabled: false }]),
            getChild: jest.fn(() => bareControlBar),
        });
        expect(() => setupVjsAudioTrackMenu(noButton)).not.toThrow();
    });

    it('skips the menu when the track list is unavailable', () => {
        const getChild = jest.fn();
        setupVjsAudioTrackMenu(createPlayer({ getChild }));
        expect(getChild).not.toHaveBeenCalled();
    });

    it('detects the enabled track regardless of position', () => {
        const list = createTrackList([
            { label: 'A', enabled: false },
            { label: 'B', enabled: true },
        ]);
        const tracks = readVjsAudioTracks(
            createPlayer({ audioTracks: () => list })
        );
        expect(tracks.map((track) => track.selected)).toEqual([false, true]);
    });

    it('select is a no-op without a track list', () => {
        expect(() =>
            selectVjsAudioTrack(createPlayer(), 0)
        ).not.toThrow();
    });

    it('disables every track when the selected id does not exist', () => {
        const list = createTrackList([
            { enabled: true },
            { enabled: false },
        ]);
        selectVjsAudioTrack(createPlayer({ audioTracks: () => list }), 5);

        expect((list as Record<number, { enabled: boolean }>)[0].enabled).toBe(
            false
        );
        expect((list as Record<number, { enabled: boolean }>)[1].enabled).toBe(
            false
        );
    });

    it('does not build a control-bar menu for an empty track list', () => {
        const getChild = jest.fn();
        setupVjsAudioTrackMenu(
            createPlayer({ audioTracks: () => createTrackList([]), getChild })
        );
        expect(getChild).not.toHaveBeenCalled();
    });

    describe('logVjsAudioTracks', () => {
        it('handles a missing track list', () => {
            expect(() => logVjsAudioTracks(createPlayer())).not.toThrow();
        });

        it('reads HLS media groups from the main playlist', () => {
            const tech = {
                vhs: {
                    playlists: {
                        main: { mediaGroups: { AUDIO: { grp: {} } } },
                    },
                },
            };
            const player = createPlayer({
                audioTracks: () =>
                    createTrackList([{ label: 'A', enabled: true }]),
                tech: jest.fn(() => tech),
            });
            expect(() => logVjsAudioTracks(player)).not.toThrow();
            expect(player.tech).toHaveBeenCalledWith({
                IWillNotUseThisInPlugins: true,
            });
        });

        it('falls back to the legacy master playlist media groups', () => {
            const tech = {
                vhs: {
                    playlists: {
                        master: { mediaGroups: { AUDIO: { grp: {} } } },
                    },
                },
            };
            const player = createPlayer({
                audioTracks: () =>
                    createTrackList([{ label: 'A', enabled: true }]),
                tech: () => tech,
            });
            expect(() => logVjsAudioTracks(player)).not.toThrow();
        });

        it('handles a tech without media groups and a non-callable tech', () => {
            const noGroups = createPlayer({
                audioTracks: () =>
                    createTrackList([{ label: 'A', enabled: true }]),
                tech: () => ({}),
            });
            expect(() => logVjsAudioTracks(noGroups)).not.toThrow();

            const noTech = createPlayer({
                audioTracks: () =>
                    createTrackList([{ label: 'A', enabled: true }]),
                tech: undefined as unknown as VjsAudioTrackPlayer['tech'],
            });
            expect(() => logVjsAudioTracks(noTech)).not.toThrow();
        });
    });
});
