import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { PlaybackHistoryGate } from '@iptvnator/playback/data-access';
import {
    MultiviewAnchorRegistry,
    MultiviewSessionStore,
} from '@iptvnator/playback/multiview/data-access';
import { UnifiedRecentDataService } from '@iptvnator/portal/shared/data-access';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import { of } from 'rxjs';
import { liveItem, tile } from './multiview-picker.fixtures';
import { MultiviewPickerLauncher } from './multiview-picker-launcher.service';

describe('MultiviewPickerLauncher', () => {
    const open = jest.fn();
    const defer = jest.fn();
    const recordLivePlayback = jest.fn();
    let tiles: ReturnType<typeof tile>[] = [];
    const anchorSource = signal<unknown>(null);

    beforeEach(() => {
        jest.resetAllMocks();
        tiles = [];
        recordLivePlayback.mockResolvedValue(undefined);
        TestBed.configureTestingModule({
            providers: [
                { provide: MatDialog, useValue: { open } },
                { provide: PlaybackHistoryGate, useValue: { defer } },
                {
                    provide: UnifiedRecentDataService,
                    useValue: { recordLivePlayback },
                },
                {
                    provide: MultiviewSessionStore,
                    useValue: {
                        tiles: () => tiles,
                        tile: (id: string) => tiles.find((t) => t.id === id),
                        tileNumber: (id: string) =>
                            tiles.findIndex((t) => t.id === id) + 1,
                    },
                },
                {
                    provide: MultiviewAnchorRegistry,
                    useValue: {
                        current: () => ({
                            host: {
                                anchorId: 'xtream-live',
                                source: anchorSource,
                                engine: signal(VideoPlayer.VideoJs),
                            },
                        }),
                    },
                },
            ],
        });
    });

    const launcher = () => TestBed.inject(MultiviewPickerLauncher);

    it('describes the view playback before a session starts', () => {
        anchorSource.set({
            title: 'Synthetic Film',
            kind: 'vod',
            playlistId: 'playlist-1',
        });

        expect(launcher().contextFor({ context: 'add' })).toEqual({
            request: { context: 'add' },
            mainTitle: 'Synthetic Film',
            mainKind: 'vod',
            playlistId: 'playlist-1',
            replaceNumber: null,
            replaceTitle: null,
        });
    });

    it('names the tile a replace picker replaces', () => {
        tiles = [
            tile({ id: 'multiview-tile-1', title: 'Main' }),
            tile({ id: 'multiview-tile-2', title: 'Synthetic News' }),
        ];

        expect(
            launcher().contextFor({
                context: 'replace',
                tileId: 'multiview-tile-2',
            })
        ).toMatchObject({
            mainTitle: 'Main',
            replaceNumber: 2,
            replaceTitle: 'Synthetic News',
        });
    });

    it('opens the 820 px dialog and returns the picked source', async () => {
        const source = {
            playback: {
                streamUrl: 'https://stream.example/3.m3u8',
                title: 's',
            },
            playbackSessionKey: 'key-3',
        };
        open.mockReturnValue({
            afterClosed: () => of({ source, item: liveItem(3) }),
        });

        await expect(launcher().pick({ context: 'add' })).resolves.toBe(source);
        expect(open).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({ width: '820px' })
        );
    });

    it('records the picked item in history once its tile plays (R10)', async () => {
        open.mockReturnValue({
            afterClosed: () =>
                of({
                    source: {
                        playback: {
                            streamUrl: 'https://stream.example/3.m3u8',
                            title: 's',
                        },
                        playbackSessionKey: 'key-3',
                    },
                    item: liveItem(3),
                }),
        });

        await launcher().pick({ context: 'add' });

        expect(defer).toHaveBeenCalledWith(
            {
                sourceId: 'playlist-1',
                sessionKey: 'key-3',
                streamUrls: ['https://stream.example/3.m3u8'],
            },
            expect.any(Function)
        );
        expect(recordLivePlayback).not.toHaveBeenCalled();
        defer.mock.calls[0][1]();
        expect(recordLivePlayback).toHaveBeenCalledWith(liveItem(3));
    });

    it('returns nothing and records nothing when the viewer closes it', async () => {
        open.mockReturnValue({ afterClosed: () => of(undefined) });

        await expect(launcher().pick({ context: 'add' })).resolves.toBeNull();
        expect(defer).not.toHaveBeenCalled();
    });
});
