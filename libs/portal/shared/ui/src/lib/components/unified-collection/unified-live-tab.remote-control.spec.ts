import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import {
    PORTAL_PLAYER,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import {
    StreamResolverService,
    UnifiedRecentDataService,
} from '@iptvnator/portal/shared/data-access';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import { UnifiedLiveTabComponent } from './unified-live-tab.component';

/**
 * Focused spec for the remote-control integration of the unified live tab —
 * the surface behind portal favorites/recent and the global collections.
 * Kept separate from the main layout spec, which sits at the max-lines
 * test budget.
 */
describe('UnifiedLiveTabComponent remote control', () => {
    let fixture: ComponentFixture<UnifiedLiveTabComponent>;
    let component: UnifiedLiveTabComponent;
    let channelChangeCallback:
        | ((data: { direction: 'up' | 'down' }) => void)
        | undefined;
    let remoteCommandCallback:
        | ((command: { type: string; number?: number }) => void)
        | undefined;
    let unsubscribeChannelChange: jest.Mock;
    let unsubscribeCommand: jest.Mock;
    let updateRemoteControlStatus: jest.Mock;
    let streamResolver: {
        resolveLiveDetail: jest.Mock;
        resolveM3uPlaybackDetail: jest.Mock;
        loadEpgForItems: jest.Mock;
    };
    let portalPlayer: {
        isEmbeddedPlayer: jest.Mock;
        openResolvedPlayback: jest.Mock;
        openExternalPlayback: jest.Mock;
    };
    let openStreamOnDoubleClick: ReturnType<typeof signal<boolean>>;
    let supportsRemoteControl: boolean;
    const originalElectron = window.electron;

    const configure = async () => {
        await TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot(), UnifiedLiveTabComponent],
            providers: [
                { provide: StreamResolverService, useValue: streamResolver },
                {
                    provide: UnifiedRecentDataService,
                    useValue: {
                        recordLivePlayback: jest
                            .fn()
                            .mockImplementation(async (item) => item),
                    },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        supportsEpg: false,
                        get supportsRemoteControl() {
                            return supportsRemoteControl;
                        },
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        openStreamOnDoubleClick,
                        player: signal(VideoPlayer.VideoJs),
                        stripCountryPrefix: signal(false),
                        resolvedEpgViewMode: signal('timeline'),
                        resolvedEpgOffsetMinutes: signal(0),
                    },
                },
                { provide: PORTAL_PLAYER, useValue: portalPlayer },
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
            ],
        })
            .overrideComponent(UnifiedLiveTabComponent, {
                set: { template: '' },
            })
            .compileComponents();

        fixture = TestBed.createComponent(UnifiedLiveTabComponent);
        component = fixture.componentInstance;
    };

    beforeEach(() => {
        supportsRemoteControl = true;
        channelChangeCallback = undefined;
        remoteCommandCallback = undefined;
        unsubscribeChannelChange = jest.fn();
        unsubscribeCommand = jest.fn();
        updateRemoteControlStatus = jest.fn();
        window.electron = {
            onChannelChange: jest.fn(
                (callback: (data: { direction: 'up' | 'down' }) => void) => {
                    channelChangeCallback = callback;
                    return unsubscribeChannelChange;
                }
            ),
            onRemoteControlCommand: jest.fn(
                (
                    callback: (command: {
                        type: string;
                        number?: number;
                    }) => void
                ) => {
                    remoteCommandCallback = callback;
                    return unsubscribeCommand;
                }
            ),
            updateRemoteControlStatus,
        } as unknown as typeof window.electron;

        openStreamOnDoubleClick = signal(false);
        streamResolver = {
            resolveLiveDetail: jest.fn().mockImplementation(async () => ({
                epgMode: 'portal',
                playback: {
                    streamUrl: 'https://example.com/live.m3u8',
                    title: 'Live',
                },
                epgItems: [],
            })),
            resolveM3uPlaybackDetail: jest
                .fn()
                .mockImplementation(async () => ({
                    epgMode: 'm3u',
                    playback: {
                        streamUrl: 'https://example.com/m3u.m3u8',
                        title: 'M3U Live',
                    },
                    channel: null,
                    epgPrograms: [],
                })),
            loadEpgForItems: jest.fn().mockResolvedValue(new Map()),
        };
        portalPlayer = {
            isEmbeddedPlayer: jest.fn().mockReturnValue(false),
            openResolvedPlayback: jest.fn(),
            openExternalPlayback: jest.fn(),
        };
    });

    afterEach(() => {
        fixture?.destroy();
        window.electron = originalElectron;
    });

    const setItems = async (
        items: UnifiedCollectionItem[],
        mode: 'favorites' | 'recent' = 'favorites'
    ) => {
        fixture.componentRef.setInput('items', items);
        fixture.componentRef.setInput('mode', mode);
        fixture.componentRef.setInput('sortMode', 'name-asc');
        fixture.detectChanges();
        await fixture.whenStable();
    };

    const activate = async (uid: string) => {
        const channel = component
            .channelsForList()
            .find((candidate) => candidate.uid === uid);
        if (!channel) {
            throw new Error(`No channel with uid ${uid}`);
        }
        await component.onChannelSelected(channel);
        fixture.detectChanges();
        await fixture.whenStable();
    };

    it('does not subscribe when the runtime reports no remote-control support', async () => {
        supportsRemoteControl = false;
        await configure();
        fixture.componentRef.setInput('items', []);
        fixture.detectChanges();

        expect(window.electron?.onChannelChange).not.toHaveBeenCalled();
        expect(window.electron?.onRemoteControlCommand).not.toHaveBeenCalled();
    });

    it('navigates channel down through the sorted visible list and starts playback', async () => {
        // Double-click-to-play would normally leave playback to a second
        // click; a remote action must start it explicitly regardless.
        openStreamOnDoubleClick.set(true);
        await configure();
        await setItems([
            buildItem('xtream::pl-1::2', 'Bravo'),
            buildItem('xtream::pl-1::1', 'Alpha'),
            buildItem('xtream::pl-1::3', 'Charlie'),
        ]);
        await activate('xtream::pl-1::1');
        portalPlayer.openResolvedPlayback.mockClear();

        channelChangeCallback?.({ direction: 'down' });
        fixture.detectChanges();
        await fixture.whenStable();

        // name-asc order is Alpha, Bravo, Charlie — down from Alpha is Bravo.
        expect(component.activeUid()).toBe('xtream::pl-1::2');
        expect(portalPlayer.openResolvedPlayback).toHaveBeenCalledTimes(1);
    });

    it('wraps upward from the first visible channel to the last', async () => {
        await configure();
        await setItems([
            buildItem('xtream::pl-1::2', 'Bravo'),
            buildItem('xtream::pl-1::1', 'Alpha'),
            buildItem('xtream::pl-1::3', 'Charlie'),
        ]);
        await activate('xtream::pl-1::1');

        channelChangeCallback?.({ direction: 'up' });
        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.activeUid()).toBe('xtream::pl-1::3');
    });

    it('ignores channel change while nothing is selected', async () => {
        await configure();
        await setItems([buildItem('xtream::pl-1::1', 'Alpha')]);

        channelChangeCallback?.({ direction: 'down' });
        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.activeUid()).toBeNull();
        expect(streamResolver.resolveLiveDetail).not.toHaveBeenCalled();
    });

    it('selects a channel by its 1-based number in the visible list', async () => {
        await configure();
        await setItems([
            buildItem('xtream::pl-1::2', 'Bravo'),
            buildItem('xtream::pl-1::1', 'Alpha'),
            buildItem('xtream::pl-1::3', 'Charlie'),
        ]);

        remoteCommandCallback?.({ type: 'channel-select-number', number: 3 });
        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.activeUid()).toBe('xtream::pl-1::3');
    });

    it('follows the search-filtered list for navigation and numbering', async () => {
        await configure();
        await setItems([
            buildItem('xtream::pl-1::2', 'News Two'),
            buildItem('xtream::pl-1::1', 'Music One'),
            buildItem('xtream::pl-1::3', 'News One'),
        ]);
        fixture.componentRef.setInput('searchTerm', 'news');
        fixture.detectChanges();

        // Visible list is News One, News Two — number 1 is News One.
        remoteCommandCallback?.({ type: 'channel-select-number', number: 1 });
        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.activeUid()).toBe('xtream::pl-1::3');
    });

    it('publishes the active source portal and visible channel number', async () => {
        await configure();
        await setItems([
            buildItem('stalker::pl-9::2', 'Bravo', 'stalker'),
            buildItem('stalker::pl-9::1', 'Alpha', 'stalker'),
        ]);
        await activate('stalker::pl-9::2');

        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith({
            portal: 'stalker',
            isLiveView: true,
            channelName: 'Bravo',
            channelNumber: 2,
            epgTitle: undefined,
            epgStart: undefined,
            epgEnd: undefined,
            supportsVolume: false,
        });
    });

    it('publishes a reset snapshot while nothing is playing and on destroy', async () => {
        await configure();
        await setItems([buildItem('xtream::pl-1::1', 'Alpha')]);

        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith({
            portal: 'unknown',
            isLiveView: false,
            supportsVolume: false,
        });

        await activate('xtream::pl-1::1');
        updateRemoteControlStatus.mockClear();

        fixture.destroy();

        expect(unsubscribeChannelChange).toHaveBeenCalledTimes(1);
        expect(unsubscribeCommand).toHaveBeenCalledTimes(1);
        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith({
            portal: 'unknown',
            isLiveView: false,
            supportsVolume: false,
        });
    });
});

function buildItem(
    uid: string,
    name: string,
    sourceType: 'm3u' | 'xtream' | 'stalker' = 'xtream'
): UnifiedCollectionItem {
    const sourceItemId = uid.split('::')[2];
    return {
        uid,
        name,
        contentType: 'live',
        sourceType,
        playlistId: uid.split('::')[1],
        playlistName: 'Playlist',
        logo: null,
        posterUrl: null,
        addedAt: '2026-04-30T12:00:00.000Z',
        position: 0,
        ...(sourceType === 'xtream'
            ? { xtreamId: Number(sourceItemId) }
            : sourceType === 'stalker'
              ? { stalkerId: sourceItemId, stalkerCmd: `ffmpeg http://s/${sourceItemId}` }
              : { streamUrl: `https://example.com/${sourceItemId}.m3u8` }),
    } as UnifiedCollectionItem;
}
