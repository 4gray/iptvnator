import { DragDropModule } from '@angular/cdk/drag-drop';
import { NgIf, NgStyle } from '@angular/common';
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
import { MatIcon } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { EpgProgram } from 'shared-interfaces';

@Component({
    selector: 'app-channel-list-item',
    styleUrls: ['./channel-list-item.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<div
        class="channel-list-item"
        [class.compact]="!showEpg"
        cdkDrag
        [cdkDragDisabled]="!isDraggable"
        cdkDragPreviewContainer="parent"
        [class.active]="selected"
        (click)="clicked.emit()"
        data-test-id="channel-item"
    >
        <mat-icon
            *ngIf="isDraggable"
            cdkDragHandle
            class="drag-icon"
            >drag_indicator</mat-icon
        >
        <div class="channel-content">
            <img
                class="channel-logo"
                *ngIf="logo"
                [src]="logo"
                onerror="this.style.display='none'"
                alt="Channel Logo"
            />
            <div class="channel-details">
                <div class="channel-name">{{ name }}</div>
                @if (showEpg) {
                    @if (epgProgram) {
                        <div class="epg-title">
                            {{ epgProgram.title?.[0]?.value }}
                        </div>
                        <div class="epg-timeline">
                            <span class="epg-time">{{ formatTime(epgProgram.start) }} - {{ formatTime(epgProgram.stop) }}</span>
                            <div class="epg-progress-track">
                                <div
                                    class="epg-progress-fill"
                                    [ngStyle]="{ width: progressPercentage + '%' }"
                                ></div>
                            </div>
                        </div>
                    } @else {
                        <div class="epg-placeholder">
                            {{ 'EPG.NO_PROGRAM_INFO' | translate }}
                        </div>
                    }
                }
            </div>
        </div>
        <button
            *ngIf="showFavoriteButton"
            mat-icon-button
            class="favorite-button"
            color="primary"
            [matTooltip]="'CHANNELS.REMOVE_FAVORITE' | translate"
            (click)="favoriteToggled.emit($event)"
        >
            <mat-icon color="accent">star</mat-icon>
        </button>
    </div>`,
    imports: [
        DragDropModule,
        MatIcon,
        MatIconButton,
        MatTooltip,
        NgIf,
        NgStyle,
        TranslatePipe,
    ],
})
export class ChannelListItemComponent implements OnInit, OnChanges, OnDestroy {
    private readonly cdr = inject(ChangeDetectorRef);

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
}
