import { AsyncPipe, NgIf } from '@angular/common';
import { Component, NgZone, OnInit, Signal, effect } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { Observable } from 'rxjs';
import { IpcCommand } from '../../../shared/ipc-command.class';
import {
    ERROR,
    OPEN_MPV_PLAYER,
    OPEN_VLC_PLAYER,
    STALKER_REQUEST,
    STALKER_RESPONSE,
} from '../../../shared/ipc-commands';
import { StalkerPortalActions } from '../../../shared/stalker-portal-actions.enum';
import { DataService } from '../services/data.service';
import { PlaylistsService } from '../services/playlists.service';
import { Settings, VideoPlayer } from '../settings/settings.interface';
import { ExternalPlayerInfoDialogComponent } from '../shared/components/external-player-info-dialog/external-player-info-dialog.component';
import { STORE_KEY } from '../shared/enums/store-keys.enum';
import { selectCurrentPlaylist } from '../state/selectors';
import { Breadcrumb } from '../xtream/breadcrumb.interface';
import { CategoryContentViewComponent } from '../xtream/category-content-view/category-content-view.component';
import { CategoryViewComponent } from '../xtream/category-view/category-view.component';
import { ContentTypeNavigationItem } from '../xtream/content-type-navigation-item.interface';
import { ContentType } from '../xtream/content-type.enum';
import { NavigationBarComponent } from '../xtream/navigation-bar/navigation-bar.component';
import { PlayerDialogComponent } from '../xtream/player-dialog/player-dialog.component';
import { PortalStore } from '../xtream/portal.store';
import { VodDetailsComponent } from '../xtream/vod-details/vod-details.component';
import { StalkerContentTypes } from './stalker-content-types';

@Component({
    selector: 'app-stalker-main-container',
    templateUrl: './stalker-main-container.component.html',
    standalone: true,
    imports: [
        AsyncPipe,
        CategoryViewComponent,
        CategoryContentViewComponent,
        NavigationBarComponent,
        NgIf,
        MatPaginatorModule,
        VodDetailsComponent,
    ],
})
export class StalkerMainContainerComponent implements OnInit {
    breadcrumbs: Breadcrumb[] = [];
    currentPlaylist = this.store.selectSignal(selectCurrentPlaylist);
    listeners = [];
    isLoading = true;
    selectedContentType: ContentType = ContentType.VODS;
    currentLayout = 'category';
    searchPhrase = this.portalStore.searchPhrase();
    settings = toSignal(
        this.storage.get(STORE_KEY.Settings)
    ) as Signal<Settings>;
    favorites$: Observable<any>;

    items: any[] = [];
    itemDetails!: {
        id: string;
        cmd: string;
        info: {
            movie_image: string;
            description: string;
            name: string;
            actors: string;
            director: string;
            releasedate: string;
            genre: string;
        };
    };

    navigationContentTypes: ContentTypeNavigationItem[] = [
        {
            contentType: ContentType.ITV,
            label: 'Live Streams',
        },
        {
            contentType: ContentType.VODS,
            label: 'VOD Streams',
        },
    ];

    currentCategoryId;

    //pagination
    length = 0;
    pageSize = 14;
    pageIndex = 0;

    commandsList = [
        new IpcCommand(STALKER_RESPONSE, (response: any) =>
            this.handleResponse(response)
        ),
        new IpcCommand(ERROR, (response: { message: string; status: number }) =>
            this.showErrorAsNotification(response)
        ),
    ];

    constructor(
        private dataService: DataService,
        private dialog: MatDialog,
        private ngZone: NgZone,
        private playlistService: PlaylistsService,
        private portalStore: PortalStore,
        private snackBar: MatSnackBar,
        private storage: StorageMap,
        private store: Store
    ) {
        effect(() => {
            if (this.currentPlaylist()) {
                if (
                    this.currentPlaylist().password &&
                    this.currentPlaylist().username
                ) {
                    this.handshake();
                } else {
                    this.selectedContentType = ContentType.VODS;
                    this.getCategories(this.selectedContentType);
                }

                this.favorites$ = this.playlistService.getPortalFavorites(
                    this.currentPlaylist()._id
                );
            }
        });

        this.portalStore.setSearchPhrase('');
    }

