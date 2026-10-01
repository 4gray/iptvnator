import { Injector } from '@angular/core';
import { SourceHealthService } from '@iptvnator/portal/shared/data-access';
import {
    PlaylistSourceIconKey,
    resolvePlaylistSourceIconKey,
    SOURCE_TYPE_ICONS,
    sourceHealthType,
} from '@iptvnator/shared/interfaces';
import { SourceHealthIndicatorComponent } from '../../source-health/source-health-indicator.component';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { DatePipe } from '@angular/common';
import {
    Component,
    Input,
    OnInit,
    computed,
    inject,
    input,
    output,
    ChangeDetectionStrategy,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltip } from '@angular/material/tooltip';
import { normalizeDateLocale } from '@iptvnator/pipes';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { startWith } from 'rxjs';
import {
    PortalStatus,
    PortalStatusService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';

@Component({
    selector: 'app-playlist-item',
    templateUrl: './playlist-item.component.html',
    styleUrls: ['./playlist-item.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [
        SourceHealthIndicatorComponent,
        DatePipe,
        DragDropModule,
        MatIconButton,
        MatIcon,
        MatProgressBarModule,
        MatProgressSpinnerModule,
        MatTooltip,
        TranslatePipe,
    ],
})
export class PlaylistItemComponent implements OnInit {
    @Input() item!: PlaylistMeta;
    readonly showActions = input(true);
    readonly isDraggable = input(false);
    readonly isSelected = input(false);
    readonly isRefreshing = input(false);
    readonly isDeleting = input(false);
    readonly busyMessage = input('');
    readonly busyProgress = input<number | null>(null);
    readonly canCancelBusyAction = input(false);
    readonly isBusy = computed(() => this.isRefreshing() || this.isDeleting());

    readonly editPlaylistClicked = output<PlaylistMeta>();
    readonly playlistClicked = output<string>();
    readonly refreshClicked = output<PlaylistMeta>();
    readonly removeClicked = output<string>();
    readonly cancelBusyActionClicked = output<void>();

    portalStatus: PortalStatus = 'unavailable';
    private readonly portalStatusService = inject(PortalStatusService);
    readonly runtime = inject(RuntimeCapabilitiesService);
    readonly sourceIcons = SOURCE_TYPE_ICONS;

    get sourceIconKey(): PlaylistSourceIconKey {
        return resolvePlaylistSourceIconKey(this.item);
    }

    /** Without source health, Xtream rows badge the portal status instead. */
    get showsPortalStatusDot(): boolean {
        return (
            this.sourceIconKey === 'xtream' &&
            !this.runtime.supportsSourceHealth
        );
    }

    /**
     * Auto-refresh re-fetches a URL or a local file, so any row with a URL
     * keeps the badge, whichever provider icon it shows.
     */
    get showsAutoRefresh(): boolean {
        return (
            !!this.item.autoRefresh &&
            (!!this.item.url || this.sourceIconKey === 'm3u-local')
        );
    }
    private readonly translate = inject(TranslateService);
    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );

    readonly supportsPlaylistRefresh = this.runtime.supportsPlaylistRefresh;
    readonly supportsXtreamSqliteDataSource =
        this.runtime.supportsXtreamSqliteDataSource;
    readonly currentLocale = computed(() => {
        this.languageTick();
        return normalizeDateLocale(
            this.translate.currentLang || this.translate.defaultLang
        );
    });

    private readonly healthInjector = inject(Injector);
    readonly sourceHealthType = sourceHealthType;
    recheckSource(): void {
        void this.healthInjector.get(SourceHealthService).recheck(this.item);
    }

    async ngOnInit() {
        if (!this.runtime.supportsSourceHealth) await this.checkPortalStatus();
    }

    private async checkPortalStatus() {
        if (this.item.serverUrl && this.item.username && this.item.password) {
            this.portalStatus =
                await this.portalStatusService.checkPortalStatus(
                    this.item.serverUrl,
                    this.item.username,
                    this.item.password
                );
        }
    }

    getStatusClass(): string {
        return this.portalStatusService.getStatusClass(this.portalStatus);
    }

    getStatusIcon(): string {
        return this.portalStatusService.getStatusIcon(this.portalStatus);
    }

    onPlaylistClick(): void {
        if (this.isBusy()) {
            return;
        }

        this.playlistClicked.emit(this.item._id);
    }
}
