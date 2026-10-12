import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PlaylistRefreshActionService } from '@iptvnator/playlist/shared/ui';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
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
});
