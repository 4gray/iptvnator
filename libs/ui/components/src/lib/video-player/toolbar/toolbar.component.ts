import { AsyncPipe } from '@angular/common';
import { Component, inject, Input, output } from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltip } from '@angular/material/tooltip';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import {
    selectActivePlaylistId,
    selectFavorites,
    selectIsEpgAvailable,
    updateFavorites,
} from 'm3u-state';
import { Channel } from 'shared-interfaces';

@Component({
    imports: [
        AsyncPipe,
        MatButton,
        MatDialogModule,
        MatIcon,
        MatIconButton,
        MatToolbarModule,
        MatTooltip,
        TranslatePipe,
    ],
    selector: 'app-toolbar',
    templateUrl: './toolbar.component.html',
    styleUrls: ['./toolbar.component.scss'],
})
export class ToolbarComponent {
    @Input() activeChannel!: Channel;
    @Input() isLeftDrawerOpened = true;
    readonly infoOverlayClicked = output<void>();
    readonly multiEpgClicked = output<void>();
    readonly settingsClicked = output<void>();
    readonly toggleLeftDrawerClicked = output<void>();
    readonly toggleRightDrawerClicked = output<void>();

    private readonly store = inject(Store);

    readonly favorites$ = this.store.select(selectFavorites);
    readonly isEpgAvailable$ = this.store.select(selectIsEpgAvailable);
    readonly playlistId$ = this.store.select(selectActivePlaylistId);

    updateFavoriteStatus(channel: Channel) {
        this.store.dispatch(updateFavorites({ channel }));
    }
}
