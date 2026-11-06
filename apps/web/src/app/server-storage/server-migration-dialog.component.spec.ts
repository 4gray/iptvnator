import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { ServerMigrationService } from '@iptvnator/services/server-storage';
import { ServerMigrationDialogComponent } from './server-migration-dialog.component';

describe('ServerMigrationDialogComponent', () => {
    let fixture: ComponentFixture<ServerMigrationDialogComponent>;
    const migration = { skip: jest.fn(), moveBrowserData: jest.fn() };
    const dialogRef = { close: jest.fn() };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                ServerMigrationDialogComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: [{ id: 'm', title: 'Family', kind: 'm3u' }],
                },
                { provide: ServerMigrationService, useValue: migration },
                { provide: MatDialogRef, useValue: dialogRef },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(ServerMigrationDialogComponent);
        fixture.detectChanges();
    });

    afterEach(() => jest.resetAllMocks());

    const byTestId = (id: string) =>
        fixture.nativeElement.querySelector(`[data-test-id="${id}"]`);

    it('lists the browser playlists', () => {
        expect(fixture.nativeElement.textContent).toContain('Family');
    });

    it('records "not now" and closes', () => {
        byTestId('server-migration-not-now').click();

        expect(migration.skip).toHaveBeenCalled();
        expect(dialogRef.close).toHaveBeenCalled();
    });

    it('moves the data and offers a reload', async () => {
        const result = { imported: 1, merged: 0, failed: 0 };
        migration.moveBrowserData.mockResolvedValue(result);

        await fixture.componentInstance.move();
        fixture.detectChanges();

        expect(fixture.componentInstance.result()).toEqual(result);
        expect(byTestId('server-migration-result')).not.toBeNull();
        expect(byTestId('server-migration-reload')).not.toBeNull();
        expect(byTestId('server-migration-move')).toBeNull();
    });

    it('keeps the dialog open with a message when moving fails', async () => {
        migration.moveBrowserData.mockRejectedValue(new Error('offline'));

        await fixture.componentInstance.move();
        fixture.detectChanges();

        expect(fixture.componentInstance.failed()).toBe(true);
        expect(fixture.nativeElement.textContent).toContain(
            'SERVER_STORAGE.MIGRATION_FAILED'
        );
        expect(dialogRef.close).not.toHaveBeenCalled();
    });
});
