import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { ChannelDetailsDialogComponent } from '@iptvnator/ui/components';
import { UnifiedFavoriteChannel } from '@iptvnator/portal/shared/util';
import { Channel, EpgProgram } from '@iptvnator/shared/interfaces';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import { GlobalFavoritesListComponent } from './global-favorites-list.component';

describe('GlobalFavoritesListComponent', () => {
    let fixture: ComponentFixture<GlobalFavoritesListComponent>;
    let dialog: { open: jest.Mock };
    let runtime: {
        supportsEpg: boolean;
        supportsProviderEpg: boolean;
        supportsEpgMapping: boolean;
    };

    /** The rendered row whose channel name is `name`. */
    function rowNamed(name: string): HTMLElement {
        const rows = Array.from(
            fixture.nativeElement.querySelectorAll(
                '.channel-list-item'
            ) as NodeListOf<HTMLElement>
        );
        const row = rows.find(
            (element) =>
                element.querySelector('.channel-name')?.textContent?.trim() ===
                name
        );
        if (!row) {
            throw new Error(`No row named ${name}`);
        }
        return row;
    }

    beforeEach(async () => {
        runtime = {
            supportsEpg: false,
            supportsProviderEpg: true,
            supportsEpgMapping: false,
        };
        dialog = {
            open: jest.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [
                GlobalFavoritesListComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: MatDialog,
                    useValue: dialog,
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        openStreamOnDoubleClick: signal(false),
                        resolvedEpgOffsetMinutes: signal(0),
                    },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: runtime,
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(GlobalFavoritesListComponent);
    });

    it.each(['favorites', 'recent'])(
        'reads %s portal programmes only from their own playlist and source',
        (mode) => {
            fixture.componentRef.setInput('mode', mode);
            const channels = [
                buildChannel('a', 'First', {
                    sourceType: 'xtream',
                    playlistId: 'one',
                    xtreamId: 7,
                    tvgId: 'same',
                }),
                buildChannel('b', 'Second', {
                    sourceType: 'xtream',
                    playlistId: 'two',
                    xtreamId: 7,
                    tvgId: 'same',
                }),
                buildChannel('c', 'Third', {
                    sourceType: 'stalker',
                    playlistId: 'one',
                    stalkerId: 7,
                    tvgId: 'same',
                }),
            ];
            fixture.componentRef.setInput('channels', channels);
            fixture.componentRef.setInput(
                'epgMap',
                new Map([
                    [
                        JSON.stringify(['xtream', 'one', '7']),
                        airingProgram('First show'),
                    ],
                    [
                        JSON.stringify(['xtream', 'two', '7']),
                        airingProgram('Second show'),
                    ],
                    [
                        JSON.stringify(['stalker', 'one', '7']),
                        airingProgram('Third show'),
                    ],
                    ['same', airingProgram('Wrong show')],
                ])
            );
            fixture.detectChanges();
            expect(
                rowNamed('First').querySelector('.epg-title')?.textContent
            ).toContain('First show');
            expect(
                rowNamed('Second').querySelector('.epg-title')?.textContent
            ).toContain('Second show');
            expect(
                rowNamed('Third').querySelector('.epg-title')?.textContent
            ).toContain('Third show');
        }
    );

    it('keeps only history removal in the context menu of an unavailable live Recent row', async () => {
        const item = buildChannel('gone', 'Gone channel', {
            sourceType: 'xtream',
            xtreamId: 42,
            catalogStatus: 'missing',
        });
        fixture.componentRef.setInput('mode', 'recent');
        fixture.componentRef.setInput('channels', [item]);
        Object.defineProperty(fixture.componentInstance, 'supportsEpgMapping', {
            value: true,
        });
        fixture.detectChanges();
        expect(fixture.componentInstance.hasChannelContextMenu(item)).toBe(
            true
        );
        const remove = jest.spyOn(
            fixture.componentInstance.removeRequested,
            'emit'
        );
        const row = fixture.nativeElement.querySelector(
            'app-channel-list-item .channel-list-item'
        ) as HTMLElement | null;
        if (!row) throw new Error('Expected live Recent row');
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
        await Promise.resolve();
        fixture.detectChanges();
        const actions =
            document.querySelectorAll<HTMLElement>('[role="menuitem"]');
        expect(actions).toHaveLength(1);
        expect(actions[0].textContent).toContain(
            'WORKSPACE.DASHBOARD.REMOVE_FROM_HISTORY'
        );
        actions[0].click();
        expect(remove).toHaveBeenCalledWith(
            expect.objectContaining({ uid: item.uid })
        );
    });

    it('renders filled favorite stars in favorites mode', () => {
        fixture.componentRef.setInput('channels', [buildChannel('b', 'Beta')]);
        fixture.detectChanges();

        const favoriteIcon = fixture.nativeElement.querySelector(
            '.favorite-button mat-icon'
        );

        expect(favoriteIcon?.textContent?.trim()).toBe('star');
        expect(
            fixture.nativeElement.querySelectorAll('.favorite-button')
        ).toHaveLength(1);
    });

    it('renders favorite state from the supplied favorite ids in recent mode', () => {
        fixture.componentRef.setInput('mode', 'recent');
        fixture.componentRef.setInput('favoriteUids', new Set<string>(['b']));
        fixture.componentRef.setInput('channels', [
            buildChannel('a', 'Alpha'),
            buildChannel('b', 'Beta'),
        ]);
        fixture.detectChanges();

        const icons = Array.from(
            fixture.nativeElement.querySelectorAll('.favorite-button mat-icon'),
            (element: Element) => element.textContent?.trim()
        );

        expect(icons).toEqual(['star_outline', 'star']);
    });

    it('shows the catch-up badge on Xtream rows with a playable archive', () => {
        fixture.componentRef.setInput('channels', [
            buildChannel('x1', 'Archive Channel', {
                sourceType: 'xtream',
                xtreamId: 42,
                tvArchive: 1,
                tvArchiveDuration: 7,
            }),
            buildChannel('x2', 'Plain Channel', {
                sourceType: 'xtream',
                xtreamId: 43,
                tvArchive: 0,
                tvArchiveDuration: 0,
            }),
            buildChannel('m1', 'M3U Channel'),
        ]);
        fixture.detectChanges();

        const badges = fixture.nativeElement.querySelectorAll(
            '[data-test-id="catchup-badge"]'
        );
        expect(badges).toHaveLength(1);

        const badgeRow = badges[0].closest('[data-test-id="channel-item"]');
        expect(badgeRow?.textContent).toContain('Archive Channel');
    });

    it('renders radio rows as compact without a false EPG placeholder', () => {
        fixture.componentRef.setInput('channels', [
            buildChannel('radio', 'Radio One', { radio: 'true' }),
        ]);
        fixture.detectChanges();

        const row = fixture.nativeElement.querySelector('.channel-list-item');
        expect(row.classList.contains('compact')).toBe(true);
        expect(
            fixture.nativeElement.querySelector('.epg-placeholder')
        ).toBeNull();
    });

    it('renders non-radio rows as compact when the host disables EPG', () => {
        fixture.componentRef.setInput('showEpg', false);
        fixture.componentRef.setInput('channels', [
            buildChannel('pwa', 'PWA Channel'),
        ]);
        fixture.detectChanges();

        const row = fixture.nativeElement.querySelector('.channel-list-item');
        expect(row.classList.contains('compact')).toBe(true);
        expect(
            fixture.nativeElement.querySelector('.epg-placeholder')
        ).toBeNull();
    });

    it('gives Xtream and Stalker rows the provider programme line and keeps M3U rows compact without XMLTV', () => {
        fixture.componentRef.setInput('channels', [
            buildChannel('x', 'Xtream Live', {
                sourceType: 'xtream',
                xtreamId: 7,
                tvgId: '7',
            }),
            buildChannel('s', 'Stalker Live', {
                sourceType: 'stalker',
                stalkerId: '9',
                tvgId: '9',
            }),
            buildChannel('m', 'M3U Live'),
        ]);
        fixture.componentRef.setInput(
            'epgMap',
            new Map([
                [
                    JSON.stringify(['xtream', 'playlist-1', '7']),
                    airingProgram('Xtream Show'),
                ],
                [
                    JSON.stringify(['stalker', 'playlist-1', '9']),
                    airingProgram('Stalker Show'),
                ],
            ])
        );
        fixture.detectChanges();

        expect(
            rowNamed('Xtream Live').querySelector('.epg-title')?.textContent
        ).toContain('Xtream Show');
        expect(
            rowNamed('Stalker Live').querySelector('.epg-title')?.textContent
        ).toContain('Stalker Show');
        expect(rowNamed('M3U Live').classList.contains('compact')).toBe(true);
    });

    it('gives M3U rows their programme line when XMLTV is available', () => {
        runtime.supportsEpg = true;
        fixture.destroy();
        fixture = TestBed.createComponent(GlobalFavoritesListComponent);
        fixture.componentRef.setInput('channels', [
            buildChannel('m', 'M3U Live', { tvgId: 'm3u.tv' }),
        ]);
        fixture.componentRef.setInput(
            'epgMap',
            new Map([['m3u.tv', airingProgram('M3U Show')]])
        );
        fixture.detectChanges();

        expect(
            rowNamed('M3U Live').querySelector('.epg-title')?.textContent
        ).toContain('M3U Show');
    });

    it('preserves incoming recent order when a favorites sort mode is set', () => {
        fixture.componentRef.setInput('mode', 'recent');
        fixture.componentRef.setInput('sortMode', 'name-asc');
        fixture.componentRef.setInput('channels', [
            buildChannel('z', 'Zulu'),
            buildChannel('a', 'Alpha'),
        ]);
        fixture.detectChanges();

        const names = Array.from(
            fixture.nativeElement.querySelectorAll('.channel-name'),
            (element: Element) => element.textContent?.trim()
        );

        expect(names).toEqual(['Zulu', 'Alpha']);
    });

    it('opens channel details for M3U rows with full channel metadata', async () => {
        const channel = buildM3uChannel('a', 'Alpha');
        const row = buildChannel('a', 'Alpha', {
            m3uChannel: channel,
        });
        fixture.componentRef.setInput('channels', [row]);
        fixture.detectChanges();

        const openMenuSpy = jest
            .spyOn(fixture.componentInstance.channelContextMenu(), 'open')
            .mockImplementation();

        fixture.componentInstance.onChannelContextMenu(
            fixture.componentInstance.enrichedChannels()[0],
            {
                clientX: 24,
                clientY: 32,
            } as MouseEvent
        );
        await Promise.resolve();

        expect(openMenuSpy).toHaveBeenCalledWith(
            expect.objectContaining({ clientX: 24, clientY: 32 })
        );

        fixture.componentInstance.openChannelDetails();

        expect(dialog.open).toHaveBeenCalledWith(
            ChannelDetailsDialogComponent,
            expect.objectContaining({
                data: channel,
                maxWidth: 'calc(100vw - 32px)',
                width: '760px',
            })
        );
    });

    it('emits recent row removal from the context menu', async () => {
        const row = buildChannel('a', 'Alpha');
        const removed = jest.fn();
        fixture.componentInstance.removeRequested.subscribe(removed);
        fixture.componentRef.setInput('mode', 'recent');
        fixture.componentRef.setInput('channels', [row]);
        fixture.detectChanges();

        jest.spyOn(
            fixture.componentInstance.channelContextMenu(),
            'open'
        ).mockImplementation();

        fixture.componentInstance.onChannelContextMenu(
            fixture.componentInstance.enrichedChannels()[0],
            {
                clientX: 24,
                clientY: 32,
            } as MouseEvent
        );
        await Promise.resolve();

        fixture.componentInstance.removeContextMenuChannel();

        expect(removed).toHaveBeenCalledWith(
            expect.objectContaining({
                uid: row.uid,
            })
        );
    });

    it('does not open channel details for non-M3U rows without full channel metadata', async () => {
        const row = {
            ...buildChannel('xtream-live', 'Xtream Live'),
            sourceType: 'xtream',
            streamUrl: undefined,
            xtreamId: 42,
        } satisfies UnifiedFavoriteChannel;
        fixture.componentRef.setInput('mode', 'recent');
        fixture.componentRef.setInput('channels', [row]);
        fixture.detectChanges();

        expect(fixture.componentInstance.hasChannelContextMenu(row)).toBe(true);

        jest.spyOn(
            fixture.componentInstance.channelContextMenu(),
            'open'
        ).mockImplementation();
        fixture.componentInstance.onChannelContextMenu(
            fixture.componentInstance.enrichedChannels()[0],
            {
                clientX: 24,
                clientY: 32,
            } as MouseEvent
        );
        await Promise.resolve();

        fixture.componentInstance.openChannelDetails();

        expect(dialog.open).not.toHaveBeenCalled();
    });
    it('offers "open in playlist" for rows whose playlist target resolves', async () => {
        const row = buildChannel('a', 'Alpha', {
            playlistName: 'http://user:secret@panel.example.com/get.php',
        });
        const requested = jest.fn();
        fixture.componentInstance.openInPlaylistRequested.subscribe(requested);
        fixture.componentRef.setInput('channels', [row]);
        fixture.detectChanges();

        expect(fixture.componentInstance.hasChannelContextMenu(row)).toBe(true);
        const closeMenu = jest
            .spyOn(fixture.componentInstance.channelContextMenu(), 'close')
            .mockImplementation();
        jest.spyOn(
            fixture.componentInstance.channelContextMenu(),
            'open'
        ).mockImplementation();

        fixture.componentInstance.onChannelContextMenu(
            fixture.componentInstance.enrichedChannels()[0],
            { clientX: 24, clientY: 32 } as MouseEvent
        );
        await Promise.resolve();

        expect(fixture.componentInstance.contextMenuCanOpenInPlaylist()).toBe(
            true
        );
        // Credential-bearing stored names collapse to the host.
        expect(fixture.componentInstance.contextMenuPlaylistName()).toBe(
            'panel.example.com'
        );

        fixture.componentInstance.openContextMenuChannelInPlaylist();

        expect(closeMenu).toHaveBeenCalled();
        expect(requested).toHaveBeenCalledWith(
            expect.objectContaining({ uid: row.uid })
        );
    });

    it('hides "open in playlist" for Stalker radio rows and never emits for them', async () => {
        const row = buildChannel('s', 'Stalker', {
            sourceType: 'stalker',
            streamUrl: undefined,
            stalkerId: '30',
            stalkerCmd: 'ffmpeg http://stalker/30',
            radio: 'true',
        });
        const requested = jest.fn();
        fixture.componentInstance.openInPlaylistRequested.subscribe(requested);
        fixture.componentRef.setInput('channels', [row]);
        fixture.detectChanges();

        expect(fixture.componentInstance.canOpenInPlaylist(row)).toBe(false);
        // Favorites mode, no EPG mapping support, no M3U metadata: nothing
        // else earns the row a context menu either.
        expect(fixture.componentInstance.hasChannelContextMenu(row)).toBe(
            false
        );

        fixture.componentInstance.contextMenuChannel.set(
            fixture.componentInstance.enrichedChannels()[0]
        );
        expect(fixture.componentInstance.contextMenuCanOpenInPlaylist()).toBe(
            false
        );
        fixture.componentInstance.openContextMenuChannelInPlaylist();
        expect(requested).not.toHaveBeenCalled();
    });
});

function buildChannel(
    uid: string,
    name: string,
    overrides: Partial<UnifiedFavoriteChannel> = {}
): UnifiedFavoriteChannel {
    return {
        uid,
        name,
        logo: null,
        sourceType: 'm3u',
        playlistId: 'playlist-1',
        playlistName: 'Playlist One',
        streamUrl: `https://example.com/${uid}.m3u8`,
        addedAt: '2026-04-30T12:00:00.000Z',
        position: 0,
        ...overrides,
    };
}

function buildM3uChannel(id: string, name: string): Channel {
    return {
        id,
        name,
        url: `https://example.com/${id}.m3u8`,
        group: { title: 'Live' },
        tvg: {
            id,
            name,
            url: '',
            logo: '',
            rec: '',
        },
        http: {
            referrer: '',
            'user-agent': '',
            origin: '',
        },
        radio: 'false',
        epgParams: '',
    };
}

function airingProgram(title: string): EpgProgram {
    const now = Date.now();
    return {
        start: new Date(now - 10 * 60_000).toISOString(),
        stop: new Date(now + 10 * 60_000).toISOString(),
        channel: 'test-channel',
        title,
        desc: null,
        category: null,
    };
}
