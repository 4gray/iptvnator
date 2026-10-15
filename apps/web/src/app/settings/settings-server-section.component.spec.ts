import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ServerStorageStatusService } from '@iptvnator/services';
import {
    SERVER_STORAGE_CONFIG,
    ServerMigrationService,
    ServerStorageSession,
} from '@iptvnator/services/server-storage';
import { SettingsServerSectionComponent } from './settings-server-section.component';

describe('SettingsServerSectionComponent', () => {
    let fixture: ComponentFixture<SettingsServerSectionComponent>;
    const session = { fetchStatus: jest.fn(), signOut: jest.fn() };
    const migration = {
        browserPlaylists: jest.fn(),
        browserDataMoved: jest.fn(),
        moveBrowserData: jest.fn(),
    };

    async function render(
        auth: 'none' | 'token',
        browserPlaylists = [{ id: 'a', title: 'A', kind: 'm3u' }]
    ) {
        session.fetchStatus.mockResolvedValue({
            playlists: 4,
            databaseBytes: 38 * 1024 * 1024,
            databasePath: '/data/databases/iptvnator.db',
            startedAt: '2026-10-11T08:00:00.000Z',
        });
        migration.browserDataMoved.mockReturnValue(false);
        migration.browserPlaylists.mockResolvedValue(browserPlaylists);
        await TestBed.configureTestingModule({
            imports: [
                SettingsServerSectionComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                { provide: ServerStorageSession, useValue: session },
                { provide: ServerMigrationService, useValue: migration },
                {
                    provide: SERVER_STORAGE_CONFIG,
                    useValue: { baseUrl: 'http://nas.local:4333/api' },
                },
                {
                    provide: ServerStorageStatusService,
                    useValue: {
                        state: signal('online'),
                        instance: signal({ auth, instanceId: 'i-1' }),
                    },
                },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(SettingsServerSectionComponent);
        await fixture.componentInstance.load();
        fixture.detectChanges();
    }

    const byTestId = (id: string): HTMLElement | null =>
        fixture.nativeElement.querySelector(`[data-test-id="${id}"]`);

    afterEach(() => {
        TestBed.resetTestingModule();
        jest.resetAllMocks();
    });

    it('shows the storage figures and the database path', async () => {
        await render('none');
        const text = fixture.nativeElement.textContent;

        expect(text).toContain('/data/databases/iptvnator.db');
        expect(byTestId('server-address')?.textContent?.trim()).toBe(
            'http://nas.local:4333'
        );
        expect(byTestId('server-state')?.dataset['state']).toBe('online');
        expect(fixture.componentInstance.sizeLabel()).toBe('38.0 MB');
        expect(byTestId('server-sign-out')).toBeNull();
    });

    it('moves browser playlists and reports the result', async () => {
        await render('none');
        migration.moveBrowserData.mockResolvedValue({
            imported: 1,
            merged: 0,
            failed: 0,
        });
        migration.browserDataMoved.mockReturnValue(true);

        byTestId('server-import-browser')?.click();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(migration.moveBrowserData).toHaveBeenCalled();
        expect(byTestId('server-import-browser')).toBeNull();
        expect(byTestId('server-import-reload')).not.toBeNull();
        expect(fixture.nativeElement.textContent).toContain(
            'SERVER_STORAGE.MIGRATION_DONE'
        );
    });

    it('hides the browser import when there is nothing to move', async () => {
        await render('none', []);

        expect(
            fixture.nativeElement.querySelector(
                '[data-setting-id="server-import-browser"]'
            )
        ).toBeNull();
    });

    it('offers sign out when a token is in use', async () => {
        await render('token');

        byTestId('server-sign-out')?.click();

        expect(session.signOut).toHaveBeenCalled();
    });

    it('asks the page to export a backup', async () => {
        await render('none');
        const exported = jest.fn();
        fixture.componentInstance.exportData.subscribe(exported);

        byTestId('server-export-backup')?.click();

        expect(exported).toHaveBeenCalled();
    });
});
