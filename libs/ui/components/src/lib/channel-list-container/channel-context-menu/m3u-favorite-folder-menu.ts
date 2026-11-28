import { InjectionToken, type Signal } from '@angular/core';
import type { Channel } from '@iptvnator/shared/interfaces';
import type { FavoriteFolderMenuAction } from './channel-context-menu.component';

interface M3uFavoriteFolderMenu {
    readonly available: Signal<boolean>;
    action(channel: Channel | null): FavoriteFolderMenuAction | null;
    open(channel: Channel | null, action: FavoriteFolderMenuAction): void;
}

export const M3U_FAVORITE_FOLDER_MENU =
    new InjectionToken<M3uFavoriteFolderMenu>('M3U favorite folder menu');
