import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { ChannelDetailsDialogComponent } from '@iptvnator/ui/components';
import { UnifiedFavoriteChannel } from '@iptvnator/portal/shared/util';
import { Channel } from '@iptvnator/shared/interfaces';
import { SettingsStore } from '@iptvnator/services';
import { GlobalFavoritesListComponent } from './global-favorites-list.component';

describe('GlobalFavoritesListComponent', () => {
    let fixture: ComponentFixture<GlobalFavoritesListComponent>;
    let dialog: { open: jest.Mock };

    beforeEach(async () => {
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
                    },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(GlobalFavoritesListComponent);
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
        fixture.componentRef.setInput(
            'favoriteUids',
            new Set<string>(['b'])
        );
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
            .spyOn(fixture.componentInstance.contextMenuTrigger(), 'openMenu')
            .mockImplementation();

        fixture.componentInstance.onChannelContextMenu(
            fixture.componentInstance.enrichedChannels()[0],
            {
                clientX: 24,
                clientY: 32,
            } as MouseEvent
        );
        await Promise.resolve();

        expect(fixture.componentInstance.contextMenuPosition()).toEqual({
            x: '24px',
            y: '32px',
        });
        expect(openMenuSpy).toHaveBeenCalled();

        fixture.componentInstance.openChannelDetails();

        expect(dialog.open).toHaveBeenCalledWith(
            ChannelDetailsDialogComponent,
            expect.objectContaining({
                data: channel,
                maxWidth: '720px',
                width: 'calc(100vw - 32px)',
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
            fixture.componentInstance.contextMenuTrigger(),
            'openMenu'
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
            fixture.componentInstance.contextMenuTrigger(),
            'openMenu'
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
