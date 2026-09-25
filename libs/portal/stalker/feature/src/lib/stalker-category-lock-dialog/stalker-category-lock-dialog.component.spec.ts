import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { ParentalLockService } from '@iptvnator/services';
import {
    StalkerCategoryLockDialogComponent,
    StalkerCategoryLockDialogData,
} from './stalker-category-lock-dialog.component';

describe('StalkerCategoryLockDialogComponent', () => {
    let fixture: ComponentFixture<StalkerCategoryLockDialogComponent>;
    let component: StalkerCategoryLockDialogComponent;
    const dialogRef = { close: jest.fn() };
    const parentalLock = {
        active: signal(false),
        lockedStalkerIds: jest.fn(() => ['2']),
        setStalkerLocks: jest.fn(),
    };
    const data: StalkerCategoryLockDialogData = {
        playlistId: 'stalker-1',
        contentType: 'itv',
        categories: [
            { category_id: '1', category_name: 'News', censored: false },
            { category_id: '2', category_name: 'Adult', censored: true },
        ] as StalkerCategoryLockDialogData['categories'],
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        parentalLock.active.set(false);
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
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(StalkerCategoryLockDialogComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('seeds the draft from the stored locks', () => {
        expect(component.categories().map((c) => c.locked)).toEqual([
            false,
            true,
        ]);
        expect(component.lockedCount()).toBe(1);
    });

    it('closes without saving when the session relocks while it is open', () => {
        expect(dialogRef.close).not.toHaveBeenCalled();

        parentalLock.active.set(true);
        fixture.detectChanges();

        expect(dialogRef.close).toHaveBeenCalledWith(false);
        expect(parentalLock.setStalkerLocks).not.toHaveBeenCalled();
    });
});
