import { AsyncPipe } from '@angular/common';
import { Component, NgZone, OnInit, Signal, effect } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NgxSkeletonLoaderModule } from 'ngx-skeleton-loader';
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
import {
    PlayerDialogComponent,
    PlayerDialogData,
} from '../xtream/player-dialog/player-dialog.component';
import { PlaylistErrorViewComponent } from '../xtream/playlist-error-view/playlist-error-view.component';
import { PortalStore } from '../xtream/portal.store';
import { VodDetailsComponent } from '../xtream/vod-details/vod-details.component';
import {
    StalkerFavoriteItem,
    StalkerSeason,
    StalkerVodDetails,
} from './models';
import { StalkerContentTypes } from './stalker-content-types';
import { StalkerSeriesViewComponent } from './stalker-series-view/stalker-series-view.component';

@Component({
    selector: 'app-stalker-main-container',
    templateUrl: './stalker-main-container.component.html',
    styleUrl: './stalker-main-container.component.scss',
    standalone: true,
    imports: [
        AsyncPipe,
        CategoryContentViewComponent,
        CategoryViewComponent,
        MatPaginatorModule,
        NavigationBarComponent,
        NgxSkeletonLoaderModule,
        PlaylistErrorViewComponent,
        StalkerSeriesViewComponent,
        TranslateModule,
        VodDetailsComponent,
    ],
})
export class StalkerMainContainerComponent implements OnInit {
    breadcrumbs: Breadcrumb[] = [];
    currentPlaylist = this.store.selectSignal(selectCurrentPlaylist);
    listeners = [];
    isLoading = true;
    selectedContentType = ContentType.VODS;
    currentLayout:
        | 'category'
        | 'category_content'
        | 'favorites'
        | 'serial-details'
        | 'vod-details'
        | 'not-available' = 'category';
    searchPhrase = this.portalStore.searchPhrase();
    settings = toSignal(
        this.storage.get(STORE_KEY.Settings)
    ) as Signal<Settings>;
    favorites$: Observable<any>;

    items: any[] = [];
    itemDetails!: StalkerVodDetails;

    navigationContentTypes: ContentTypeNavigationItem[] = [
        {
            contentType: ContentType.ITV,
            label: 'Live Streams',
            icon: 'live_tv',
        },
        {
            contentType: ContentType.VODS,
            label: 'VOD Streams',
            icon: 'movie',
        },
        {
            contentType: ContentType.SERIES,
            label: 'Series',
            icon: 'video_library',
        },
        /* {
            contentType: ContentType.RADIO,
            label: 'Radio',
        }, */
    ];

    hideExternalInfoDialog = this.portalStore.hideExternalInfoDialog;

    currentCategoryId;

    //pagination
    length = 0;
    pageSize = 14;
    pageIndex = 0;

    itvTitle: string;

    seasons: StalkerSeason[] = [];

    commandsList = [
        new IpcCommand(STALKER_RESPONSE, (response: any) =>
            this.handleResponse(response)
        ),
        new IpcCommand(
            ERROR,
            (response: { message: string; status: number }) => {
                this.currentLayout = 'not-available';
                this.showErrorAsNotification(response);
                this.isLoading = false;
            }
        ),
    ];

    constructor(
        private activatedRoute: ActivatedRoute,
        private dataService: DataService,
        private dialog: MatDialog,
        private ngZone: NgZone,
        private playlistService: PlaylistsService,
        private portalStore: PortalStore,
        private router: Router,
        private snackBar: MatSnackBar,
        private storage: StorageMap,
        private store: Store,
        private translate: TranslateService
    ) {
        effect(
            () => {
                if (this.currentPlaylist()) {
                    if (
                        this.currentPlaylist().password &&
                        this.currentPlaylist().username
                    ) {
                        this.handshake();
                    } else {
                        this.selectedContentType =
                            this.activatedRoute.snapshot.queryParams.type ??
                            ContentType.VODS;

                        const action =
                            this.activatedRoute.snapshot.queryParams.action ??
                            StalkerPortalActions.GetCategories;
                        const { category, movie_id } =
                            this.activatedRoute.snapshot.queryParams;

                        if (action === StalkerPortalActions.GetCategories) {
                            this.getCategories(this.selectedContentType);
                        } else if (
                            action === StalkerPortalActions.GetOrderedList &&
                            (category || movie_id)
                        ) {
                            this.getOrderedList(
                                this.selectedContentType,
                                category,
                                movie_id
                            );
                        }
                    }

                    this.favorites$ = this.playlistService.getPortalFavorites(
                        this.currentPlaylist()._id
                    );
                }
            },
            { allowSignalWrites: true }
        );

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
        this.sendRequest({
            action: StalkerPortalActions.Handshake,
            type: ContentType.STB,
        });
    }

