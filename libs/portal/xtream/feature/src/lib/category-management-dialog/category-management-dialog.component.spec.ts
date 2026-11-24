import { toObservable } from '@angular/core/rxjs-interop';
import { firstValueFrom, filter } from 'rxjs';
import { signal } from '@angular/core';
import { LazySnackBar } from '@iptvnator/services/lazy-snack-bar';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
    CategoryEditorComponent,
    CategoryEditorRow,
} from '@iptvnator/portal/shared/ui';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { XTREAM_DATA_SOURCE } from '@iptvnator/portal/xtream/data-access';
import {
    DatabaseService,
    ParentalLockService,
    RuntimeCapabilitiesService,
    XtreamPendingRestoreService,
    XCategoryFromDb,
} from '@iptvnator/services';
import { XtreamDeferredCatalogRestoreService } from '@iptvnator/services/xtream-catalog-restore';
import {
    CategoryManagementDialogComponent,
    CategoryManagementDialogData,
} from './category-management-dialog.component';

const ERROR_TOAST = expect.objectContaining({
    politeness: 'assertive',
    panelClass: expect.arrayContaining(['app-notification--error']),
});

// Local database IDs deliberately differ from provider IDs.
const categories: XCategoryFromDb[] = [
    { id: 11, xtream_id: 101, name: 'FR News', hidden: false },
    { id: 12, xtream_id: 102, name: 'FR Sports', hidden: true },
    { id: 13, xtream_id: 103, name: 'DE News', hidden: false },
    { id: 14, xtream_id: 104, name: 'DE Sports', hidden: true },
].map((category) => ({
    ...category,
    playlist_id: 'mock-playlist',
    type: 'live',
    locked: false,
}));

