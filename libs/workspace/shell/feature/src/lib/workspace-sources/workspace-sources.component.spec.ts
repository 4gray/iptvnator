import { PORTAL_EXTERNAL_PLAYBACK } from '@iptvnator/portal/shared/util';
import { SourceActivityService } from '@iptvnator/services';
import { MatDialog } from '@angular/material/dialog';
import { PlaylistRefreshActionService } from '@iptvnator/playlist/shared/ui';
import {
    Component,
    input,
    output,
    signal,
    ChangeDetectionStrategy,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { provideMockStore } from '@ngrx/store/testing';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { selectAllPlaylistsMeta } from '@iptvnator/m3u-state';
import { SourceStatusService } from '@iptvnator/portal/shared/data-access';
import { SourceRemovalService } from '@iptvnator/playlist/shared/ui';
import { SourcesViewStateService } from '@iptvnator/playlist/shared/util';
import {
    RuntimeCapabilitiesService,
    SortBy,
    SortOrder,
    SortService,
} from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    MenuItemRadioCheckDirective,
    MenuItemRadioDirective,
} from '@iptvnator/ui/components';
import { WORKSPACE_SHELL_ACTIONS } from '@iptvnator/workspace/shell/util';
import { WorkspaceSourcesComponent } from './workspace-sources.component';

@Component({
    selector: 'app-recent-playlists',
    template: '',
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: true,
})
class MockRecentPlaylistsComponent {
    readonly searchQueryInput = input('');
    readonly addPlaylistClicked = output<void>();
}

const PLAYLISTS = [
    { _id: 'playlist-1', title: 'Playlist 1', url: 'https://a.example/1.m3u' },
    {
        _id: 'playlist-2',
        title: 'Playlist 2',
        serverUrl: 'http://x.example',
        username: 'u',
        password: 'p',
    },
] as PlaylistMeta[];

