import { DragDropModule } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';

@Component({
    standalone: true,
    selector: 'app-channel-list-item',
    styleUrls: ['./channel-list-item.component.scss'],
    template: `<mat-list-item
        cdkDrag
        [cdkDragDisabled]="!isDraggable"
        cdkDragPreviewContainer="parent"
        [class.active]="selected"
        (click)="clicked.emit()"
        data-test-id="channel-item"
    >
        <mat-icon
            *ngIf="isDraggable"
            matListItemIcon
            cdkDragHandle
            class="drag-icon"
            >drag_indicator</mat-icon
        >
        <img
            matListItemMeta
            class="channel-logo"
            *ngIf="logo"
            [src]="logo"
            width="42"
            onerror="this.style.display='none'"
        />
        <p matListItemTitle class="channel-name">
            {{ name }}
        </p>
        <button
            *ngIf="showFavoriteButton"
            mat-icon-button
            matListItemMeta
            color="primary"
            [matTooltip]="'CHANNELS.REMOVE_FAVORITE' | translate"
            (click)="favoriteToggled.emit($event)"
        >
            <mat-icon color="accent">star</mat-icon>
        </button>
    </mat-list-item>`,
    imports: [
        CommonModule,
        DragDropModule,
        MatButtonModule,
        MatDividerModule,
        MatIconModule,
        MatListModule,
        MatTooltipModule,
        TranslateModule,
    ],
})
export class ChannelListItemComponent {
    @Input() isDraggable = false;
    @Input() logo!: string;
    @Input() name = '';
    @Input() showFavoriteButton = false;
    @Input() selected = false;

    @Output() clicked = new EventEmitter<void>();
    @Output() favoriteToggled = new EventEmitter();
}
