import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import {
    type Playlist,
    type SourceServerConnection,
} from '@iptvnator/shared/interfaces';
import {
    SourceSyncService,
    disconnectBrowserSourceConnection,
    saveBrowserSourceConnection,
} from '@iptvnator/services/source-sync';
import { SettingsServerSectionComponent } from './settings-server-section.component';
import type { AndroidLibraryControls } from '@iptvnator/services';

const readLocalSourcesForImport = jest.fn();
const requestSourceServer = jest.fn();

describe('source server settings', () => {
    let fixture: ComponentFixture<
        InstanceType<typeof SettingsServerSectionComponent>
    >;
    const originalElectron = window.electron;
    const originalFetch = globalThis.fetch;
    const originalAndroidShell = Object.getOwnPropertyDescriptor(
        window,
        '__tvShell'
    );
    const activeConnection = {
        apiUrl: 'https://nas.test/api',
        instanceId: 'nas',
    };
    const sync = {
        connection: null as SourceServerConnection | null,
        connectionReadFailed: false,
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
        sync.connection = { ...activeConnection };
        sync.connectionReadFailed = false;
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
        if (originalAndroidShell) {
            Object.defineProperty(window, '__tvShell', originalAndroidShell);
        } else {
            Reflect.deleteProperty(window, '__tvShell');
        }
        TestBed.resetTestingModule();
    });

    function useAndroidShell(
        shell: {
            handheld: boolean;
            openSettingsSection?: jest.Mock;
        } & Partial<AndroidLibraryControls>,
        connection: SourceServerConnection | null
    ): void {
        fixture.destroy();
        sync.connection = connection;
        Object.defineProperty(window, '__tvShell', {
            configurable: true,
            value: {
                openDeviceSettings: jest.fn(),
                openExternal: jest.fn(),
                ...shell,
            },
        });
        fixture = TestBed.createComponent(SettingsServerSectionComponent);
        fixture.detectChanges();
    }

    function findControl(testId: string): HTMLElement | null {
        return fixture.nativeElement.querySelector(
            `[data-test-id="${testId}"]`
        );
    }

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

    describe('Android library connection', () => {
        const sameOriginConnection = {
            apiUrl: `${location.origin}/api`,
            instanceId: 'nas',
        };
        const openSettingsSection = jest.fn();

        it.each(['', 'https://library.example'])(
            'places native library actions inline for origin %s',
            (origin) => {
                const scanLibraryQr = jest.fn();
                const disconnectLibrary = jest.fn();
                useAndroidShell(
                    {
                        handheld: true,
                        openSettingsSection,
                        libraryConnection: () => ({
                            origin,
                            savedOrigin: origin,
                            canScanQr: true,
                        }),
                        scanLibraryQr,
                        disconnectLibrary,
                        pairLibrary: jest.fn(),
                        connectLibrary: jest.fn(),
                    },
                    origin
                        ? { apiUrl: origin + '/api', instanceId: 'host' }
                        : null
                );
                expect(findControl('android-library-connection')).toBeNull();
                const scan = findControl('android-library-scan');
                expect(scan?.textContent).toContain('SETTINGS.ANDROID_SCAN_QR');
                expect(scan?.closest('details')).toBeNull();
                expect(findControl('android-source-sync-options')).toBeNull();
                expect(
                    findControl('source-server-url')?.closest('details')
                ).toBeNull();
                expect(findControl('source-server-connect')).not.toBeNull();
                expect(findControl('source-server-token')).toBeNull();
                scan?.click();
                expect(scanLibraryQr).toHaveBeenCalledTimes(1);
                const disconnect = findControl('android-library-disconnect');
                if (origin) {
                    expect(fixture.componentInstance.urlControl.value).toBe(
                        origin
                    );
                    expect(findControl('android-library-address')).toBeNull();
                    expect(disconnect).not.toBeNull();
                    disconnect?.click();
                    expect(disconnectLibrary).toHaveBeenCalledTimes(1);
                } else {
                    expect(disconnect).toBeNull();
                }
            }
        );

        it('reconnects to a saved server with the address shown separately', async () => {
            const origin = 'https://iptvnator-library.example';
            const connectLibrary = jest.fn();
            const removeLibraryPairing = jest.fn();
            useAndroidShell(
                {
                    handheld: true,
                    openSettingsSection,
                    libraryConnection: () => ({
                        origin: '',
                        savedOrigin: origin,
                        canScanQr: true,
                        paired: true,
                    }),
                    scanLibraryQr: jest.fn(),
                    disconnectLibrary: jest.fn(),
                    pairLibrary: jest.fn(),
                    connectLibrary,
                    inspectServer: jest.fn().mockResolvedValue('reconnect'),
                    removeLibraryPairing,
                },
                null
            );

            expect(findControl('android-library-state')?.textContent).toContain(
                'SETTINGS.ANDROID_LOCAL_LIBRARY'
            );
            expect(fixture.componentInstance.urlControl.value).toBe(origin);
            expect(findControl('android-library-address')).toBeNull();
            const reconnect = findControl('source-server-connect');
            expect(reconnect?.textContent?.trim()).toBe(
                'SOURCE_SYNC.RECONNECT'
            );
            expect(
                reconnect?.classList.contains('settings-primary-button')
            ).toBe(true);
            reconnect?.click();
            await fixture.whenStable();
            fixture.detectChanges();
            expect(connectLibrary).toHaveBeenCalledWith(origin);

            const removePairing = findControl('android-library-remove-pairing');
            const options = removePairing?.closest('details');
            expect(options?.open).toBe(false);
            if (options) options.open = true;
            removePairing?.click();
            expect(removeLibraryPairing).toHaveBeenCalledTimes(1);

            expect(
                findControl('source-server-url')?.closest('details')
            ).toBeNull();
            expect(
                findControl('source-server-connect')?.closest('details')
            ).toBeNull();
        });

        function useInlineLibrary(
            connection: SourceServerConnection | null = null,
            connectNasLibrary?: AndroidLibraryControls['connectNasLibrary']
        ) {
            const shell = {
                handheld: true,
                openSettingsSection,
                libraryConnection: () => ({
                    origin: '',
                    savedOrigin: '',
                    canScanQr: true,
                }),
                inspectServer: jest.fn(),
                connectNasLibrary,
                scanLibraryQr: jest.fn(),
                disconnectLibrary: jest.fn(),
                pairLibrary: jest.fn(),
                connectLibrary: jest.fn(),
            };
            useAndroidShell(shell, connection);
            return shell;
        }

        it('asks for a token only for the inspected address and clears it on an edit', async () => {
            const shell = useInlineLibrary();
            const component = fixture.componentInstance;
            component.urlControl.setValue('https://nas.test/share/');
            shell.inspectServer.mockResolvedValue('token');
            globalThis.fetch = jest.fn();
            await component.connect();
            fixture.detectChanges();
            expect(shell.inspectServer).toHaveBeenCalledWith(
                'https://nas.test/share/api'
            );
            expect(findControl('source-server-token')).not.toBeNull();
            expect(globalThis.fetch).not.toHaveBeenCalled();
            component.token = 'synthetic-token';
            component.urlControl.setValue('https://new.example');
            fixture.detectChanges();
            expect(component.token).toBe('');
            expect(findControl('source-server-token')).toBeNull();
            shell.inspectServer.mockResolvedValue('unknown');
            await component.connect();
            expect(component.message()).toBe('SOURCE_SYNC.CONNECTION_FAILED');
            expect(shell.pairLibrary).not.toHaveBeenCalled();
            expect(globalThis.fetch).not.toHaveBeenCalled();
        });

        it('pairs an Electron library and routes an Access library to the native sign-in', async () => {
            const shell = useInlineLibrary();
            const component = fixture.componentInstance;
            component.urlControl.setValue('https://library.example/api');
            const advanced: HTMLInputElement =
                fixture.nativeElement.querySelector(
                    '.server-disclosure input[type="url"]'
                );
            advanced.value = 'https://approval.example';
            advanced.dispatchEvent(new Event('input'));
            shell.inspectServer.mockResolvedValue('pair');
            await component.connect();
            expect(shell.pairLibrary).toHaveBeenCalledWith(
                'https://library.example',
                'https://approval.example'
            );
            shell.inspectServer.mockResolvedValue('access');
            await component.connect();
            expect(shell.connectLibrary).toHaveBeenCalledWith(
                'https://library.example'
            );
            expect(component.message()).toBe(
                'SETTINGS.ANDROID_ACCESS_INVITE_REQUIRED'
            );
            fixture.detectChanges();
            expect(findControl('source-server-token')).toBeNull();
        });

        it('ignores an inspection completed after editing the address', async () => {
            const shell = useInlineLibrary();
            const component = fixture.componentInstance;
            component.urlControl.setValue('https://previous.example');
            let finish!: (kind: string) => void;
            shell.inspectServer.mockReturnValue(
                new Promise((resolve) => (finish = resolve))
            );
            const pending = component.connect();
            component.urlControl.setValue('https://new.example');
            finish('pair');
            await pending;
            expect(shell.pairLibrary).not.toHaveBeenCalled();
        });

        it('shows an active NAS address without reporting a local library', () => {
            useInlineLibrary(activeConnection);
            expect(findControl('android-library-state')).toBeNull();
            expect(fixture.componentInstance.urlControl.value).toBe(
                activeConnection.apiUrl
            );
            fixture.componentInstance.urlControl.setValue(
                'https://new.example'
            );
            fixture.detectChanges();
            expect(
                findControl('android-library-address')?.textContent
            ).toContain(activeConnection.apiUrl);
            expect(findControl('source-server-disconnect')).not.toBeNull();
        });

        it('opens the hosted player explicitly using the main field and refuses subpaths', () => {
            const shell = useInlineLibrary();
            const component = fixture.componentInstance;
            component.urlControl.setValue('https://library.example');
            fixture.detectChanges();
            const action = findControl('android-open-hosted-player');
            expect(action?.closest('details')).not.toBeNull();
            action?.click();
            expect(shell.connectLibrary).toHaveBeenCalledWith(
                'https://library.example'
            );
            component.urlControl.setValue('https://library.example/nas');
            fixture.detectChanges();
            action?.click();
            expect(shell.connectLibrary).toHaveBeenCalledTimes(1);
            expect(component.message()).toBe('SOURCE_SYNC.URL_INVALID');
            expect(shell.inspectServer).not.toHaveBeenCalled();
        });

        it('restores the saved token only after checking the selected NAS instance', async () => {
            const access = 'synthetic-access';
            saveBrowserSourceConnection(activeConnection, access);
            disconnectBrowserSourceConnection();
            try {
                const shell = useInlineLibrary();
                shell.inspectServer.mockResolvedValue('token');
                globalThis.fetch = jest
                    .fn()
                    .mockResolvedValueOnce({
                        ok: true,
                        json: async () => ({
                            service: 'iptvnator',
                            apiVersion: 1,
                            storage: 'server',
                            capabilities: ['sources-v1'],
                            auth: 'token',
                            instanceId: activeConnection.instanceId,
                        }),
                    })
                    .mockResolvedValueOnce({ ok: false, status: 401 });
                expect(findControl('source-server-token')).toBeNull();
                await fixture.componentInstance.connect();
                fixture.detectChanges();
                expect(globalThis.fetch).toHaveBeenLastCalledWith(
                    activeConnection.apiUrl + '/v1/sources',
                    expect.objectContaining({
                        headers: {
                            Authorization: 'Bearer ' + access,
                            'X-IPTVnator-Instance-Id':
                                activeConnection.instanceId,
                        },
                    })
                );
                expect(findControl('source-server-token')).not.toBeNull();
                expect(fixture.componentInstance.token).toBe('');
                expect(fixture.componentInstance.message()).toBe(
                    'SOURCE_SYNC.LOCKED'
                );
            } finally {
                await fixture.componentInstance.forgetServer(null);
                localStorage.removeItem('iptvnator:source-server-disabled');
            }
        });

        it('uses the source API and stores an authenticated NAS connection', async () => {
            const shell = useInlineLibrary(activeConnection);
            const component = fixture.componentInstance;
            sync.state.set('locked');
            shell.inspectServer.mockResolvedValue('token');
            component.token = 'synthetic-access';
            globalThis.fetch = jest
                .fn()
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({
                        service: 'iptvnator',
                        apiVersion: 1,
                        storage: 'server',
                        auth: 'token',
                        instanceId: activeConnection.instanceId,
                        capabilities: ['sources-v1'],
                    }),
                })
                .mockResolvedValueOnce({ ok: true });
            try {
                await component.connect();
                expect(component.message()).toBe('');
                expect(component.token).toBe('');
                expect(
                    JSON.parse(
                        localStorage.getItem('iptvnator:source-server') ??
                            'null'
                    )
                ).toEqual(activeConnection);
                expect(sync.refresh).toHaveBeenCalledTimes(1);
                expect(shell.connectLibrary).not.toHaveBeenCalled();
            } finally {
                disconnectBrowserSourceConnection(false);
            }
        });

        it.each(['offline', 'locked'])(
            'moves a previously selected %s NAS into the native connection flow',
            async (state) => {
                const connectNasLibrary = jest.fn();
                const shell = useInlineLibrary(
                    activeConnection,
                    connectNasLibrary
                );
                shell.inspectServer.mockResolvedValue('token');
                sync.state.set(state);
                fixture.detectChanges();
                expect(findControl('source-server-token')).toBeNull();
                await fixture.componentInstance.connect();
                expect(connectNasLibrary).toHaveBeenCalledWith(
                    activeConnection.apiUrl,
                    true
                );
                expect(sync.refresh).not.toHaveBeenCalled();
            }
        );

        it('rechecks an active offline NAS with its current credentials', async () => {
            const shell = useInlineLibrary(activeConnection);
            sync.state.set('offline');
            await fixture.componentInstance.connect();
            expect(sync.refresh).toHaveBeenCalledTimes(1);
            expect(shell.inspectServer).not.toHaveBeenCalled();
            expect(findControl('source-server-token')).toBeNull();
        });

        it('opens native Server settings and omits the browser connection form for a local library', () => {
            sync.state.set('local');
            useAndroidShell({ handheld: true, openSettingsSection }, null);

            const action = findControl('android-library-connection');
            expect(action?.textContent).toContain(
                'SETTINGS.ANDROID_LIBRARY_CONNECTION'
            );
            action?.click();
            expect(openSettingsSection).toHaveBeenCalledWith('server');
            expect(findControl('source-server-url')).toBeNull();
            expect(findControl('source-server-token')).toBeNull();
            expect(findControl('source-server-connect')).toBeNull();
            expect(findControl('source-server-disconnect')).toBeNull();
        });

        it('keeps shared-library actions and shows the access token if the hosted library locks', () => {
            useAndroidShell(
                { handheld: true, openSettingsSection },
                sameOriginConnection
            );

            expect(findControl('source-server-refresh')).not.toBeNull();
            expect(findControl('source-server-import')).not.toBeNull();
            expect(findControl('source-server-token')).toBeNull();
            expect(findControl('source-server-connect')).toBeNull();
            expect(findControl('source-server-disconnect')).toBeNull();

            sync.state.set('locked');
            fixture.detectChanges();
            expect(findControl('source-server-url')).toBeNull();
            expect(findControl('source-server-token')).not.toBeNull();
            expect(findControl('source-server-connect')).not.toBeNull();
            expect(findControl('source-server-disconnect')).toBeNull();
        });

        it('opens the direct source sync form on demand from a local library', () => {
            sync.state.set('local');
            useAndroidShell({ handheld: true, openSettingsSection }, null);

            const options = findControl('android-source-sync-options');
            expect(options?.getAttribute('aria-expanded')).toBe('false');
            options?.click();
            fixture.detectChanges();
            expect(options?.getAttribute('aria-expanded')).toBe('true');
            expect(findControl('source-server-url')).not.toBeNull();
            expect(findControl('source-server-token')).not.toBeNull();
            expect(findControl('source-server-connect')).not.toBeNull();
            options?.click();
            fixture.detectChanges();
            expect(findControl('source-server-url')).toBeNull();
        });

        it('disconnects a paired hosted library through Android in TV layout', async () => {
            const disconnectLibrary = jest.fn().mockReturnValue(true);
            useAndroidShell(
                { handheld: false, disconnectLibrary },
                sameOriginConnection
            );
            localStorage.setItem(
                'iptvnator:source-server',
                JSON.stringify(sameOriginConnection)
            );
            try {
                findControl('source-server-disconnect')?.click();
                await fixture.whenStable();
                expect(disconnectLibrary).toHaveBeenCalledTimes(1);
                expect(localStorage.getItem('iptvnator:source-server')).toBe(
                    JSON.stringify(sameOriginConnection)
                );
            } finally {
                localStorage.removeItem('iptvnator:source-server');
                localStorage.removeItem('iptvnator:source-server-disabled');
            }
        });

        it('retains editable address and disconnect for a different source server', () => {
            useAndroidShell(
                { handheld: true, openSettingsSection },
                activeConnection
            );

            expect(findControl('android-library-connection')).not.toBeNull();
            expect(findControl('source-server-url')).not.toBeNull();
            expect(findControl('source-server-connect')).not.toBeNull();
            expect(findControl('source-server-disconnect')).not.toBeNull();
        });

        it('keeps source reconnect and disconnect available after a server identity change', () => {
            useAndroidShell(
                { handheld: true, openSettingsSection },
                sameOriginConnection
            );
            sync.errorKey.set('SOURCE_SYNC.INSTANCE_CHANGED');
            fixture.detectChanges();

            expect(findControl('source-server-url')).not.toBeNull();
            expect(findControl('source-server-connect')).not.toBeNull();
            expect(findControl('source-server-disconnect')).not.toBeNull();
        });

        it('keeps source recovery controls for an unreadable connection', () => {
            sync.connectionReadFailed = true;
            useAndroidShell({ handheld: true, openSettingsSection }, null);

            expect(findControl('source-server-url')).not.toBeNull();
            expect(findControl('source-server-disconnect')).not.toBeNull();
        });

        it.each([
            ['older phone shells', { handheld: true }],
            ['TV shells', { handheld: false, openSettingsSection }],
        ] as const)(
            'keeps the source connection form on %s',
            (_runtime, shell) => {
                useAndroidShell(shell, sameOriginConnection);

                expect(findControl('android-library-connection')).toBeNull();
                expect(findControl('source-server-url')).not.toBeNull();
                expect(findControl('source-server-connect')).not.toBeNull();
            }
        );
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
            const connection = sync.connection!;
            const original = connection.apiUrl;
            try {
                connection.apiUrl = apiUrl;
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
                connection.apiUrl = original;
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
