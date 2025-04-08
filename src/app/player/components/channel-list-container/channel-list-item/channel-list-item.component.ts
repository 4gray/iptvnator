import { DragDropModule } from '@angular/cdk/drag-drop';
import { NgIf } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';

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
        DragDropModule,
        MatIcon,
        MatIconButton,
        MatListModule,
        MatTooltip,
        NgIf,
        TranslatePipe,
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