describe('WorkspaceSourcesComponent', () => {
    let fixture: ComponentFixture<WorkspaceSourcesComponent>;
    let setSortOptions: jest.Mock;

    beforeEach(async () => {
        localStorage.clear();
        setSortOptions = jest.fn();
        await TestBed.configureTestingModule({
            imports: [WorkspaceSourcesComponent, NoopAnimationsModule],
            providers: [
                {
                    provide: PORTAL_EXTERNAL_PLAYBACK,
                    useValue: { activeSession: signal(null) },
                },
                {
                    provide: MatDialog,
                    useValue: { getDialogById: jest.fn(), open: jest.fn() },
                },
                {
                    provide: PlaylistRefreshActionService,
                    useValue: { isSourceBusy: jest.fn((id) => id === 'busy') },
                },
                provideMockStore({
                    selectors: [
                        { selector: selectAllPlaylistsMeta, value: PLAYLISTS },
                    ],
                }),
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsSourceHealth: true },
                },
                {
                    provide: SourceStatusService,
                    useValue: {
                        supportsStatusFilter: true,
                        statusOf: (p: PlaylistMeta) => ({
                            reachability: p._id === 'playlist-2' ? 'bad' : 'ok',
                        }),
                    },
                },
                {
                    provide: SourceRemovalService,
                    useValue: {
                        pendingIds: signal(new Set<string>()),
                        isPending: () => false,
                    },
                },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        queryParamMap: of(convertToParamMap({})),
                    },
                },
                {
                    provide: SortService,
                    useValue: {
                        getSortOptions: () =>
                            of({
                                by: SortBy.DATE_ADDED,
                                order: SortOrder.DESC,
                            }),
                        setSortOptions: (options: unknown) =>
                            setSortOptions(options),
                    },
                },
                {
                    provide: WORKSPACE_SHELL_ACTIONS,
                    useValue: {
                        openAddPlaylistDialog: jest.fn(),
                    },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (
                            key: string,
                            params?: Record<string, string | number>
                        ) => {
                            if (key === 'WORKSPACE.SOURCES.ALL_PLAYLISTS') {
                                return 'All Playlists';
                            }
                            if (
                                key === 'WORKSPACE.SOURCES.PLAYLIST_COUNT_ONE'
                            ) {
                                return '1 playlist';
                            }
                            if (
                                key === 'WORKSPACE.SOURCES.PLAYLIST_COUNT_OTHER'
                            ) {
                                return `${params?.['count']} playlists`;
                            }
                            if (key === 'HOME.SORT_OPTIONS.NEWEST') {
                                return 'Date added (Newest first)';
                            }
                            return key;
                        },
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                        onLangChange: new Subject(),
                        onTranslationChange: new Subject(),
                        onDefaultLangChange: new Subject(),
                        currentLang: 'en',
                        defaultLang: 'en',
                    },
                },
            ],
        })
            .overrideComponent(WorkspaceSourcesComponent, {
                set: {
                    imports: [
                        MatButtonModule,
                        MatDividerModule,
                        MatIconModule,
                        MatMenuModule,
                        MenuItemRadioCheckDirective,
                        MenuItemRadioDirective,
                        MockRecentPlaylistsComponent,
                        TranslatePipe,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(WorkspaceSourcesComponent);
    });

    it.each([
        ['launching', true, true],
        ['opened', true, true],
        ['playing', true, true],
        ['closed', false, false],
        ['error', false, false],
        ['error', true, true],
    ])(
        'protects only a live external session (%s, closable=%s)',
        (status, canClose, expected) => {
            const playback = TestBed.inject(
                PORTAL_EXTERNAL_PLAYBACK
            ) as unknown as { activeSession: { set(value: unknown): void } };
            playback.activeSession.set({
                status,
                canClose,
                contentInfo: { playlistId: 'external' },
            });
            fixture.componentInstance.openCleanup();
            const context = (TestBed.inject(MatDialog).open as jest.Mock).mock
                .calls[0][1].data;
            expect(context.protected('external')).toBe(expected);
        }
    );

    it('protects startup auto-refresh sources across the whole library', () => {
        const release = TestBed.inject(SourceActivityService).begin([
            'startup',
        ]);
        fixture.componentInstance.openCleanup();
        const context = (TestBed.inject(MatDialog).open as jest.Mock).mock
            .calls[0][1].data;
        expect(context.protected('startup')).toBe(true);
        release();
        expect(context.protected('startup')).toBe(false);
    });

    it('protects a source refreshing through the persistent header', () => {
        fixture.componentInstance.openCleanup();
        const open = TestBed.inject(MatDialog).open as jest.Mock;
        const context = open.mock.calls[0][1].data;
        expect(context.protected('busy')).toBe(true);
        expect(context.protected('other')).toBe(false);
    });

    it('puts a 28px title and the visible count on the page', async () => {
        fixture.detectChanges();
        await fixture.whenStable();

        const element = fixture.nativeElement as HTMLElement;
        expect(
            element.querySelector('.sources-title')?.textContent?.trim()
        ).toBe('All Playlists');
        expect(
            element.querySelector('.sources-count')?.textContent?.trim()
        ).toBe('2');
        // The header stays; the list below it scrolls.
        const scroller = element.querySelector('.sources-content');
        expect(scroller?.classList).toContain('app-scrollbar');
        expect(
            scroller?.contains(element.querySelector('.sources-header'))
        ).toBe(false);
    });

    it('titles the page by the status filter and counts what it shows', async () => {
        TestBed.inject(SourcesViewStateService).setStatus('bad');
        fixture.detectChanges();
        await fixture.whenStable();

        const element = fixture.nativeElement as HTMLElement;
        expect(
            element.querySelector('.sources-title')?.textContent?.trim()
        ).toBe('WORKSPACE.SOURCES.STATUS_BAD');
        expect(
            element.querySelector('.sources-count')?.textContent?.trim()
        ).toBe('1');
    });

    it('counts sources that do not respond on Clean up', async () => {
        fixture.detectChanges();
        await fixture.whenStable();

        const pill = (fixture.nativeElement as HTMLElement).querySelector(
            '.cleanup-trigger .sources-action__count'
        );
        expect(pill?.textContent?.trim()).toBe('1');
    });

    it('offers the source sorts as radio rows with the active one checked', async () => {
        fixture.detectChanges();
        await fixture.whenStable();

        (
            fixture.nativeElement.querySelector(
                '.sort-trigger'
            ) as HTMLButtonElement
        ).click();
        fixture.detectChanges();

        const rows = Array.from(
            document.querySelectorAll<HTMLElement>(
                '.cdk-overlay-container [mat-menu-item]'
            )
        );
        expect(rows.map((row) => row.getAttribute('role'))).toEqual([
            ...Array(7).fill('menuitemradio'),
            'menuitemcheckbox',
        ]);
        // The radio group is named by its section, as every menu group is.
        expect(
            rows[0].closest('[role="group"]')?.getAttribute('aria-label')
        ).toBe('WORKSPACE.REFINE_SORT_SECTION');
        expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual([
            'true',
            ...Array(7).fill('false'),
        ]);
        for (const row of rows.slice(0, 7)) {
            expect(row.firstElementChild?.classList).toContain(
                'app-menu-item-radio-check'
            );
        }

        rows[7].click();
        expect(setSortOptions).toHaveBeenCalledWith({
            by: SortBy.DATE_ADDED,
            order: SortOrder.DESC,
            failingFirst: true,
        });
    });
});