describe('CategoryManagementDialogComponent', () => {
    let fixture: ComponentFixture<CategoryManagementDialogComponent>;
    let component: CategoryManagementDialogComponent;
    let editor: CategoryEditorComponent<CategoryEditorRow>;
    const db = {
        updateCategoryVisibility: jest.fn(),
    };
    const dataSource = {
        getAllCategories: jest.fn(),
    };
    const dialogRef = { close: jest.fn() };
    const snackBar = { open: jest.fn().mockResolvedValue(null) };
    const parentalLock = {
        enabled: signal(false),
        active: signal(false),
        lockedXtreamIds: jest.fn(() => [] as number[]),
        setXtreamLocks: jest.fn(),
        ensureLocksReadable: jest.fn(async () => true),
    };
    const data: CategoryManagementDialogData = {
        playlistId: 'mock-playlist',
        contentType: 'live',
        itemCounts: new Map(),
    };

    /** The browser path stores choices by provider ID. */
    async function createDialog(supportsVisibility: boolean): Promise<void> {
        await TestBed.configureTestingModule({
            imports: [
                CategoryManagementDialogComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                { provide: DatabaseService, useValue: db },
                { provide: XTREAM_DATA_SOURCE, useValue: dataSource },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        supportsXtreamSqliteDataSource: supportsVisibility,
                    },
                },
                { provide: MatDialogRef, useValue: dialogRef },
                { provide: MAT_DIALOG_DATA, useValue: data },
                { provide: ParentalLockService, useValue: parentalLock },
                { provide: LazySnackBar, useValue: snackBar },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(CategoryManagementDialogComponent);
        component = fixture.componentInstance;
        editor = fixture.debugElement.query(
            By.directive(CategoryEditorComponent)
        ).componentInstance;
        const loaded = TestBed.runInInjectionContext(() =>
            firstValueFrom(
                toObservable(component.isLoading).pipe(
                    filter((loading) => !loading)
                )
            )
        );
        fixture.detectChanges();
        await loaded;
        await fixture.whenStable();
        fixture.detectChanges();
    }

    beforeEach(async () => {
        jest.clearAllMocks();
        dataSource.getAllCategories.mockResolvedValue(categories);
        localStorage.removeItem('xtream-category-visibility:mock-playlist');
        db.updateCategoryVisibility.mockResolvedValue(true);
        parentalLock.enabled.set(false);
        parentalLock.active.set(false);
        parentalLock.setXtreamLocks.mockResolvedValue(true);
        data.contentType = 'live';
        await createDialog(true);
    });

    function selectedIds() {
        return component
            .categories()
            .filter((c) => c.selected)
            .map((c) => c.id);
    }

    function bulkButtons(): HTMLButtonElement[] {
        fixture.detectChanges();
        return Array.from(
            fixture.nativeElement.querySelectorAll('.bulk-actions button')
        );
    }

    it('hides the header close while a save is in flight, so the caller always gets a result', () => {
        const headerClose = () =>
            (fixture.nativeElement as HTMLElement).querySelector(
                '.app-dialog__close'
            );
        expect(headerClose()).not.toBeNull();

        component.isSaving.set(true);
        fixture.detectChanges();

        expect(headerClose()).toBeNull();
    });

    it('selects only matches and preserves both states outside the filter', () => {
        editor.searchTerm.set('fr');
        editor.selectAll();
        expect(selectedIds()).toEqual([11, 12, 13]);
        editor.clearSearch();
        expect(selectedIds()).toEqual([11, 12, 13]);
    });

    it('deselects only matches and keeps edits when the filter changes', () => {
        editor.searchTerm.set('FR');
        editor.deselectAll();
        expect(selectedIds()).toEqual([13]);
        editor.searchTerm.set('DE');
        editor.selectAll();
        expect(selectedIds()).toEqual([13, 14]);
        editor.clearSearch();
        expect(selectedIds()).toEqual([13, 14]);
    });

    it('uses the matching group for action states and the whole list for the counter', () => {
        editor.searchTerm.set('FR');
        expect(bulkButtons().map((button) => button.disabled)).toEqual([
            false,
            false,
        ]);
        editor.selectAll();
        expect(bulkButtons().map((button) => button.disabled)).toEqual([
            true,
            false,
        ]);
        expect(editor.selectedCount()).toBe(3);
        expect(editor.totalCount()).toBe(4);
        editor.deselectAll();
        expect(bulkButtons().map((button) => button.disabled)).toEqual([
            false,
            true,
        ]);
        expect(editor.selectedCount()).toBe(1);
        expect(bulkButtons()[0].textContent).toContain('SELECT_FILTERED');
        expect(bulkButtons()[1].textContent).toContain('DESELECT_FILTERED');
    });

    it('disables both actions with no matches and leaves every selection intact', () => {
        editor.searchTerm.set('no matches');
        expect(bulkButtons().map((button) => button.disabled)).toEqual([
            true,
            true,
        ]);
        expect(
            fixture.nativeElement.querySelector('.empty-message').textContent
        ).toContain('NO_RESULTS');
        editor.selectAll();
        editor.deselectAll();
        expect(selectedIds()).toEqual([11, 13]);
    });

    it('applies bulk actions to the entire list with an empty filter', () => {
        editor.selectAll();
        expect(selectedIds()).toEqual([11, 12, 13, 14]);
        expect(bulkButtons()[0].disabled).toBe(true);
        editor.deselectAll();
        expect(selectedIds()).toEqual([]);
        expect(bulkButtons()[1].disabled).toBe(true);
        expect(bulkButtons()[0].textContent).toContain('SELECT_ALL');
    });

    it('disables both actions for an empty catalog', () => {
        component.categories.set([]);
        expect(bulkButtons().map((button) => button.disabled)).toEqual([
            true,
            true,
        ]);
    });

    it('renders the actual partial selection as individually checked categories', () => {
        editor.searchTerm.set('FR');
        fixture.detectChanges();
        const checkboxes: HTMLInputElement[] = Array.from(
            fixture.nativeElement.querySelectorAll('mat-checkbox input')
        );
        expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual([
            true,
            false,
        ]);
        checkboxes[1].click();
        fixture.detectChanges();
        expect(selectedIds()).toEqual([11, 12, 13]);
        expect(bulkButtons()[0].disabled).toBe(true);
    });

    it('saves the full selection using local IDs even while filtered', async () => {
        editor.searchTerm.set('FR');
        editor.deselectAll();
        await component.save();
        expect(db.updateCategoryVisibility.mock.calls).toEqual([
            [[11, 12, 14], true, true],
            [[13], false, true],
        ]);
        expect(dialogRef.close).toHaveBeenCalledWith(true);
    });

    it.each([false, true])(
        'records explicit native intent without changing dormant DOM data (failed=%s)',
        async (failed) => {
            localStorage.clear();
            try {
                const pending = new XtreamPendingRestoreService();
                const deferred = new XtreamDeferredCatalogRestoreService();
                const state = {
                    favorites: [],
                    playbackPositions: [],
                    hiddenCategories: [102, 999].map((xtreamId) => ({
                        categoryType: 'live' as const,
                        xtreamId,
                    })),
                    recentlyViewed: [
                        {
                            contentType: 'movie' as const,
                            xtreamId: 800,
                            viewedAt: 'synthetic',
                        },
                    ],
                };
                pending.set(data.playlistId, state);
                deferred.prepare(data.playlistId, state, []);
                db.updateCategoryVisibility.mockResolvedValue(!failed);
                editor.selectAll();
                await component.save();
                const expected = state.hiddenCategories;
                expect(
                    deferred.getSnapshot(data.playlistId).state.hiddenCategories
                ).toEqual(expected);
                expect(
                    pending.getOrThrow(data.playlistId)?.hiddenCategories
                ).toEqual(expected);
                expect(
                    deferred.getSnapshot(data.playlistId).state.recentlyViewed
                ).toEqual(state.recentlyViewed);
                if (failed) expect(dialogRef.close).not.toHaveBeenCalled();
                else {
                    expect(db.updateCategoryVisibility).toHaveBeenCalledWith(
                        [11, 12, 13, 14],
                        false,
                        true
                    );
                    expect(dialogRef.close).toHaveBeenCalledWith(true);
                }
            } finally {
                localStorage.clear();
            }
        }
    );

    it('closes without saving when the session relocks while it is open', () => {
        parentalLock.enabled.set(true);
        fixture.detectChanges();
        expect(dialogRef.close).not.toHaveBeenCalled();

        parentalLock.active.set(true);
        fixture.detectChanges();

        expect(dialogRef.close).toHaveBeenCalledWith(false);
        expect(db.updateCategoryVisibility).not.toHaveBeenCalled();
        expect(parentalLock.setXtreamLocks).not.toHaveBeenCalled();
    });

    it('drops the lock draft when the session relocks during a pending save', async () => {
        parentalLock.enabled.set(true);
        component.showLocks.set(true);
        fixture.detectChanges();
        let finishVisibility: () => void = () => undefined;
        db.updateCategoryVisibility.mockImplementationOnce(
            () =>
                new Promise<boolean>(
                    (resolve) => (finishVisibility = () => resolve(true))
                )
        );
        editor.deselectAll();

        const saving = component.save();
        parentalLock.active.set(true);
        finishVisibility();
        await saving;

        expect(parentalLock.setXtreamLocks).not.toHaveBeenCalled();
    });

    it('offers no lock toggles, and saves no locks, while the lock store is unreadable', async () => {
        parentalLock.enabled.set(true);
        parentalLock.ensureLocksReadable.mockResolvedValueOnce(false);
        await component.ngOnInit();
        expect(component.showLocks()).toBe(false);

        await component.save();

        expect(parentalLock.setXtreamLocks).not.toHaveBeenCalled();
        expect(dialogRef.close).toHaveBeenCalledWith(true);
    });

    it('discards pending bulk changes on cancel', () => {
        editor.searchTerm.set('FR');
        editor.selectAll();
        component.cancel();
        expect(db.updateCategoryVisibility).not.toHaveBeenCalled();
        expect(dialogRef.close).toHaveBeenCalledWith(false);
        expect(categories.map((c) => c.hidden)).toEqual([
            false,
            true,
            false,
            true,
        ]);
    });

    it('reports a failed lock write with the translated lock message', async () => {
        parentalLock.enabled.set(true);
        component.showLocks.set(true);
        parentalLock.setXtreamLocks.mockResolvedValueOnce(false);

        await component.save();

        expect(snackBar.open).toHaveBeenCalledWith(
            'PARENTAL_LOCK.SAVE_FAILED',
            'CLOSE',
            ERROR_TOAST
        );
        expect(dialogRef.close).not.toHaveBeenCalled();
        expect(component.isSaving()).toBe(false);
    });

    it('does not blame the locks when the visibility write fails', async () => {
        parentalLock.enabled.set(true);
        component.showLocks.set(true);
        db.updateCategoryVisibility.mockRejectedValueOnce(new Error('db'));

        await component.save();

        expect(parentalLock.setXtreamLocks).not.toHaveBeenCalled();
        expect(snackBar.open).toHaveBeenCalledWith(
            'XTREAM.CATEGORY_MANAGEMENT.SAVE_FAILED',
            'CLOSE',
            ERROR_TOAST
        );
        expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('labels the clear-search button', () => {
        editor.searchTerm.set('fr');
        fixture.detectChanges();

        const clear: HTMLButtonElement = fixture.nativeElement.querySelector(
            '.search-inline__clear'
        );
        expect(clear.getAttribute('aria-label')).toBe(
            'EMBEDDED_MPV.PLAYER.CLEAR_SEARCH'
        );
    });

    describe('in the PWA', () => {
        beforeEach(async () => {
            TestBed.resetTestingModule();
            parentalLock.enabled.set(true);
            await createDialog(false);
        });

        it('offers visibility controls when parental locking is off', async () => {
            TestBed.resetTestingModule();
            parentalLock.enabled.set(false);
            await createDialog(false);
            expect(
                fixture.nativeElement.querySelectorAll('mat-checkbox')
            ).toHaveLength(categories.length);
            expect(
                fixture.nativeElement.querySelectorAll('.lock-toggle')
            ).toHaveLength(0);
        });

        it('saves edited provider IDs without replacing missing categories or another section', async () => {
            const key = 'xtream-category-visibility:mock-playlist';
            const unlisted = {
                categoryType: 'live',
                xtreamId: 77,
                hidden: true,
            };
            const otherSection = {
                categoryType: 'movies',
                xtreamId: 101,
                hidden: true,
            };
            localStorage.setItem(
                key,
                JSON.stringify({
                    version: 1,
                    categories: [unlisted, otherSection],
                })
            );
            editor.toggleCategory(component.categories()[0]);
            editor.toggleLock(component.categories()[1]);

            await component.save();

            expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
                version: 1,
                categories: [
                    unlisted,
                    otherSection,
                    { categoryType: 'live', xtreamId: 101, hidden: true },
                ],
            });
            expect(db.updateCategoryVisibility).not.toHaveBeenCalled();
            expect(parentalLock.setXtreamLocks).toHaveBeenCalledWith(
                'mock-playlist',
                'live',
                [102]
            );
            expect(dialogRef.close).toHaveBeenCalledWith(true);
        });

        it('keeps the draft open when the stored visibility cannot be read', async () => {
            const key = 'xtream-category-visibility:mock-playlist';
            localStorage.setItem(key, '{');
            editor.toggleCategory(component.categories()[0]);
            await component.save();
            expect(localStorage.getItem(key)).toBe('{');
            expect(snackBar.open).toHaveBeenCalledWith(
                'XTREAM.CATEGORY_MANAGEMENT.SAVE_FAILED',
                'CLOSE',
                ERROR_TOAST
            );
            expect(dialogRef.close).not.toHaveBeenCalled();
        });

        it('reports a failed lock write with the translated lock message', async () => {
            parentalLock.setXtreamLocks.mockRejectedValueOnce(
                new Error('store')
            );

            await component.save();

            expect(snackBar.open).toHaveBeenCalledWith(
                'PARENTAL_LOCK.SAVE_FAILED',
                'CLOSE',
                ERROR_TOAST
            );
            expect(dialogRef.close).not.toHaveBeenCalled();
        });
    });

    it.each([
        ['live', 'live'],
        ['vod', 'movies'],
        ['series', 'series'],
    ] as const)(
        'loads all %s categories including hidden categories',
        async (contentType, dbType) => {
            data.contentType = contentType;
            await component.ngOnInit();
            expect(dataSource.getAllCategories).toHaveBeenLastCalledWith(
                'mock-playlist',
                dbType
            );
            expect(selectedIds()).toEqual([11, 13]);
        }
    );
});
