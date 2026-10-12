import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PlaylistRefreshActionService } from '@iptvnator/playlist/shared/ui';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { XTREAM_LOCAL_LOAD_OVERLAY_DELAY_MS } from './helpers/workspace-shell-constants';
import { WorkspaceShellRouteStateService } from './workspace-shell-route-state.service';
import { WorkspaceShellXtreamImportService } from './workspace-shell-xtream-import.service';

describe('WorkspaceShellXtreamImportService', () => {
    it('re-words the import overlay after a runtime language switch', () => {
        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot()],
            providers: [
                WorkspaceShellXtreamImportService,
                {
                    provide: XtreamStore,
                    useValue: {
                        getImportCount: signal(0),
                        itemsToImport: signal(0),
                        activeImportContentType: signal(null),
                        activeImportCurrentCount: signal(0),
                        activeImportTotalCount: signal(0),
                        currentImportPhase: signal(null),
                        isCancellingImport: signal(false),
                    },
                },
                {
                    provide: PlaylistRefreshActionService,
                    useValue: { refreshPreparation: signal(null) },
                },
                { provide: RuntimeCapabilitiesService, useValue: {} },
                { provide: WorkspaceShellRouteStateService, useValue: {} },
            ],
        });
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            WORKSPACE: { SHELL: { XTREAM_IMPORT_TITLE: 'Importing' } },
        });
        translate.setTranslation('ru', {
            WORKSPACE: { SHELL: { XTREAM_IMPORT_TITLE: 'Импорт' } },
        });
        translate.use('en');
        // The shell provides this service, so it outlives the Settings
        // visit where the language is switched.
        const service = TestBed.inject(WorkspaceShellXtreamImportService);

        expect(service.xtreamImportTitleLabel()).toBe('Importing');

        translate.use('ru');

        expect(service.xtreamImportTitleLabel()).toBe('Импорт');
    });

    describe('import overlay visibility', () => {
        const activeImportSessionId = signal<string | null>(null);
        const isImporting = signal(false);
        const refreshPreparation = signal<{ playlistId: string } | null>(
            null
        );
        let service: WorkspaceShellXtreamImportService;

        beforeEach(() => {
            jest.useFakeTimers();
            activeImportSessionId.set(null);
            isImporting.set(false);
            refreshPreparation.set(null);
            TestBed.configureTestingModule({
                imports: [TranslateModule.forRoot()],
                providers: [
                    WorkspaceShellXtreamImportService,
                    {
                        provide: XtreamStore,
                        useValue: {
                            activeImportSessionId,
                            isImporting,
                            contentInitBlockReason: signal(null),
                        },
                    },
                    {
                        provide: PlaylistRefreshActionService,
                        useValue: { refreshPreparation },
                    },
                    { provide: RuntimeCapabilitiesService, useValue: {} },
                    {
                        provide: WorkspaceShellRouteStateService,
                        useValue: {
                            currentRoute: signal({ kind: 'xtreams' }),
                            currentContext: signal({
                                provider: 'xtreams',
                                playlistId: 'portal-1',
                            }),
                            currentSection: signal('vod'),
                        },
                    },
                ],
            });
            service = TestBed.inject(WorkspaceShellXtreamImportService);
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        /** Lets the delay effect react, then advances the fake clock. */
        function advance(ms: number): void {
            TestBed.tick();
            jest.advanceTimersByTime(ms);
            TestBed.tick();
        }

        it('never shows the overlay for a saved-catalog load that finishes quickly', () => {
            // A warm open: the session starts and only reads SQLite
            // ('loading-cached' leaves isImporting false).
            activeImportSessionId.set('session-1');
            advance(XTREAM_LOCAL_LOAD_OVERLAY_DELAY_MS - 1);
            expect(service.showXtreamImportOverlay()).toBe(false);

            activeImportSessionId.set(null);
            advance(XTREAM_LOCAL_LOAD_OVERLAY_DELAY_MS);
            expect(service.showXtreamImportOverlay()).toBe(false);
        });

        it('shows the overlay once a saved-catalog load outlasts the delay', () => {
            activeImportSessionId.set('session-1');
            advance(XTREAM_LOCAL_LOAD_OVERLAY_DELAY_MS);
            expect(service.showXtreamImportOverlay()).toBe(true);

            activeImportSessionId.set(null);
            advance(0);
            expect(service.showXtreamImportOverlay()).toBe(false);
        });

        it('restarts the delay for the next load', () => {
            activeImportSessionId.set('session-1');
            advance(XTREAM_LOCAL_LOAD_OVERLAY_DELAY_MS);
            activeImportSessionId.set(null);
            advance(0);

            activeImportSessionId.set('session-2');
            advance(0);
            expect(service.showXtreamImportOverlay()).toBe(false);
        });

        it('shows the overlay at once for a remote import', () => {
            activeImportSessionId.set('session-1');
            advance(0);
            expect(service.showXtreamImportOverlay()).toBe(false);

            // A remote phase marks the session as a real import.
            isImporting.set(true);
            expect(service.showXtreamImportOverlay()).toBe(true);
        });

        it('keeps the delay while another playlist prepares a refresh', () => {
            refreshPreparation.set({ playlistId: 'other-playlist' });
            activeImportSessionId.set('session-1');
            advance(0);
            expect(service.showXtreamImportOverlay()).toBe(false);

            advance(XTREAM_LOCAL_LOAD_OVERLAY_DELAY_MS);
            expect(service.showXtreamImportOverlay()).toBe(true);
        });

        it('shows the overlay at once while a refresh prepares the playlist', () => {
            refreshPreparation.set({ playlistId: 'portal-1' });
            expect(service.showXtreamImportOverlay()).toBe(true);
        });
    });
});
