import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject } from 'rxjs';
import { SourceStatusService } from '@iptvnator/portal/shared/data-access';
import {
    PlaylistContextFacade,
    PlaylistRecentHistoryService,
} from '@iptvnator/playlist/shared/util';
import {
    SortBy,
    SortOptions,
    SortOrder,
    SortService,
} from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { PlaylistRefreshActionService } from '../playlist-refresh-action.service';
import { SourceRemovalService } from '../source-removal/source-removal.service';
import { PlaylistSwitcherPanelComponent } from './playlist-switcher-panel.component';

const source = (id: string, fields: Partial<PlaylistMeta> = {}) =>
    ({
        _id: id,
        title: id,
        count: 0,
        importDate: '2026-01-01T00:00:00.000Z',
        autoRefresh: false,
        ...fields,
    }) as PlaylistMeta;

const ALPHA = source('alpha', { url: 'https://alpha.example/list.m3u' });
const BRAVO = source('bravo', {
    serverUrl: 'http://bravo.example',
    username: 'u',
    password: 'secret-pass',
});
const CHARLIE = source('charlie', {
    macAddress: '00:1A:79:00:00:01',
    portalUrl: 'http://charlie.example/c/',
});

describe('PlaylistSwitcherPanelComponent', () => {
    let fixture: ComponentFixture<PlaylistSwitcherPanelComponent>;
    let component: PlaylistSwitcherPanelComponent;
    let playlists: ReturnType<typeof signal<PlaylistMeta[]>>;
    let pending: ReturnType<typeof signal<ReadonlySet<string>>>;
    let deleting: ReturnType<typeof signal<ReadonlySet<string>>>;
    let selectPlaylist: jest.Mock;
    let remove: jest.Mock;
    let navigate: jest.Mock;

    const input = () =>
        (fixture.nativeElement as HTMLElement).querySelector(
            '.switcher__search input'
        ) as HTMLInputElement;
    const press = (key: string, init: KeyboardEventInit = {}) => {
        input().dispatchEvent(
            new KeyboardEvent('keydown', { key, bubbles: true, ...init })
        );
        fixture.detectChanges();
    };
    const type = (value: string) => {
        input().value = value;
        input().dispatchEvent(new Event('input'));
        fixture.detectChanges();
    };
    const optionIds = () =>
        Array.from(
            (fixture.nativeElement as HTMLElement).querySelectorAll(
                '[role="option"]'
            )
        ).map((option) => option.id);

    beforeEach(() => {
        localStorage.clear();
        playlists = signal([ALPHA, BRAVO, CHARLIE]);
        pending = signal<ReadonlySet<string>>(new Set());
        deleting = signal<ReadonlySet<string>>(new Set());
        selectPlaylist = jest.fn();
        remove = jest.fn();
        navigate = jest.fn();
        TestBed.configureTestingModule({
            imports: [
                PlaylistSwitcherPanelComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: PlaylistContextFacade,
                    useValue: {
                        playlists,
                        resolvedPlaylistId: signal('bravo'),
                        selectPlaylist,
                    },
                },
                {
                    provide: PlaylistRecentHistoryService,
                    useValue: { ids: signal(['charlie']) },
                },
                {
                    provide: SortService,
                    useValue: {
                        getSortOptions: () =>
                            new BehaviorSubject<SortOptions>({
                                by: SortBy.NAME,
                                order: SortOrder.ASC,
                            }),
                        sortPlaylists: new SortService().sortPlaylists,
                    },
                },
                {
                    provide: SourceStatusService,
                    useValue: {
                        statusOf: () => null,
                        tracks: () => false,
                        ensureChecked: jest.fn(),
                        recheck: jest.fn(),
                    },
                },
                {
                    provide: SourceRemovalService,
                    useValue: {
                        pendingIds: pending,
                        remove,
                        progress: {
                            isDeleting: (id: string) => deleting().has(id),
                        },
                    },
                },
                {
                    provide: PlaylistRefreshActionService,
                    useValue: { canRefresh: () => true, refresh: jest.fn() },
                },
                { provide: MatDialog, useValue: { open: jest.fn() } },
                { provide: Router, useValue: { navigate } },
            ],
        });
        fixture = TestBed.createComponent(PlaylistSwitcherPanelComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('lists every source in the Sources order as listbox options', () => {
        expect(optionIds()).toEqual([
            'playlist-switcher-all-alpha',
            'playlist-switcher-all-bravo',
            'playlist-switcher-all-charlie',
        ]);
        const current = (fixture.nativeElement as HTMLElement).querySelector(
            '#playlist-switcher-all-bravo'
        );
        expect(current?.getAttribute('aria-current')).toBe('true');
        expect(
            (fixture.nativeElement as HTMLElement).textContent
        ).not.toContain('secret-pass');
    });

    it('shows Recent above All once the list is long enough', () => {
        playlists.set([
            ALPHA,
            BRAVO,
            CHARLIE,
            source('d'),
            source('e'),
            source('f'),
        ]);
        fixture.detectChanges();
        expect(optionIds()[0]).toBe('playlist-switcher-recent-charlie');
        expect(optionIds()).toHaveLength(7);
    });

    it('moves the highlight with the arrow keys, wrapping, and opens it on Enter', () => {
        press('ArrowDown');
        expect(input().getAttribute('aria-activedescendant')).toBe(
            'playlist-switcher-all-alpha'
        );
        press('ArrowUp');
        expect(input().getAttribute('aria-activedescendant')).toBe(
            'playlist-switcher-all-charlie'
        );
        press('ArrowDown');
        expect(input().getAttribute('aria-activedescendant')).toBe(
            'playlist-switcher-all-alpha'
        );

        const closed = jest.fn();
        component.closeRequested.subscribe(closed);
        press('Enter');
        expect(selectPlaylist).toHaveBeenCalledWith(ALPHA);
        expect(closed).toHaveBeenCalled();
    });

    it('scrolls a new search back to its first match at the top', () => {
        const list = (fixture.nativeElement as HTMLElement).querySelector(
            '.switcher__list'
        ) as HTMLElement;
        list.scrollTop = 120;
        type('a');
        expect(list.scrollTop).toBe(0);

        list.scrollTop = 120;
        component.setType('xtream');
        expect(list.scrollTop).toBe(0);
    });

    it('moves through options whose IDs a selector would misread', () => {
        const restored = { ...ALPHA, _id: 'odd:id.one', title: 'Aardvark' };
        playlists.set([restored, BRAVO]);
        fixture.detectChanges();
        expect(() => press('ArrowDown')).not.toThrow();
        expect(input().getAttribute('aria-activedescendant')).toBe(
            'playlist-switcher-all-odd:id.one'
        );
    });

    it('filters by name or host as you type and highlights the first match', () => {
        type('charlie.example');
        expect(optionIds()).toEqual(['playlist-switcher-all-charlie']);
        expect(input().getAttribute('aria-activedescendant')).toBe(
            'playlist-switcher-all-charlie'
        );

        type('nothing like it');
        expect(optionIds()).toEqual([]);
        expect(
            (fixture.nativeElement as HTMLElement).querySelector(
                '.switcher__empty'
            )?.textContent
        ).toContain('WORKSPACE.SWITCHER.NO_MATCHES');
    });

    it('filters by type with one segment and remembers it', () => {
        component.setType('xtream');
        fixture.detectChanges();
        expect(optionIds()).toEqual(['playlist-switcher-all-bravo']);
        expect(localStorage.getItem('playlist-switcher:type:v2')).toBe(
            'xtream'
        );
    });

    it('closes on Escape', () => {
        const closed = jest.fn();
        component.closeRequested.subscribe(closed);
        press('Escape');
        expect(closed).toHaveBeenCalled();
    });

    it('closes before a delete, so Undo can take the focus and give it back to the trigger', () => {
        const trigger = document.createElement('button');
        document.body.appendChild(trigger);
        // The host closes the popover and focuses its trigger.
        component.closeRequested.subscribe(() => trigger.focus());

        component.remove(BRAVO);
        expect(remove).toHaveBeenCalledWith(BRAVO, CHARLIE, {
            returnFocusTo: trigger,
        });
        trigger.remove();
    });

    it('leaves out a source whose delete is pending or running', () => {
        pending.set(new Set(['bravo']));
        fixture.detectChanges();
        expect(optionIds()).not.toContain('playlist-switcher-all-bravo');

        pending.set(new Set());
        deleting.set(new Set(['alpha']));
        fixture.detectChanges();
        expect(optionIds()).toEqual([
            'playlist-switcher-all-bravo',
            'playlist-switcher-all-charlie',
        ]);
    });

    it('keeps the highlight on its option, or in range, when the list changes', () => {
        press('ArrowUp');
        expect(input().getAttribute('aria-activedescendant')).toBe(
            'playlist-switcher-all-charlie'
        );
        // An earlier option leaves: the highlight follows charlie.
        playlists.set([BRAVO, CHARLIE]);
        fixture.detectChanges();
        expect(input().getAttribute('aria-activedescendant')).toBe(
            'playlist-switcher-all-charlie'
        );
        // The highlighted last option leaves: Enter opens the new last one.
        playlists.set([BRAVO]);
        fixture.detectChanges();
        expect(input().getAttribute('aria-activedescendant')).toBe(
            'playlist-switcher-all-bravo'
        );
        press('Enter');
        expect(selectPlaylist).toHaveBeenCalledWith(BRAVO);
    });

    it('goes to the Sources page from the footer', () => {
        (
            (fixture.nativeElement as HTMLElement).querySelector(
                '.switcher__all'
            ) as HTMLButtonElement
        ).click();
        expect(navigate).toHaveBeenCalledWith(['/workspace', 'sources']);
    });
});
