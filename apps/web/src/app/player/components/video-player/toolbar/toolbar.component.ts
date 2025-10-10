import { AsyncPipe } from '@angular/common';
import { Component, EventEmitter, inject, Input, Output } from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltip } from '@angular/material/tooltip';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { Channel } from 'shared-interfaces';
import { SettingsComponent } from '../../../../settings/settings.component';
import { updateFavorites } from '../../../../state/actions';
import {
    selectActivePlaylistId,
    selectFavorites,
    selectIsEpgAvailable,
} from '../../../../state/selectors';

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
    @Output() multiEpgClicked = new EventEmitter<void>();
    @Output() toggleLeftDrawerClicked = new EventEmitter<void>();
    @Output() toggleRightDrawerClicked = new EventEmitter<void>();

    private readonly dialog = inject(MatDialog);
    private readonly store = inject(Store);

    readonly favorites$ = this.store.select(selectFavorites);
    readonly isEpgAvailable$ = this.store.select(selectIsEpgAvailable);
    readonly playlistId$ = this.store.select(selectActivePlaylistId);

    updateFavoriteStatus(channel: Channel) {
        this.store.dispatch(updateFavorites({ channel }));
    }

    openSettings() {
        this.dialog.open(SettingsComponent, {
            width: '1000px',
            height: '90%',
            data: { isDialog: true },
        });
    }
}
