import { DragDropModule } from '@angular/cdk/drag-drop';
import { DatePipe, NgStyle } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    effect,
    inject,
    input,
    output,
    signal,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { EpgItemDescriptionComponent } from '@iptvnator/ui/epg';
import { EpgProgram } from '@iptvnator/shared/interfaces';

@Component({
    selector: 'app-channel-list-item',
    styleUrls: ['./channel-list-item.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './channel-list-item.component.html',
    imports: [
        DatePipe,
        DragDropModule,
        MatIcon,
        MatIconButton,
        MatTooltip,
        NgStyle,
        TranslatePipe,
    ],
})
export class ChannelListItemComponent {
    private readonly dialog = inject(MatDialog);
    private readonly logoFailed = signal(false);

    readonly isDraggable = input(false);
    readonly logo = input<string | null | undefined>('');
    readonly name = input('');
    readonly showFavoriteButton = input(false);
    readonly showAuxActionButton = input(false);
    readonly showProgramInfoButton = input(true);
    readonly showDetailsContextMenu = input(false);
    readonly isFavorite = input(false);
    readonly selected = input(false);
    readonly showEpg = input(true);
    readonly isRadio = input(false);
    readonly epgProgram = input<EpgProgram | null | undefined>();
    /** Progress percentage pre-computed by parent for performance */
    readonly progressPercentage = input(0);
    readonly auxActionIcon = input('delete');
    readonly auxActionTooltip = input('');

    readonly clicked = output<void>();
    readonly activated = output<void>();
    readonly favoriteToggled = output<MouseEvent>();
    readonly auxActionClicked = output<MouseEvent>();
    readonly contextMenuRequested = output<MouseEvent>();

    constructor() {
        effect(() => {
            this.logo();
            this.logoFailed.set(false);
        });
    }

    /**
     * Opens the dialog with details about the current EPG program
     * @param program EPG program to show details for
     * @param event Mouse event to stop propagation
     */
    showProgramDescription(program: EpgProgram, event: MouseEvent): void {
        event.stopPropagation();
        this.dialog.open(EpgItemDescriptionComponent, {
            data: program,
        });
    }

    onFavoriteClick(event: MouseEvent): void {
        event.stopPropagation();
        this.favoriteToggled.emit(event);
    }

    onAuxActionClick(event: MouseEvent): void {
        event.stopPropagation();
        this.auxActionClicked.emit(event);
    }

    onClick(event?: MouseEvent): void {
        if ((event?.detail ?? 1) > 1) {
            return;
        }

        this.clicked.emit();
    }

    onDoubleClick(): void {
        this.activated.emit();
    }

    onContextMenu(event: MouseEvent): void {
        if (!this.showDetailsContextMenu()) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.contextMenuRequested.emit(event);
    }

    showLogoFallback(): boolean {
        return !this.logo() || this.logoFailed();
    }

    onLogoError(event: Event): void {
        this.logoFailed.set(true);
        (event.target as HTMLImageElement | null)?.style.setProperty(
            'display',
            'none'
        );
    }
}
