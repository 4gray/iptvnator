import { computed, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';
import { startWith } from 'rxjs';
import { PlaylistRefreshActionService } from '@iptvnator/playlist/shared/ui';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import type { XtreamImportPhaseTone } from './helpers/workspace-shell-constants';
import {
    buildXtreamImportDetailLabel,
    buildXtreamImportPhaseLabel,
    buildXtreamImportPhaseTone,
    buildXtreamImportProgressLabel,
    buildXtreamImportSourceLabel,
    buildXtreamImportTypeLabel,
    buildXtreamRefreshPreparationPhaseLabel,
    buildXtreamRefreshPreparationProgressLabel,
    formatLocalizedNumber,
} from './helpers/workspace-shell-import-labels';

@Injectable()
export class WorkspaceShellXtreamImportService {
    private readonly xtreamStore = inject(XtreamStore);
    private readonly playlistRefreshAction = inject(
        PlaylistRefreshActionService
    );
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly translate = inject(TranslateService);

    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );

    private get isElectron(): boolean {
        return this.runtime.isElectron;
    }

    private readonly translateText = (
        key: string,
        params?: Record<string, string | number>
    ): string => this.translate.instant(key, params);

    readonly xtreamImportCount = this.xtreamStore.getImportCount;
    readonly xtreamItemsToImport = this.xtreamStore.itemsToImport;
    readonly refreshPreparation = this.playlistRefreshAction.refreshPreparation;
    readonly activeRefreshPreparation = computed(
        () => this.refreshPreparation() ?? null
    );
    readonly xtreamActiveImportCount = computed(() => {
        const preparation = this.activeRefreshPreparation();
        return preparation
            ? (preparation.current ?? 0)
            : this.xtreamStore.activeImportCurrentCount();
    });
    readonly xtreamActiveItemsToImport = computed(() => {
        const preparation = this.activeRefreshPreparation();
        return preparation
            ? (preparation.total ?? 0)
            : this.xtreamStore.activeImportTotalCount();
    });
    readonly xtreamImportPhase = this.xtreamStore.currentImportPhase;
    readonly isCancellingXtreamImport = this.xtreamStore.isCancellingImport;

    readonly canCancelXtreamImport = computed(
        () =>
            this.isElectron &&
            this.xtreamStore.isImporting() &&
            Boolean(this.xtreamStore.activeImportSessionId()) &&
            !this.xtreamStore.isCancellingImport()
    );

    readonly xtreamImportTitleLabel = computed(() => {
        if (this.activeRefreshPreparation()) {
            return this.translateText('WORKSPACE.SHELL.XTREAM_REFRESH_TITLE');
        }

        return this.translateText('WORKSPACE.SHELL.XTREAM_IMPORT_TITLE');
    });

    readonly xtreamImportTypeLabel = computed(() => {
        this.languageTick();
        return buildXtreamImportTypeLabel(
            this.xtreamStore.activeImportContentType(),
            this.translateText
        );
    });

    readonly xtreamImportProgressLabel = computed(() => {
        const formatNumber = (value: number): string =>
            formatLocalizedNumber(
                value,
                this.translate.currentLang,
                this.translate.defaultLang
            );
        const preparation = this.activeRefreshPreparation();

        if (preparation) {
            return buildXtreamRefreshPreparationProgressLabel(
                this.xtreamActiveImportCount(),
                this.xtreamActiveItemsToImport(),
                this.translateText,
                formatNumber
            );
        }

        return buildXtreamImportProgressLabel(
            this.xtreamImportTypeLabel(),
            this.xtreamActiveImportCount(),
            this.xtreamActiveItemsToImport(),
            this.translateText,
            formatNumber
        );
    });

    readonly xtreamImportPhaseTone = computed<XtreamImportPhaseTone>(() => {
        if (this.activeRefreshPreparation()) {
            return 'local';
        }

        return buildXtreamImportPhaseTone(
            this.xtreamStore.currentImportPhase()
        );
    });

    readonly xtreamImportSourceLabel = computed(() => {
        this.languageTick();
        return buildXtreamImportSourceLabel(
            this.xtreamImportPhaseTone(),
            this.translateText
        );
    });

    readonly xtreamImportPhaseLabel = computed(() => {
        this.languageTick();
        const preparation = this.activeRefreshPreparation();

        if (preparation) {
            return buildXtreamRefreshPreparationPhaseLabel(
                preparation.phase,
                this.translateText
            );
        }

        return buildXtreamImportPhaseLabel(
            this.xtreamStore.currentImportPhase(),
            this.translateText
        );
    });

    readonly xtreamImportDetailLabel = computed(() => {
        this.languageTick();
        if (this.activeRefreshPreparation()) {
            return this.translateText(
                'WORKSPACE.SHELL.XTREAM_REFRESH_DETAIL_LOCAL'
            );
        }

        return buildXtreamImportDetailLabel(
            this.xtreamImportPhaseTone(),
            this.translateText
        );
    });

    readonly isImportRunning = computed(
        () =>
            !this.xtreamStore.contentInitBlockReason() &&
            this.xtreamStore.isImporting()
    );
    readonly isRefreshPreparationRunning = computed(() =>
        Boolean(this.activeRefreshPreparation())
    );

    isRefreshPreparationRunningForPlaylist(playlistId: string): boolean {
        return this.refreshPreparation()?.playlistId === playlistId;
    }

    cancelXtreamImport(): void {
        void this.xtreamStore.cancelImport();
    }
}