    setInitialBreadcrumb(action: StalkerPortalActions, title: string) {
        this.breadcrumbs = [{ title, action }];
    }

    getCategories(contentType: ContentType) {
        this.router.navigate([], { queryParams: { type: contentType } });
        this.selectedContentType = contentType;
        this.currentLayout = 'category';
        const action = StalkerContentTypes[contentType].getCategoryAction;
        this.pageIndex = 0;
        this.setInitialBreadcrumb(
            action,
            this.translate.instant('PORTALS.ALL_CATEGORIES')
        );
        this.sendRequest({ action, type: contentType });
    }

    getOrderedList(type: ContentType, category: string, movieId?: string) {
        if (!movieId) {
            this.currentLayout = 'category_content';
        } else {
            if (type === ContentType.SERIES) {
                this.currentLayout = 'serial-details';
            } else if (type === ContentType.VODS) {
                this.currentLayout = 'vod-details';
            }
        }
        const action = StalkerPortalActions.GetOrderedList;
        this.setInitialBreadcrumb(
            action,
            this.translate.instant('PORTALS.ALL_CATEGORIES')
        );
        this.sendRequest({
            action,
            type,
            category,
            ...(movieId ? { movie_id: movieId } : {}),
        });
    }

    sendRequest(params: Record<string, string | number | string[]>) {
        if (params.action !== StalkerPortalActions.CreateLink) {
            this.isLoading = true;
            this.items = [];
        }
        const { portalUrl, macAddress } = this.currentPlaylist();
        let token = {};
        if (sessionStorage.getItem(this.currentPlaylist()._id)) {
            token = sessionStorage.getItem(this.currentPlaylist()._id);
        }

        this.updateRoute(params);

        this.dataService.sendIpcEvent(STALKER_REQUEST, {
            url: portalUrl,
            macAddress,
            params: {
                ...params,
                token,
            },
        });
    }

