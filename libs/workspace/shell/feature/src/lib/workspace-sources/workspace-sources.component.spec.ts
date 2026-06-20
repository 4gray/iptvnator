import { Component, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { provideMockStore } from '@ngrx/store/testing';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import {
    selectActiveTypeFilters,
    selectAllPlaylistsMeta,
} from '@iptvnator/m3u-state';
import { SortBy, SortOrder, SortService } from '@iptvnator/services';
import { WORKSPACE_SHELL_ACTIONS } from '@iptvnator/workspace/shell/util';
import { WorkspaceSourcesComponent } from './workspace-sources.component';

@Component({
    selector: 'app-recent-playlists',
    template: '',
    standalone: true,
})
class MockRecentPlaylistsComponent {
    readonly searchQueryInput = input('');
    readonly addPlaylistClicked = output<void>();
}

describe('WorkspaceSourcesComponent', () => {
    let fixture: ComponentFixture<WorkspaceSourcesComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [WorkspaceSourcesComponent, NoopAnimationsModule],
            providers: [
                provideMockStore({
                    selectors: [
                        {
                            selector: selectActiveTypeFilters,
                            value: ['m3u', 'xtream', 'stalker'],
                        },
                        {
                            selector: selectAllPlaylistsMeta,
                            value: [
                                {
                                    _id: 'playlist-1',
                                    title: 'Playlist 1',
                                },
                            ],
                        },
                    ],
                }),
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
                        setSortOptions: jest.fn(),
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
                        onLangChange: of(null),
                        onTranslationChange: of(null),
                        onDefaultLangChange: of(null),
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
                        MatIconModule,
                        MatMenuModule,
                        MockRecentPlaylistsComponent,
                        TranslatePipe,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(WorkspaceSourcesComponent);
    });

    it('renders the shared panel header structure without paragraph subtitle margins', async () => {
        fixture.detectChanges();
        await fixture.whenStable();

        const header: HTMLElement =
            fixture.nativeElement.querySelector('.sources-header');
        const meta: HTMLElement =
            fixture.nativeElement.querySelector('.sources-header__meta');
        const title: HTMLElement =
            fixture.nativeElement.querySelector('.sources-title');
        const subtitle: HTMLElement =
            fixture.nativeElement.querySelector('.sources-subtitle');

        expect(header).not.toBeNull();
        expect(meta).not.toBeNull();
        expect(title.textContent?.trim()).toBe('All Playlists');
        expect(subtitle.textContent?.trim()).toBe('1 playlist');
        expect(subtitle.tagName).toBe('SPAN');
    });

    it('uses the shared always-visible scrollbar utility for the playlist list', async () => {
        fixture.detectChanges();
        await fixture.whenStable();

        const content: HTMLElement =
            fixture.nativeElement.querySelector('.sources-content');

        expect(content.classList.contains('app-scrollbar')).toBe(true);
    });
});
