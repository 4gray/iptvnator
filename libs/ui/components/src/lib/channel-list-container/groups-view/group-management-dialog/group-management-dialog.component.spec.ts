import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { ParentalLockService } from '@iptvnator/services';
import {
    GroupManagementDialogComponent,
    GroupManagementDialogData,
} from './group-management-dialog.component';

describe('GroupManagementDialogComponent', () => {
    const dialogRef = { close: jest.fn() };
    const parentalLock = { active: signal(false) };

    async function create(
        data: GroupManagementDialogData
    ): Promise<ComponentFixture<GroupManagementDialogComponent>> {
        await TestBed.configureTestingModule({
            imports: [
                GroupManagementDialogComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                { provide: MatDialogRef, useValue: dialogRef },
                { provide: MAT_DIALOG_DATA, useValue: data },
                { provide: ParentalLockService, useValue: parentalLock },
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(GroupManagementDialogComponent);
        fixture.detectChanges();
        return fixture;
    }

    const groups = [
        { key: 'News', count: 3 },
        { key: 'Adult', count: 2 },
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        parentalLock.active.set(false);
    });

    it('closes without a result when the session relocks while locks are shown', async () => {
        const fixture = await create({
            groups,
            hiddenGroupTitles: [],
            lockedGroupTitles: ['Adult'],
        });
        expect(dialogRef.close).not.toHaveBeenCalled();

        parentalLock.active.set(true);
        fixture.detectChanges();

        expect(dialogRef.close).toHaveBeenCalledWith(undefined);
    });

    it('keeps the plain hide/show editor open when the lock feature is off', async () => {
        const fixture = await create({ groups, hiddenGroupTitles: ['News'] });

        parentalLock.active.set(true);
        fixture.detectChanges();

        expect(dialogRef.close).not.toHaveBeenCalled();
        expect(fixture.componentInstance.showLocks).toBe(false);
    });
});
