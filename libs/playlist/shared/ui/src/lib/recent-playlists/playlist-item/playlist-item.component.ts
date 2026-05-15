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
import { PortalStatus, PortalStatusService } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';

@Component({
    selector: 'app-playlist-item',
    templateUrl: './playlist-item.component.html',
    styleUrls: ['./playlist-item.component.scss'],
    imports: [
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
    private readonly translate = inject(TranslateService);
    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );

    readonly isElectron = !!window.electron;
    readonly currentLocale = computed(() => {
        this.languageTick();
        return normalizeDateLocale(
            this.translate.currentLang || this.translate.defaultLang
        );
    });

    async ngOnInit() {
        await this.checkPortalStatus();
    }

    private async checkPortalStatus() {
        if (this.item.serverUrl && this.item.username && this.item.password) {
            this.portalStatus = await this.portalStatusService.checkPortalStatus(
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
