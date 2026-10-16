import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
} from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    injectTranslationTick,
    XtreamSelectedCatalogRefreshService,
} from '@iptvnator/services';
import {
    DialogShellComponent,
    ImportProgressComponent,
    ImportProgressView,
} from '@iptvnator/ui/components';

const phaseKeys = {
    'loading-categories': 'WORKSPACE.SHELL.XTREAM_IMPORT_LOADING',
    'loading-content': 'WORKSPACE.SHELL.XTREAM_IMPORT_LOADING',
    preparing: 'WORKSPACE.SHELL.XTREAM_IMPORT_PREPARING',
    'saving-categories': 'WORKSPACE.SHELL.XTREAM_IMPORT_SAVING',
    'saving-content': 'WORKSPACE.SHELL.XTREAM_IMPORT_SAVING',
    restoring: 'WORKSPACE.SHELL.XTREAM_IMPORT_RESTORING_RECENT',
} as const;
const typeKeys = {
    live: 'PORTALS.LIVE_TV',
    movie: 'PORTALS.MOVIES',
    series: 'PORTALS.SERIES',
} as const;

/** Keep the editor modal open and show the same scanning UI as ordinary imports. */
@Component({
    selector: 'app-xtream-selection-progress',
    imports: [DialogShellComponent, ImportProgressComponent, TranslatePipe],
    template: `
        <app-dialog-shell
            icon="sync"
            [heading]="'WORKSPACE.SHELL.XTREAM_IMPORT_TITLE' | translate"
        >
            <app-import-progress [view]="view()" [inline]="true" />
        </app-dialog-shell>
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class XtreamSelectionProgressComponent {
    private readonly refresh = inject(XtreamSelectedCatalogRefreshService);
    private readonly translate = inject(TranslateService);
    private readonly languageTick = injectTranslationTick();
    readonly view = computed<ImportProgressView>(() => {
        this.languageTick();
        const state = this.refresh.progress();
        const remote =
            state?.phase === 'loading-categories' ||
            state?.phase === 'loading-content';
        const format = new Intl.NumberFormat(
            this.translate.currentLang || this.translate.defaultLang || 'en'
        );
        return {
            title: '',
            source: this.translate.instant(
                remote
                    ? 'WORKSPACE.SHELL.XTREAM_IMPORT_REMOTE_BADGE'
                    : 'WORKSPACE.SHELL.XTREAM_IMPORT_LOCAL_BADGE'
            ),
            phase: this.translate.instant(
                phaseKeys[state?.phase ?? 'preparing']
            ),
            detail: this.translate.instant(
                remote
                    ? 'WORKSPACE.SHELL.XTREAM_IMPORT_DETAIL_REMOTE'
                    : 'WORKSPACE.SHELL.XTREAM_IMPORT_DETAIL_LOCAL'
            ),
            tone: remote ? 'remote' : 'local',
            current: state?.current ?? 0,
            total: state?.total ?? 0,
            progress:
                state?.type && state.total > 0
                    ? this.translate.instant(
                          'WORKSPACE.SHELL.XTREAM_IMPORT_PROGRESS',
                          {
                              type: this.translate.instant(
                                  typeKeys[state.type]
                              ),
                              current: format.format(state.current),
                              total: format.format(state.total),
                          }
                      )
                    : state?.type
                      ? this.translate.instant(typeKeys[state.type])
                      : '',
        };
    });
}
