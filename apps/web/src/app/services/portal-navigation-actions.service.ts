import { inject, Injectable, Provider } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { PlaylistInfoComponent } from 'components';
import {
    PORTAL_NAVIGATION_ACTIONS,
    PortalNavigationActions,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { Playlist } from 'shared-interfaces';
import { SettingsComponent } from '../settings/settings.component';
import { AccountInfoComponent } from '../xtream-electron/account-info/account-info.component';

@Injectable({ providedIn: 'root' })
export class AppPortalNavigationActionsService
    implements PortalNavigationActions
{
    private readonly dialog = inject(MatDialog);
    private readonly xtreamStore = inject(XtreamStore);

    openAccountInfo(): void {
        this.dialog.open(AccountInfoComponent, {
            width: '80%',
            maxWidth: '1200px',
            maxHeight: '90vh',
            data: {
                vodStreamsCount: this.xtreamStore.vodStreams().length,
                liveStreamsCount: this.xtreamStore.liveStreams().length,
                seriesCount: this.xtreamStore.serialStreams().length,
            },
        });
    }

    openPlaylistInfo(playlist: Playlist | null | undefined): void {
        this.dialog.open(PlaylistInfoComponent, {
            data: playlist ?? null,
        });
    }

    openSettings(): void {
        this.dialog.open(SettingsComponent, {
            width: '1200px',
            maxWidth: '96vw',
            maxHeight: '92vh',
            data: {
                isDialog: true,
            },
        });
    }
}

export function providePortalNavigationActions(): Provider[] {
    return [
        AppPortalNavigationActionsService,
        {
            provide: PORTAL_NAVIGATION_ACTIONS,
            useExisting: AppPortalNavigationActionsService,
        },
    ];
}
