import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import type { Playlist } from '@iptvnator/shared/interfaces';
import { SourceSyncService } from '@iptvnator/services/source-sync';
import { SettingsServerSectionComponent } from './settings-server-section.component';

const readLocalSourcesForImport = jest.fn();
const requestSourceServer = jest.fn();

describe('source server settings', () => {
    let fixture: ComponentFixture<
        InstanceType<typeof SettingsServerSectionComponent>
    >;
    const originalElectron = window.electron;
    const originalFetch = globalThis.fetch;
    const sync = {
        connection: { apiUrl: 'https://nas.test/api', instanceId: 'nas' },
        state: signal('connected'),
        stateKey: signal('SOURCE_SYNC.STATE_connected'),
        lastSync: signal<number | null>(null),
        refresh: jest.fn(),
    };
    const local = {
        _id: 'local',
        title: 'Original source',
        serverUrl: 'https://provider.test',
        username: 'user',
        password: 'secret',
        favorites: ['private-favorite'],
        recentlyViewed: ['private-history'],
    } as unknown as Playlist;

    beforeEach(async () => {
        jest.clearAllMocks();
        sync.state.set('connected');
        sync.refresh.mockResolvedValue(undefined);
        (readLocalSourcesForImport as jest.Mock).mockResolvedValue([local]);
        (requestSourceServer as jest.Mock).mockResolvedValue({ status: 201 });
        window.electron = {
            sourceSyncLocalSources: readLocalSourcesForImport,
            sourceSyncRequest: requestSourceServer,
        } as unknown as typeof window.electron;
        await TestBed.configureTestingModule({
            imports: [
                SettingsServerSectionComponent,
                TranslateModule.forRoot(),
            ],
            providers: [{ provide: SourceSyncService, useValue: sync }],
        }).compileComponents();
        fixture = TestBed.createComponent(SettingsServerSectionComponent);
        fixture.detectChanges();
    });
    afterEach(() => {
        window.electron = originalElectron;
        globalThis.fetch = originalFetch;
        TestBed.resetTestingModule();
    });

    it('shows connection status and editable API address in both runtimes', () => {
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="source-server-state"]'
            ).textContent
        ).toContain('SOURCE_SYNC.STATE_connected');
        expect(fixture.componentInstance.url).toBe('https://nas.test/api');
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="source-server-connect"]'
            )
        ).not.toBeNull();
    });

    it('previews the preserved local sources before sending anything', async () => {
        await fixture.componentInstance.previewImport();
        expect(fixture.componentInstance.preview()).toEqual([local]);
        expect(requestSourceServer).not.toHaveBeenCalled();
    });

    it('imports definitions with fresh IDs while leaving favorites and history local', async () => {
        const component = fixture.componentInstance;
        await component.previewImport();
        await component.importSources();
        expect(requestSourceServer).toHaveBeenCalledWith({
            operation: 'create',
            id: expect.any(String),
            source: {
                id: expect.any(String),
                title: local.title,
                kind: 'xtream',
                serverUrl: local.serverUrl,
                username: local.username,
                password: local.password,
            },
        });
        expect(
            JSON.stringify((requestSourceServer as jest.Mock).mock.calls)
        ).not.toContain('private');
        expect(local._id).toBe('local');
        expect(component.preview()).toBeNull();
        expect(component.message()).toBe('SOURCE_SYNC.IMPORTED');
        expect(sync.refresh).toHaveBeenCalled();
    });

    it('keeps a failed import available for an idempotent retry', async () => {
        (requestSourceServer as jest.Mock).mockResolvedValueOnce({
            status: 503,
        });
        const component = fixture.componentInstance;
        await component.previewImport();
        await component.importSources();
        expect(component.preview()).toEqual([local]);
        expect(component.message()).toBe('SOURCE_SYNC.IMPORT_FAILED');
        expect(sync.refresh).not.toHaveBeenCalled();
    });

    it('disables the import action when the NAS cannot accept writes', () => {
        sync.state.set('offline');
        fixture.detectChanges();
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="source-server-import"]'
            ).disabled
        ).toBe(true);
    });

    it('normalizes the NAS app URL and delegates native connection before clearing the token', async () => {
        const configure = jest.fn().mockResolvedValue({});
        window.electron = {
            sourceSyncConfigure: configure,
        } as unknown as typeof window.electron;
        const component = fixture.componentInstance;
        component.url = 'https://nas.test/iptvnator';
        component.token = 'new-token';
        await component.connect();
        expect(configure).toHaveBeenCalledWith(
            'https://nas.test/iptvnator/api',
            'new-token',
            true
        );
        expect(component.token).toBe('');
        expect(component.busy()).toBe(false);
    });

    it('shows rejected credentials without leaking raw errors or confirming connection', async () => {
        const configure = jest
            .fn()
            .mockRejectedValue(new Error('SOURCE_SYNC.LOCKED'));
        window.electron = {
            sourceSyncConfigure: configure,
        } as unknown as typeof window.electron;
        const component = fixture.componentInstance;
        component.token = 'bad-token';
        await component.connect();
        expect(component.message()).toBe('SOURCE_SYNC.LOCKED');
        expect(component.token).toBe('');
    });

    it('returns to the retained native profile when disconnected', async () => {
        const disconnect = jest.fn().mockResolvedValue(undefined);
        window.electron = {
            sourceSyncDisconnect: disconnect,
        } as unknown as typeof window.electron;
        await fixture.componentInstance.disconnect();
        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(requestSourceServer).not.toHaveBeenCalled();
    });
});
