import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ChannelContextMenuComponent } from './channel-context-menu.component';

describe('ChannelContextMenuComponent', () => {
    let fixture: ComponentFixture<ChannelContextMenuComponent>;

    function render(inputs: Partial<Record<string, unknown>>) {
        TestBed.configureTestingModule({
            imports: [ChannelContextMenuComponent, TranslateModule.forRoot()],
        });
        fixture = TestBed.createComponent(ChannelContextMenuComponent);
        for (const [name, value] of Object.entries(inputs)) {
            fixture.componentRef.setInput(name, value);
        }
        fixture.detectChanges();
        return fixture.componentInstance;
    }

    async function openAt(clientX: number, clientY: number) {
        fixture.componentInstance.open({ clientX, clientY });
        fixture.detectChanges();
        await Promise.resolve();
        fixture.detectChanges();
    }

    function panel(): HTMLElement | null {
        return document.querySelector(
            '.cdk-overlay-container .mat-mdc-menu-panel'
        );
    }

    /** Each row as "icon label"; Material projects the icon outside the label span. */
    function rowTexts(): string[] {
        return rows().map(
            (row) =>
                `${row.querySelector('mat-icon')?.textContent?.trim()} ${row
                    .querySelector('.mat-mdc-menu-item-text')
                    ?.textContent?.trim()}`
        );
    }

    function rows(): HTMLElement[] {
        return Array.from(
            document.querySelectorAll<HTMLElement>(
                '.cdk-overlay-container [mat-menu-item]'
            )
        );
    }

    afterEach(() => {
        fixture?.componentInstance.close();
        fixture?.detectChanges();
    });

    it('opens at the pointer with the rows in one order and Remove as a danger row after a divider', async () => {
        render({
            showMapEpg: true,
            showDetails: true,
            openInPlaylistName: 'Living room',
            showRemoveFromHistory: true,
        });

        await openAt(144, 188);

        const anchor = fixture.nativeElement.querySelector(
            '.channel-context-menu-anchor'
        ) as HTMLElement;
        expect(anchor.style.left).toBe('144px');
        expect(anchor.style.top).toBe('188px');
        expect(panel()).not.toBeNull();
        expect(rowTexts()).toEqual([
            'settings_remote CHANNELS.MAP_EPG',
            'info CHANNELS.SHOW_DETAILS',
            'open_in_new PORTALS.VIEW_IN_PORTAL_TOOLTIP',
            'delete WORKSPACE.DASHBOARD.REMOVE_FROM_HISTORY',
        ]);
        expect(rows()[2].dataset['testid']).toBe('channel-open-in-playlist');
        expect(rows()[3].classList).toContain('app-menu-item--danger');
        const divider = panel()?.querySelector('mat-divider');
        expect(divider?.nextElementSibling).toBe(rows()[3]);
    });

    it('renders only the rows the host asks for, without a divider before a lone Remove', async () => {
        render({ showRemoveFromHistory: true });

        await openAt(10, 20);

        expect(rowTexts()).toEqual([
            'delete WORKSPACE.DASHBOARD.REMOVE_FROM_HISTORY',
        ]);
        expect(panel()?.querySelector('mat-divider')).toBeNull();
    });

    it('offers the playlist row for a playlist saved without a name', async () => {
        render({ openInPlaylistName: '' });

        await openAt(10, 20);

        expect(rows()).toHaveLength(1);
        expect(rows()[0].dataset['testid']).toBe('channel-open-in-playlist');
    });

    it('moves an open menu to the new pointer position', async () => {
        render({ showDetails: true });
        await openAt(10, 20);

        await openAt(300, 400);

        const anchor = fixture.nativeElement.querySelector(
            '.channel-context-menu-anchor'
        ) as HTMLElement;
        expect(anchor.style.left).toBe('300px');
        expect(anchor.style.top).toBe('400px');
        expect(panel()).not.toBeNull();
    });

    it('reports each row to the host', async () => {
        const menu = render({
            showMapEpg: true,
            showDetails: true,
            openInPlaylistName: 'Living room',
            showRemoveFromHistory: true,
        });
        const picked: string[] = [];
        menu.mapEpg.subscribe(() => picked.push('map-epg'));
        menu.details.subscribe(() => picked.push('details'));
        menu.openInPlaylist.subscribe(() => picked.push('open-in-playlist'));
        menu.removeFromHistory.subscribe(() => picked.push('remove'));

        for (let index = 0; index < 4; index++) {
            await openAt(10, 20);
            rows()[index].click();
            fixture.detectChanges();
        }

        expect(picked).toEqual([
            'map-epg',
            'details',
            'open-in-playlist',
            'remove',
        ]);
    });
});
