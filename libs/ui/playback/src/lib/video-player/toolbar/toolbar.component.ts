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
    FavoritesActions,
    selectFavorites,
    selectIsEpgAvailable,
} from '@iptvnator/m3u-state';
import { Channel } from '@iptvnator/shared/interfaces';

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

    updateFavoriteStatus(channel: Channel) {
        this.store.dispatch(FavoritesActions.updateFavorites({ channel }));
    }
}