    ngOnInit() {
        this.commandsList.forEach((command) => {
            if (this.dataService.isElectron) {
                this.dataService.listenOn(command.id, (_event, response) =>
                    this.ngZone.run(() => command.callback(response))
                );
            } else {
                const cb = (response) => {
                    if (response.data.type === command.id) {
                        command.callback(response.data);
                    }
                };
                this.dataService.listenOn(command.id, cb);
                this.listeners.push(cb);
            }
        });
    }

    handshake() {
        this.sendRequest({ action: 'handshake', type: 'stb' });
    }

    setInitialBreadcrumb(
        action = StalkerPortalActions.GetCategories,
        title = 'All categories'
    ) {
        this.breadcrumbs = [{ title, action }];
    }

    getCategories(contentType: ContentType = this.selectedContentType) {
        this.selectedContentType = contentType;
        this.currentLayout = 'category';
        const action = StalkerContentTypes[contentType].getCategoryAction;
        this.setInitialBreadcrumb(action);
        this.sendRequest({ action, type: contentType });
    }

    sendRequest(params: Record<string, string | number>) {
        this.isLoading = true;
        if (params.action !== 'create_link') this.items = [];
        const { portalUrl, macAddress } = this.currentPlaylist();
        let token = {};
        if (sessionStorage.getItem(this.currentPlaylist()._id)) {
            token = sessionStorage.getItem(this.currentPlaylist()._id);
        }
        this.dataService.sendIpcEvent(STALKER_REQUEST, {
            url: portalUrl,
            macAddress,
            params: {
                ...params,
                token,
            },
        });
    }

    showErrorAsNotification(response: { message: string; status: number }) {
        this.snackBar.open(
            `Error: ${response?.message ?? 'Something went wrong'} (Status: ${
                response?.status ?? 0
            })`,
            null,
            { duration: 4000 }
        );
        this.isLoading = false;
    }

    handleResponse(response: {
        action: string;
        payload: { js: any; cmd?: string };
    }) {
        if (
            response.action === StalkerPortalActions.GetCategories ||
            response.action === StalkerPortalActions.GetGenres
        ) {
            if (typeof response.payload !== 'object') return;
            this.items = response.payload.js.map((item) => ({
                category_name: item.title,
                category_id: item.id,
            }));
        } else if (response.action === StalkerPortalActions.GetOrderedList) {
            if (response.payload.js.data && response.payload.js.data.length > 0)
                this.portalStore.setContent(response.payload.js.data);

            this.items = response.payload.js.data.map((item) => ({
                ...item,
                cover: item.screenshot_uri,
            }));
            this.length = response.payload.js.total_items;
            this.pageIndex = response.payload.js.cur_page;
        } else if (response.action === StalkerPortalActions.CreateLink) {
            let url = response.payload.js.cmd as string;
            if (url?.startsWith('ffmpeg')) {
                url = url.split(' ')[1];
            }

            this.openPlayer(url, response.payload.js.name);
        } else if (response.action === 'handshake') {
            const token = response.payload.js.token;
            sessionStorage.setItem(this.currentPlaylist()._id, token);

            this.sendRequest({
                action: 'do_auth',
                login: this.currentPlaylist().username,
                password: this.currentPlaylist().password,
                type: 'stb',
                token,
            });
        } else if (response.action === 'do_auth') {
            this.getCategories();
        }
    }

    openPlayer(streamUrl: string, title: string) {
        const player = this.settings().player;
        if (player === VideoPlayer.MPV) {
            this.dialog.open(ExternalPlayerInfoDialogComponent);
            this.dataService.sendIpcEvent(OPEN_MPV_PLAYER, {
                url: streamUrl,
            });
        } else if (player === VideoPlayer.VLC) {
            this.dialog.open(ExternalPlayerInfoDialogComponent);
            this.dataService.sendIpcEvent(OPEN_VLC_PLAYER, {
                url: streamUrl,
            });
        } else {
            this.dialog.open(PlayerDialogComponent, {
                data: { streamUrl, player, title },
                width: '80%',
            });
        }
    }

    categoryClicked(item: { category_name: string; category_id: string }) {
        this.currentLayout = 'category_content';
        this.currentCategoryId = item.category_id;
        const action =
            StalkerContentTypes[this.selectedContentType].getContentAction;
        this.portalStore.setSearchPhrase('');

        this.breadcrumbs.push({
            title: item.category_name,
            category_id: item.category_id,
            action,
        });

        this.sendRequest({
            action,
            type: this.selectedContentType,
            category: item.category_id,
            genre: item.category_id,
        });
    }

