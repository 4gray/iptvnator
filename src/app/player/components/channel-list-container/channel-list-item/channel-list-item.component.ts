import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
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
            <div matListItemAvatar class="channel-logo" *ngIf="logo">
                <img
                    [src]="logo"
                    width="48"
                    onerror="this.style.display='none'"
                />
            </div>
            <p matListItemLine class="channel-name">
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
        </mat-list-item>
        <mat-divider></mat-divider>`,
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
