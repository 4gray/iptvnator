import { DragDropModule } from '@angular/cdk/drag-drop';
import { NgStyle } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    EventEmitter,
    inject,
    Input,
    Output,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { EpgProgram } from 'shared-interfaces';
import { EpgItemDescriptionComponent } from '../../epg-list/epg-item-description/epg-item-description.component';

@Component({
    selector: 'app-channel-list-item',
    styleUrls: ['./channel-list-item.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './channel-list-item.component.html',
    imports: [
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

    @Input() isDraggable = false;
    @Input() logo!: string;
    @Input() name = '';
    @Input() showFavoriteButton = false;
    @Input() selected = false;
    @Input() showEpg = true;
    @Input() epgProgram?: EpgProgram | null;
    /** Progress percentage pre-computed by parent for performance */
    @Input() progressPercentage = 0;

    @Output() clicked = new EventEmitter<void>();
    @Output() favoriteToggled = new EventEmitter<MouseEvent>();

    /**
     * Formats time for display (HH:mm)
     */
    formatTime(dateString: string | number): string {
        const date = new Date(dateString);
        return date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
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
}
