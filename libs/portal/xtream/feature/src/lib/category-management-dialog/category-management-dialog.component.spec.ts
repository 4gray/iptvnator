import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { DatabaseService, XCategoryFromDb } from '@iptvnator/services';
import {
    CategoryManagementDialogComponent,
    CategoryManagementDialogData,
} from './category-management-dialog.component';

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
}));

describe('CategoryManagementDialogComponent', () => {
    let fixture: ComponentFixture<CategoryManagementDialogComponent>;
    let component: CategoryManagementDialogComponent;
    const db = {
        getAllXtreamCategories: jest.fn(),
        updateCategoryVisibility: jest.fn(),
    };
    const dialogRef = { close: jest.fn() };
    const data: CategoryManagementDialogData = {
        playlistId: 'mock-playlist',
        contentType: 'live',
        itemCounts: new Map(),
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        db.getAllXtreamCategories.mockResolvedValue(categories);
        db.updateCategoryVisibility.mockResolvedValue(undefined);
        data.contentType = 'live';
        await TestBed.configureTestingModule({
            imports: [
                CategoryManagementDialogComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                { provide: DatabaseService, useValue: db },
                { provide: MatDialogRef, useValue: dialogRef },
                { provide: MAT_DIALOG_DATA, useValue: data },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(CategoryManagementDialogComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
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

    it('selects only matches and preserves both states outside the filter', () => {
        component.searchTerm.set('fr');
        component.selectAll();
        expect(selectedIds()).toEqual([11, 12, 13]);
        component.clearSearch();
        expect(selectedIds()).toEqual([11, 12, 13]);
    });

    it('deselects only matches and keeps edits when the filter changes', () => {
        component.searchTerm.set('FR');
        component.deselectAll();
        expect(selectedIds()).toEqual([13]);
        component.searchTerm.set('DE');
        component.selectAll();
        expect(selectedIds()).toEqual([13, 14]);
        component.clearSearch();
        expect(selectedIds()).toEqual([13, 14]);
    });

    it('uses the matching group for action states and the whole list for the counter', () => {
        component.searchTerm.set('FR');
        expect(bulkButtons().map((button) => button.disabled)).toEqual([
            false,
            false,
        ]);
        component.selectAll();
        expect(bulkButtons().map((button) => button.disabled)).toEqual([
            true,
            false,
        ]);
        expect(component.selectedCount()).toBe(3);
        expect(component.totalCount()).toBe(4);
        component.deselectAll();
        expect(bulkButtons().map((button) => button.disabled)).toEqual([
            false,
            true,
        ]);
        expect(component.selectedCount()).toBe(1);
        expect(bulkButtons()[0].textContent).toContain('SELECT_FILTERED');
        expect(bulkButtons()[1].textContent).toContain('DESELECT_FILTERED');
    });

    it('disables both actions with no matches and leaves every selection intact', () => {
        component.searchTerm.set('no matches');
        expect(bulkButtons().map((button) => button.disabled)).toEqual([
            true,
            true,
        ]);
        expect(
            fixture.nativeElement.querySelector('.empty-message').textContent
        ).toContain('NO_RESULTS');
        component.selectAll();
        component.deselectAll();
        expect(selectedIds()).toEqual([11, 13]);
    });

    it('applies bulk actions to the entire list with an empty filter', () => {
        component.selectAll();
        expect(selectedIds()).toEqual([11, 12, 13, 14]);
        expect(bulkButtons()[0].disabled).toBe(true);
        component.deselectAll();
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
        component.searchTerm.set('FR');
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
        component.searchTerm.set('FR');
        component.deselectAll();
        await component.save();
        expect(db.updateCategoryVisibility.mock.calls).toEqual([
            [[11, 12, 14], true],
            [[13], false],
        ]);
        expect(dialogRef.close).toHaveBeenCalledWith(true);
    });

    it('discards pending bulk changes on cancel', () => {
        component.searchTerm.set('FR');
        component.selectAll();
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

    it.each([
        ['live', 'live'],
        ['vod', 'movies'],
        ['series', 'series'],
    ] as const)(
        'loads all %s categories including hidden categories',
        async (contentType, dbType) => {
            data.contentType = contentType;
            await component.ngOnInit();
            expect(db.getAllXtreamCategories).toHaveBeenLastCalledWith(
                'mock-playlist',
                dbType
            );
            expect(selectedIds()).toEqual([11, 13]);
        }
    );
});
