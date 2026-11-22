import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { Store } from '@ngrx/store';
import { of, throwError } from 'rxjs';
import {
    CategoryEditorComponent,
    CategoryEditorRow,
} from '@iptvnator/portal/shared/ui';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { ParentalLockService, PlaylistsService } from '@iptvnator/services';
import {
    StalkerCategoryLockDialogComponent,
    StalkerCategoryLockDialogData,
} from './stalker-category-lock-dialog.component';

describe('StalkerCategoryLockDialogComponent', () => {
    let fixture: ComponentFixture<StalkerCategoryLockDialogComponent>;
    let component: StalkerCategoryLockDialogComponent;
    let editor: CategoryEditorComponent<CategoryEditorRow>;
    const dispatch = jest.fn();
    const snackBar = { open: jest.fn() };
    const playlists = { updateStalkerCategoryVisibility: jest.fn() };
    const dialogRef = { close: jest.fn() };
    const parentalLock = {
        active: signal(false),
        enabled: signal(true),
        lockedStalkerIds: jest.fn(() => ['2']),
        setStalkerLocks: jest.fn(),
    };
    const data: StalkerCategoryLockDialogData = {
        playlistId: 'stalker-1',
        contentType: 'itv',
        hiddenIds: ['2', 'offline-genre'],
        categories: [
            { category_id: '1', category_name: 'News', censored: false },
            { category_id: '2', category_name: 'Adult', censored: true },
        ] as StalkerCategoryLockDialogData['categories'],
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        parentalLock.active.set(false);
        parentalLock.enabled.set(true);
        playlists.updateStalkerCategoryVisibility.mockReturnValue(
            of({ hiddenStalkerCategories: { itv: ['1', 'offline-genre'] } })
        );
        parentalLock.setStalkerLocks.mockResolvedValue(true);
        await TestBed.configureTestingModule({
            imports: [
                StalkerCategoryLockDialogComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                { provide: MatDialogRef, useValue: dialogRef },
                { provide: MAT_DIALOG_DATA, useValue: data },
                { provide: ParentalLockService, useValue: parentalLock },
                { provide: MatSnackBar, useValue: snackBar },
                { provide: PlaylistsService, useValue: playlists },
                { provide: Store, useValue: { dispatch } },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(StalkerCategoryLockDialogComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
        editor = fixture.debugElement.query(
            By.directive(CategoryEditorComponent)
        ).componentInstance;
    });

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

    it('seeds the draft from the stored locks', () => {
        expect(component.categories().map((c) => c.lockedDraft)).toEqual([
            false,
            true,
        ]);
        expect(editor.lockedCount()).toBe(1);
    });

    it('closes without saving when the session relocks while it is open', () => {
        expect(dialogRef.close).not.toHaveBeenCalled();

        parentalLock.active.set(true);
        fixture.detectChanges();

        expect(dialogRef.close).toHaveBeenCalledWith(false);
        expect(parentalLock.setStalkerLocks).not.toHaveBeenCalled();
    });

    it('labels the clear-search button', () => {
        editor.searchTerm.set('new');
        fixture.detectChanges();

        const clear: HTMLButtonElement = fixture.nativeElement.querySelector(
            '.search-inline__clear'
        );
        expect(clear.getAttribute('aria-label')).toBe(
            'EMBEDDED_MPV.PLAYER.CLEAR_SEARCH'
        );
    });

    it('seeds visible and locked independently and saves only changed visibility IDs', async () => {
        expect(component.categories().map((c) => c.selected)).toEqual([
            true,
            false,
        ]);
        editor.searchTerm.set('news');
        editor.deselectAll();
        editor.searchTerm.set('adult');
        editor.selectAll();
        await component.save();
        expect(playlists.updateStalkerCategoryVisibility).toHaveBeenCalledWith(
            data.playlistId,
            {
                itv: { hide: ['1'], show: ['2'] },
            }
        );
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                playlistId: data.playlistId,
                hiddenStalkerCategories: { itv: ['1', 'offline-genre'] },
            })
        );
        expect(parentalLock.setStalkerLocks).not.toHaveBeenCalled();
        expect(dialogRef.close).toHaveBeenCalledWith(true);
    });

    it('preserves visibility when updating censored and individual locks', async () => {
        editor.unlockAll();
        editor.lockCensored();
        editor.toggleLock(component.categories()[0]);
        await component.save();
        expect(
            playlists.updateStalkerCategoryVisibility
        ).not.toHaveBeenCalled();
        const [playlistId, section, edit] =
            parentalLock.setStalkerLocks.mock.calls[0];
        expect([playlistId, section]).toEqual([data.playlistId, 'itv']);
        expect(edit(['2', 'unlisted'])).toEqual(['2', 'unlisted', '1']);
    });

    it('toggles a row checkbox and lock button independently', () => {
        const row = fixture.nativeElement.querySelector(
            '[data-category-id="1"]'
        ) as HTMLElement;
        const checkbox = row.querySelector('input')!;
        const lock = row.querySelector('button')!;
        lock.click();
        fixture.detectChanges();
        expect(lock.getAttribute('aria-pressed')).toBe('true');
        expect(checkbox.checked).toBe(true);
        checkbox.click();
        fixture.detectChanges();
        expect(checkbox.checked).toBe(false);
        expect(lock.getAttribute('aria-pressed')).toBe('true');
    });

    it('shows visibility controls with parental locking disabled', () => {
        parentalLock.enabled.set(false);
        fixture.detectChanges();
        expect(
            fixture.nativeElement.querySelectorAll('mat-checkbox')
        ).toHaveLength(2);
        expect(fixture.nativeElement.querySelector('.lock-toggle')).toBeNull();
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="stalker-lock-censored"]'
            )
        ).toBeNull();
    });

    it('keeps a failed draft open and retries only outstanding writes', async () => {
        editor.deselectAll();
        editor.unlockAll();
        playlists.updateStalkerCategoryVisibility.mockReturnValueOnce(
            throwError(() => new Error('unavailable'))
        );
        await component.save();
        expect(snackBar.open.mock.lastCall[0]).toBe(
            'XTREAM.CATEGORY_MANAGEMENT.SAVE_FAILED'
        );
        expect(parentalLock.setStalkerLocks).not.toHaveBeenCalled();
        expect(dialogRef.close).not.toHaveBeenCalled();

        parentalLock.setStalkerLocks.mockResolvedValueOnce(false);
        await component.save();
        expect(snackBar.open.mock.lastCall[0]).toBe(
            'PARENTAL_LOCK.SAVE_FAILED'
        );
        expect(dialogRef.close).not.toHaveBeenCalled();

        await component.save();
        expect(playlists.updateStalkerCategoryVisibility).toHaveBeenCalledTimes(
            2
        );
        expect(dialogRef.close).toHaveBeenCalledWith(true);
    });

    it('discards the draft when closed', () => {
        editor.deselectAll();
        editor.unlockAll();
        editor.cancelled.emit();
        expect(dialogRef.close).toHaveBeenCalledWith(false);
        expect(
            playlists.updateStalkerCategoryVisibility
        ).not.toHaveBeenCalled();
        expect(parentalLock.setStalkerLocks).not.toHaveBeenCalled();
    });
});
