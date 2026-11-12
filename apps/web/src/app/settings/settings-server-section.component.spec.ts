import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import type { Playlist } from '@iptvnator/shared/interfaces';
import {
    SourceSyncService,
    disconnectBrowserSourceConnection,
    saveBrowserSourceConnection,
} from '@iptvnator/services/source-sync';
import { SettingsServerSectionComponent } from './settings-server-section.component';

const readLocalSourcesForImport = jest.fn();
const requestSourceServer = jest.fn();

describe('source server settings', () => {
    let fixture: ComponentFixture<
        InstanceType<typeof SettingsServerSectionComponent>
    >;
    const originalElectron = window.electron;
    const originalFetch = globalThis.fetch;
    const activeConnection = {
        apiUrl: 'https://nas.test/api',
        instanceId: 'nas',
    };
    const sync = {
        connection: activeConnection as typeof activeConnection | null,
        state: signal('connected'),
        stateKey: signal('SOURCE_SYNC.STATE_connected'),
        errorKey: signal<string | null>(null),
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
        sync.connection = activeConnection;
        sync.state.set('connected');
        sync.errorKey.set(null);
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

    function createDisconnectedSettings() {
        sync.connection = null;
        sync.state.set('local');
        const disconnected = TestBed.createComponent(
            SettingsServerSectionComponent
        );
        disconnected.detectChanges();
        return disconnected;
    }

    it('shows connection status and editable API address in both runtimes', () => {
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="source-server-state"]'
            ).textContent
        ).toContain('SOURCE_SYNC.STATE_connected');
        expect(fixture.componentInstance.urlControl.value).toBe(
            'https://nas.test/api'
        );
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="source-server-connect"]'
            )
        ).not.toBeNull();
    });

    it('shows that a manual check is running and then reports the connection problem', async () => {
        let finishCheck!: () => void;
        sync.refresh.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                finishCheck = resolve;
            })
        );
        const root = fixture.nativeElement as HTMLElement;
        const status = root.querySelector(
            '[data-test-id="source-server-state"]'
        );
        root.querySelector<HTMLButtonElement>(
            '[data-test-id="source-server-refresh"]'
        )?.click();
        fixture.detectChanges();
        expect(status?.textContent).toContain('SOURCE_SYNC.STATE_connecting');

        sync.state.set('offline');
        sync.errorKey.set('SOURCE_SYNC.INSTANCE_CHANGED');
        finishCheck();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(status?.textContent).toContain('SOURCE_SYNC.INSTANCE_CHANGED');
    });

    it('previews the preserved local sources before sending anything', async () => {
        await fixture.componentInstance.previewImport();
        expect(fixture.componentInstance.preview()).toEqual([local]);
        expect(requestSourceServer).not.toHaveBeenCalled();
    });

    it('shows a compact dismissible empty preview without an empty list or import action', async () => {
        readLocalSourcesForImport.mockResolvedValueOnce([]);
        await fixture.componentInstance.previewImport();
        fixture.detectChanges();
        const preview = fixture.nativeElement.querySelector(
            '[data-test-id="source-server-import-preview"]'
        );
        expect(preview.querySelector('[role="status"]').textContent).toContain(
            'SOURCE_SYNC.IMPORT_EMPTY'
        );
        expect(preview.querySelector('ul')).toBeNull();
        expect(
            preview.querySelector(
                '[data-test-id="source-server-import-confirm"]'
            )
        ).toBeNull();
        preview
            .querySelector('[data-test-id="source-server-import-close"]')
            .click();
        fixture.detectChanges();
        expect(fixture.componentInstance.preview()).toBeNull();
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

    it('imports sources when randomUUID is absent on a plain-HTTP LAN page', async () => {
        const previous = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
        Object.defineProperty(crypto, 'randomUUID', {
            configurable: true,
            value: undefined,
        });
        try {
            await fixture.componentInstance.previewImport();
            await fixture.componentInstance.importSources();
            expect(requestSourceServer).toHaveBeenCalledWith(
                expect.objectContaining({
                    operation: 'create',
                    id: expect.stringMatching(
                        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
                    ),
                })
            );
            expect(fixture.componentInstance.message()).toBe(
                'SOURCE_SYNC.IMPORTED'
            );
        } finally {
            if (previous) Object.defineProperty(crypto, 'randomUUID', previous);
            else Reflect.deleteProperty(crypto, 'randomUUID');
        }
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
        component.urlControl.setValue('https://nas.test/iptvnator');
        component.token = 'new-token';
        await component.connect();
        expect(configure).toHaveBeenCalledWith(
            'https://nas.test/iptvnator/api',
            'new-token',
            true,
            undefined
        );
        expect(component.token).toBe('');
        expect(component.busy()).toBe(false);
    });

    it('connects to the built-in server with its code and clears the field afterwards', async () => {
        const configure = jest.fn().mockResolvedValue({});
        const code = jest
            .fn()
            .mockResolvedValueOnce('synthetic-code')
            .mockRejectedValueOnce(new Error('synthetic bridge error'));
        window.electron = {
            sourceSyncConfigure: configure,
            hostedServerAccessCode: code,
        } as unknown as typeof window.electron;
        const component = fixture.componentInstance;
        const origin = 'http://127.0.0.1:4334';

        await component.connectHosted(origin);
        expect(configure).toHaveBeenCalledWith(
            origin + '/api',
            'synthetic-code',
            true,
            undefined
        );
        expect(component.token).toBe('');
        await component.connectHosted(origin);
        expect(configure).toHaveBeenCalledTimes(1);
        expect(component.message()).toBe('HOSTED_SERVER.CODE_FAILED');
        expect(component.token).toBe('');
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
        expect(component.token).toBe('bad-token');
    });

    it.each([
        'nas',
        'ftp://nas.test',
        'https://user:secret@nas.test',
        'https://nas.test?token=secret',
        'https://nas.test/#settings',
    ])(
        'rejects invalid address %s before contacting either runtime',
        async (url) => {
            const configure = jest.fn();
            window.electron = {
                sourceSyncConfigure: configure,
            } as unknown as typeof window.electron;
            globalThis.fetch = jest.fn();
            const component = fixture.componentInstance;
            component.urlControl.setValue(url);
            component.token = 'keep-token';
            await component.connect();
            fixture.detectChanges();
            expect(configure).not.toHaveBeenCalled();
            expect(globalThis.fetch).not.toHaveBeenCalled();
            expect(component.urlControl.touched).toBe(true);
            expect(component.urlControl.invalid).toBe(true);
            expect(component.token).toBe('keep-token');
            expect(
                fixture.nativeElement.querySelector('mat-error').textContent
            ).toContain('SOURCE_SYNC.URL_INVALID');
        }
    );

    it('announces a pending connection, prevents duplicate attempts and keeps input after network failure', async () => {
        let reject!: (error: Error) => void;
        const configure = jest.fn().mockImplementation(
            () =>
                new Promise((_resolve, fail) => {
                    reject = fail;
                })
        );
        window.electron = {
            sourceSyncConfigure: configure,
        } as unknown as typeof window.electron;
        const component = fixture.componentInstance;
        component.token = 'keep-token';
        const pending = component.connect();
        await component.connect();
        fixture.detectChanges();
        expect(configure).toHaveBeenCalledTimes(1);
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="source-server-connect"]'
            ).textContent
        ).toContain('SOURCE_SYNC.STATE_connecting');
        expect(
            fixture.nativeElement.querySelector(
                '[role="status"][data-test-id="source-server-message"]'
            ).textContent
        ).toContain('SOURCE_SYNC.STATE_connecting');
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="source-server-url"]'
            ).readOnly
        ).toBe(true);
        reject(new Error('SOURCE_SYNC.OFFLINE'));
        await pending;
        fixture.detectChanges();
        expect(component.message()).toBe('SOURCE_SYNC.CONNECTION_FAILED');
        expect(component.token).toBe('keep-token');
        expect(component.busy()).toBe(false);
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="source-server-url"]'
            ).readOnly
        ).toBe(false);
    });

    it('links directly to client setup instructions', () => {
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="source-server-help"]'
            ).href
        ).toBe(
            'https://github.com/4gray/iptvnator/blob/master/docker/README.md#connect-your-clients'
        );
    });

    it.each([401, 403])(
        'identifies an access challenge during discovery (%s)',
        async (status) => {
            window.electron = {} as typeof window.electron;
            globalThis.fetch = jest
                .fn()
                .mockResolvedValue({ ok: false, status });
            fixture.componentInstance.token = 'keep-token';
            await fixture.componentInstance.connect();
            expect(fixture.componentInstance.message()).toBe(
                'SOURCE_SYNC.LOCKED'
            );
            expect(fixture.componentInstance.token).toBe('keep-token');
        }
    );

    it('identifies an incompatible response without exposing its body', async () => {
        window.electron = {} as typeof window.electron;
        fixture.componentInstance.urlControl.setValue('https://other-nas.test');
        globalThis.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () =>
                Promise.reject(new SyntaxError('private server response')),
        });
        await fixture.componentInstance.connect();
        expect(fixture.componentInstance.message()).toBe(
            'SOURCE_SYNC.INCOMPATIBLE'
        );
    });

    it.each(['https://nas.test/backend', 'http://127.0.0.1:3347'])(
        'preserves the selected API base %s when updating credentials',
        async (apiUrl) => {
            const configure = jest.fn().mockResolvedValue({});
            window.electron = {
                sourceSyncConfigure: configure,
            } as unknown as typeof window.electron;
            const original = activeConnection.apiUrl;
            try {
                activeConnection.apiUrl = apiUrl;
                fixture.componentInstance.urlControl.setValue(apiUrl);
                fixture.componentInstance.token = 'renewed-token';
                await fixture.componentInstance.connect();
                expect(configure).toHaveBeenCalledWith(
                    apiUrl,
                    'renewed-token',
                    false,
                    undefined
                );
            } finally {
                activeConnection.apiUrl = original;
            }
        }
    );

    it.each(['native', 'browser'])(
        'refreshes an unchanged %s connection without replacing its token or reloading',
        async (runtime) => {
            const configure = jest.fn();
            window.electron = (
                runtime === 'native' ? { sourceSyncConfigure: configure } : {}
            ) as typeof window.electron;
            globalThis.fetch = jest.fn();
            fixture.componentInstance.urlControl.setValue('https://nas.test');
            await fixture.componentInstance.connect();
            expect(sync.refresh).toHaveBeenCalledTimes(1);
            expect(configure).not.toHaveBeenCalled();
            expect(globalThis.fetch).not.toHaveBeenCalled();
            fixture.detectChanges();
            expect(
                fixture.nativeElement.querySelector(
                    '[data-test-id="source-server-connect"]'
                ).disabled
            ).toBe(true);
        }
    );

    it('returns to the retained native profile when disconnected', async () => {
        const disconnect = jest.fn().mockResolvedValue(undefined);
        window.electron = {
            sourceSyncDisconnect: disconnect,
        } as unknown as typeof window.electron;
        await fixture.componentInstance.disconnect();
        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(requestSourceServer).not.toHaveBeenCalled();
    });

    it('shows a saved native connection without a token field value and reconnects to its instance', async () => {
        const configure = jest.fn().mockResolvedValue(undefined);
        window.electron = {
            sourceSyncConfigure: configure,
            sourceSyncSavedConnection: () => ({
                ...activeConnection,
                hasToken: true,
            }),
        } as unknown as typeof window.electron;
        const disconnected = createDisconnectedSettings();
        const component = disconnected.componentInstance;

        expect(component.token).toBe('');
        expect(component.urlControl.value).toBe(activeConnection.apiUrl);
        expect(disconnected.nativeElement.textContent).toContain(
            'SOURCE_SYNC.RECONNECT'
        );
        await component.connect();

        expect(configure).toHaveBeenCalledWith(
            activeConnection.apiUrl,
            '',
            true,
            activeConnection.instanceId
        );
    });

    it('clears the forgotten browser selection and restores focus to the address', async () => {
        window.electron = {} as typeof window.electron;
        saveBrowserSourceConnection(activeConnection, 'synthetic-token');
        disconnectBrowserSourceConnection();
        const disconnected = createDisconnectedSettings();
        const component = disconnected.componentInstance;
        const root = disconnected.nativeElement as HTMLElement;
        const input = root.querySelector<HTMLInputElement>(
            '[data-test-id="source-server-url"]'
        );
        if (!input) throw new Error('Expected a server address input');

        await component.forgetServer(input);
        disconnected.detectChanges();

        expect(component.urlControl.value).toBe('');
        expect(component.savedConnection()).toBeNull();
        expect(document.activeElement).toBe(input);
    });

    it('keeps edited settings while forgetting the previous native server', async () => {
        const forget = jest
            .fn()
            .mockRejectedValueOnce(new Error('Storage unavailable'))
            .mockResolvedValueOnce(undefined);
        window.electron = {
            sourceSyncConfigure: jest.fn(),
            sourceSyncSavedConnection: () => ({
                ...activeConnection,
                hasToken: true,
            }),
            sourceSyncForget: forget,
        } as unknown as typeof window.electron;
        const { componentInstance: component } = createDisconnectedSettings();
        component.urlControl.setValue('https://other.test/api');
        component.token = 'new-token';
        const input = document.createElement('input');

        await component.forgetServer(input);
        expect(component.savedConnection()?.apiUrl).toBe(
            activeConnection.apiUrl
        );
        expect(component.message()).toBe('SOURCE_SYNC.REQUEST_FAILED');

        await component.forgetServer(input);
        expect(component.savedConnection()).toBeNull();
        expect(component.urlControl.value).toBe('https://other.test/api');
        expect(component.token).toBe('new-token');
    });
});
