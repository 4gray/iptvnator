import { DragDropModule } from '@angular/cdk/drag-drop';
import { NgStyle } from '@angular/common';
import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    EventEmitter,
    inject,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    Output,
    SimpleChanges,
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
export class ChannelListItemComponent implements OnInit, OnChanges, OnDestroy {
    private readonly cdr = inject(ChangeDetectorRef);
    private readonly dialog = inject(MatDialog);

    @Input() isDraggable = false;
    @Input() logo!: string;
    @Input() name = '';
    @Input() showFavoriteButton = false;
    @Input() selected = false;
    @Input() showEpg = true;
    @Input() epgProgram?: EpgProgram | null;

    @Output() clicked = new EventEmitter<void>();
    @Output() favoriteToggled = new EventEmitter<MouseEvent>();

    progressPercentage = 0;
    private progressInterval?: number;

    ngOnInit(): void {
        this.calculateProgress();
        // Update progress every 30 seconds
        this.progressInterval = window.setInterval(() => {
            this.calculateProgress();
        }, 30000);
    }

    ngOnChanges(changes: SimpleChanges): void {
        // Recalculate progress when epgProgram changes
        if (changes['epgProgram']) {
            this.calculateProgress();
        }
    }

    ngOnDestroy(): void {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
        }
    }

    /**
     * Calculates the progress percentage for the EPG program
     */
    private calculateProgress(): void {
        if (!this.epgProgram) {
            this.progressPercentage = 0;
            return;
        }

        const now = new Date().getTime();
        const start = new Date(this.epgProgram.start).getTime();
        const stop = new Date(this.epgProgram.stop).getTime();

        const total = stop - start;
        const elapsed = now - start;

        this.progressPercentage = Math.min(
            100,
            Math.max(0, (elapsed / total) * 100)
        );
        this.cdr.markForCheck();
    }

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