    itemClicked(i: any) {
        if (this.selectedContentType === ContentType.ITV) {
            this.playVod(i.cmd);
            return;
        }
        const selectedContent = this.portalStore.getContentById(i.id)();
        this.itemDetails = !selectedContent
            ? i.details // to read from favorites
            : {
                  id: i.id,
                  cmd: selectedContent.cmd,
                  info: {
                      movie_image: selectedContent.screenshot_uri,
                      description: selectedContent.description,
                      name: selectedContent.name,
                      director: selectedContent.director,
                      releasedate: selectedContent.year,
                      genre: selectedContent.genres_str,
                      actors: selectedContent.actors,
                  },
              };
        this.breadcrumbs.push({
            title: this.itemDetails?.info?.name,
            action: StalkerPortalActions.GetOrderedList,
        });
        this.currentLayout = 'vod-details';
    }

    playVod(cmd?: string) {
        const command = cmd ?? this.itemDetails.cmd;
        const action = StalkerContentTypes[this.selectedContentType].getLink;
        this.sendRequest({
            action,
            type: this.selectedContentType,
            cmd: command,
            forced_storage: 'undefined',
            disable_ad: '0',
            JsHttpRequest: '1-xml',
        });
    }

    breadcrumbClicked(breadcrumb: Breadcrumb) {
        const itemIndex = this.breadcrumbs.findIndex((i) => i === breadcrumb);

        // do nothing if last breadcrumb child was clicked
        if (itemIndex === this.breadcrumbs.length - 1) return;

        this.breadcrumbs.splice(
            itemIndex + 1,
            this.breadcrumbs.length - itemIndex - 1
        );

        if (breadcrumb.action === StalkerPortalActions.GetOrderedList) {
            this.currentLayout = 'category_content';
        } else if (
            breadcrumb.action === StalkerPortalActions.GetCategories ||
            breadcrumb.action === StalkerPortalActions.GetGenres
        ) {
            this.currentLayout = 'category';
        } else if (breadcrumb.action === StalkerPortalActions.Favorites) {
            this.currentLayout = 'favorites';
        }

        this.currentCategoryId = breadcrumb.category_id;
        this.sendRequest({
            action: breadcrumb.action,
            type: this.selectedContentType,
            ...(breadcrumb.category_id
                ? {
                      category: breadcrumb.category_id,
                      genre: breadcrumb.category_id,
                  }
                : {}),
        });
    }

    addToFavorites(item: any) {
        this.playlistService
            .addPortalFavorite(this.currentPlaylist()._id, item)
            .subscribe(() => {
                this.snackBar.open('Added to favorites', null, {
                    duration: 1000,
                });
            });
    }

    removeFromFavorites(favoriteId: string) {
        this.playlistService
            .removeFromPortalFavorites(this.currentPlaylist()._id, favoriteId)
            .subscribe(() => {
                this.snackBar.open('Removed from favorites', null, {
                    duration: 1000,
                });
            });
    }

    setSearchPhrase(searchPhrase: string) {
        if (
            this.currentLayout === 'category_content' &&
            this.searchPhrase !== searchPhrase
        ) {
            this.searchPhrase = searchPhrase;
            this.sendRequest({
                action: StalkerContentTypes[this.selectedContentType]
                    .getContentAction,
                type: this.selectedContentType,
                search: searchPhrase,
                ...(this.currentCategoryId
                    ? {
                          category: this.currentCategoryId,
                          genre: this.currentCategoryId,
                      }
                    : {}),
            });
        }
    }

    handlePageChange(event: PageEvent) {
        this.sendRequest({
            action: StalkerContentTypes[this.selectedContentType]
                .getContentAction,
            type: this.selectedContentType,
            category: this.currentCategoryId,
            p: event.pageIndex + 1,
        });
    }

    favoritesClicked() {
        this.currentLayout = 'favorites';
        this.setInitialBreadcrumb(
            StalkerPortalActions.Favorites,
            'My favorites'
        );
    }

    ngOnDestroy(): void {
        if (this.dataService.isElectron) {
            this.commandsList.forEach((command) =>
                this.dataService.removeAllListeners(command.id)
            );
        } else {
            this.listeners.forEach((listener) => {
                window.removeEventListener('message', listener);
            });
        }
    }
}
