import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
    StalkerItvCacheService,
    StalkerSessionService,
    withStalkerContent,
} from '@iptvnator/portal/stalker/data-access';
import { DataService, ParentalLockService } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { WorkspaceContextCategoryViewComponent } from './workspace-context-category-view.component';

type ContentType = 'vod' | 'series' | 'itv' | 'radio';

const PLAYLIST = {
    _id: 'playlist-1',
    title: 'Demo Stalker',
    count: 0,
    autoRefresh: false,
    importDate: '2026-04-14T00:00:00.000Z',
    portalUrl: 'http://demo.example/stalker_portal/server/load.php',
    macAddress: '00:1A:79:00:00:01',
    isFullStalkerPortal: false,
} as PlaylistMeta;

/** The real category loader, minus the selection features it reads. */
const CategoryStore = signalStore(
    { protectedState: false },
    withState({
        currentPlaylist: undefined as PlaylistMeta | undefined,
        selectedContentType: 'itv' as ContentType,
        selectedCategoryId: undefined as string | null | undefined,
        searchPhrase: '',
        page: 0,
    }),
    withMethods((store) => ({
        load(playlist: PlaylistMeta, contentType: ContentType) {
            patchState(store, {
                currentPlaylist: playlist,
                selectedContentType: contentType,
            });
        },
    })),
    withStalkerContent()
);

@Component({
    imports: [WorkspaceContextCategoryViewComponent],
    template: `<app-workspace-context-category-view
        [items]="store.getCategoryResource()"
    />`,
})
class CategoryRailHostComponent {
    readonly store = inject(CategoryStore);
}

async function waitFor(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        if (predicate()) {
            return;
        }
        TestBed.flushEffects();
        await new Promise((resolve) => setTimeout(resolve));
    }
    throw new Error('Timed out waiting for the categories to load');
}

/**
 * Regression: the Stalker store used to bake `translate.instant` of its
 * every-item genre into the loaded list, so a runtime language switch left
 * that row in the language the list loaded in until a reload or restart.
 */
describe('Stalker category rail across a runtime language switch', () => {
    let translate: TranslateService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot(), CategoryRailHostComponent],
            providers: [
                CategoryStore,
                {
                    provide: DataService,
                    useValue: {
                        sendIpcEvent: jest.fn().mockResolvedValue({
                            js: [{ id: '7', title: 'Drama' }],
                        }),
                    },
                },
                {
                    provide: ParentalLockService,
                    useValue: {
                        active: () => false,
                        version: signal(0),
                        lockedStalkerIds: () => [],
                    },
                },
                {
                    provide: StalkerItvCacheService,
                    useValue: {
                        versionFor: () => 0,
                        getChannels: () => null,
                        isReady: () => false,
                        isLoading: () => false,
                        isUnsupported: () => false,
                        progressOf: () => null,
                        ensureLoaded: jest.fn().mockResolvedValue(undefined),
                    },
                },
                {
                    provide: StalkerSessionService,
                    useValue: {
                        makeAuthenticatedRequest: jest.fn(),
                        ensureToken: jest
                            .fn()
                            .mockResolvedValue({ token: null }),
                    },
                },
            ],
        });
        translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            PORTALS: {
                ALL_CATEGORIES: 'All categories',
                ALL_RADIO: 'All radio',
            },
        });
        translate.setTranslation('ru', {
            PORTALS: {
                ALL_CATEGORIES: 'Все категории',
                ALL_RADIO: 'Всё радио',
            },
        });
        translate.use('en');
    });

    it.each([
        ['itv', 'All categories', 'Все категории'],
        ['radio', 'All radio', 'Всё радио'],
    ] as const)(
        're-labels the %s every-item genre loaded before the switch',
        async (contentType, english, russian) => {
            const fixture = TestBed.createComponent(CategoryRailHostComponent);
            const store = fixture.componentInstance.store;
            store.load(PLAYLIST, contentType);
            await waitFor(() => store.getCategoryResource().length === 2);
            fixture.detectChanges();
            const labels = () =>
                Array.from(
                    fixture.nativeElement.querySelectorAll(
                        '.nav-item-label'
                    ) as NodeListOf<HTMLElement>,
                    (label) => label.textContent?.trim()
                );

            expect(labels()).toEqual([english, 'Drama']);

            translate.use('ru');
            fixture.detectChanges();

            // The provider's own genre name is never translated.
            expect(labels()).toEqual([russian, 'Drama']);
        }
    );
});