    updateRoute(params: Record<string, string | number | string[]>) {
        let queryParams: Params;
        if (params.action === StalkerPortalActions.GetCategories) {
            queryParams = {
                action: params.action,
                type: params.type,
            };
        } else if (params.action === StalkerPortalActions.GetOrderedList) {
            queryParams = {
                action: params.action,
                type: params.type,
                ...(params.category ? { category: params.category } : {}),
                ...(params.movie_id ? { movie_id: params.movie_id } : {}),
            };
        }
        this.router.navigate([], {
            queryParams,
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
        action: StalkerPortalActions;
        payload: { js: any; cmd?: string };
    }) {
        if (typeof response.payload !== 'object') {
            this.isLoading = false;
            return;
        }

        if (
            this.currentLayout === 'serial-details' &&
            response.action !== StalkerPortalActions.CreateLink
        ) {
            this.seasons = response.payload.js.data;
            this.portalStore.setCurrentSerial(this.seasons);
        }
        if (
            response.action === StalkerPortalActions.GetCategories ||
            response.action === StalkerPortalActions.GetGenres
        ) {
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
        } else if (response.action === StalkerPortalActions.CreateLink) {
            let url = response.payload.js.cmd as string;
            if (url?.startsWith('ffmpeg')) {
                url = url.split(' ')[1];
            }

            this.openPlayer(url);
        } else if (response.action === StalkerPortalActions.Handshake) {
            const token = response.payload.js.token;
            sessionStorage.setItem(this.currentPlaylist()._id, token);

            this.sendRequest({
                action: StalkerPortalActions.DoAuth,
                login: this.currentPlaylist().username,
                password: this.currentPlaylist().password,
                type: ContentType.STB,
                token,
            });
        } else if (response.action === StalkerPortalActions.DoAuth) {
            this.getCategories(this.selectedContentType);
        }

        this.isLoading = false;
    }

    openPlayer(streamUrl: string) {
        // Get fresh settings directly from storage instead of using signal
        this.storage.get(STORE_KEY.Settings).subscribe((settings: Settings) => {
            const player = settings?.player ?? VideoPlayer.VideoJs;
            if (player === VideoPlayer.MPV) {
                if (!this.hideExternalInfoDialog())
                    this.dialog.open(ExternalPlayerInfoDialogComponent);
                this.dataService.sendIpcEvent(OPEN_MPV_PLAYER, {
                    url: streamUrl,
                    mpvPlayerPath: settings?.mpvPlayerPath,
                });
            } else if (player === VideoPlayer.VLC) {
                if (!this.hideExternalInfoDialog())
                    this.dialog.open(ExternalPlayerInfoDialogComponent);
                this.dataService.sendIpcEvent(OPEN_VLC_PLAYER, {
                    url: streamUrl,
                    vlcPlayerPath: settings?.vlcPlayerPath,
                });
            } else {
                this.dialog.open<PlayerDialogComponent, PlayerDialogData>(
                    PlayerDialogComponent,
                    {
                        data: {
                            streamUrl,
                            title: this.itvTitle,
                        },
                        width: '80%',
                    }
                );
            }
        });
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

    favoriteClicked(item: StalkerFavoriteItem) {
        if (item.movie_id) {
            this.getSerialDetails(item);
        } else if (item.stream_id && item.details) {
            this.itemDetails = item.details;
            this.breadcrumbs.push({
                title: this.itemDetails?.info?.name,
                action: StalkerPortalActions.GetOrderedList,
            });
            this.currentLayout = 'vod-details';
        } else {
            this.snackBar.open('Something went wrong, id is missing.');
        }
    }

    getSerialDetails(item: StalkerFavoriteItem) {
        this.sendRequest({
            action: StalkerPortalActions.GetOrderedList,
            type: ContentType.SERIES,
            movie_id: item.id ?? item.movie_id,
        });
        this.breadcrumbs.push({
            title: item.name,
            action: StalkerPortalActions.GetCategories,
        });
        this.currentLayout = 'serial-details';
    }

    getVodDetails(item: {
        id: string;
        cmd: string;
        category_id: string;
        movie_id?: string;
        details: any;
        name: string;
    }) {
        const selectedContent = this.portalStore.getContentById(item.id)();
        this.itemDetails = {
            id: item.id,
            cmd: selectedContent.cmd,
            info: {
                movie_image: selectedContent.screenshot_uri,
                description: selectedContent.description,
                name: selectedContent.name,
                director: selectedContent.director,
                releasedate: selectedContent.year,
                genre: selectedContent.genres_str,
                actors: selectedContent.actors,
                rating_imdb: selectedContent.rating_imdb,
                rating_kinopoisk: selectedContent.rating_kinopoisk,
            },
        };
        this.breadcrumbs.push({
            title: this.itemDetails?.info?.name,
            action: StalkerPortalActions.GetOrderedList,
        });
        this.currentLayout = 'vod-details';
    }

    itemClicked(item: {
        id: string;
        cmd: string;
        category_id: string;
        movie_id?: string;
        details: any;
        name: string;
    }) {
        this.itvTitle = item.name;
        if (this.selectedContentType === ContentType.SERIES) {
            this.getSerialDetails(item);
        } else if (this.selectedContentType === ContentType.ITV) {
            this.createLinkToPlayVod(item.cmd);
        } else if (this.selectedContentType === ContentType.VODS) {
            this.getVodDetails(item);
        }
    }

    createLinkToPlayEpisode(payload: StalkerSeason) {
        this.sendRequest({
            action: StalkerPortalActions.CreateLink,
            type: ContentType.VODS,
            cmd: payload.cmd,
            series: payload.series,
            forced_storage: 'undefined',
            disable_ad: '0',
            JsHttpRequest: '1-xml',
        });
    }

    createLinkToPlayVod(cmd?: string) {
        this.sendRequest({
            action: StalkerPortalActions.CreateLink,
            type: this.selectedContentType,
            cmd: cmd ?? this.itemDetails.cmd,
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
            this.pageIndex = 0;
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
                this.snackBar.open(
                    this.translate.instant('PORTALS.ADDED_TO_FAVORITES'),
                    null,
                    {
                        duration: 1000,
                    }
                );
            });
    }

    removeFromFavorites(favoriteId: string) {
        this.playlistService
            .removeFromPortalFavorites(this.currentPlaylist()._id, favoriteId)
            .subscribe(() => {
                this.snackBar.open(
                    this.translate.instant('PORTALS.REMOVED_FROM_FAVORITES'),
                    null,
                    {
                        duration: 1000,
                    }
                );
            });
    }

    setSearchPhrase(searchPhrase: string) {
        if (
            this.currentLayout === 'category_content' &&
            this.searchPhrase !== searchPhrase
        ) {
            this.pageIndex = 0;
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
        this.pageIndex = Number(event.pageIndex);
        this.sendRequest({
            action: StalkerPortalActions.GetOrderedList,
            type: this.selectedContentType,
            category: this.currentCategoryId,
            genre: this.currentCategoryId,
            p: this.pageIndex + 1,
        });
    }

    favoriteViewClicked() {
        this.currentLayout = 'favorites';
        this.setInitialBreadcrumb(
            StalkerPortalActions.Favorites,
            this.translate.instant('PORTALS.MY_FAVORITES')
        );
    }

    ngOnDestroy() {
        this.portalStore.setSearchPhrase('');
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
