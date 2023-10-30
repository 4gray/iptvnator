import {
    AsyncPipe,
    JsonPipe,
    KeyValuePipe,
    NgFor,
    NgIf,
    NgSwitch,
} from '@angular/common';
import {
    Component,
    NgZone,
    OnInit,
    Signal,
    effect,
    inject,
} from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { IpcCommand } from '../../../shared/ipc-command.class';
import {
    ERROR,
    OPEN_MPV_PLAYER,
    OPEN_VLC_PLAYER,
    XTREAM_REQUEST,
    XTREAM_RESPONSE,
} from '../../../shared/ipc-commands';
import { XtreamCategory } from '../../../shared/xtream-category.interface';
import { XtreamCodeActions } from '../../../shared/xtream-code-actions';
import { XtreamLiveStream } from '../../../shared/xtream-live-stream.interface';
import { XtreamResponse } from '../../../shared/xtream-response.interface';
import { XtreamVodDetails } from '../../../shared/xtream-vod-details.interface';
import { DataService } from '../services/data.service';
import { selectCurrentPlaylist } from '../state/selectors';
import { CategoryContentViewComponent } from './category-content-view/category-content-view.component';
import { CategoryViewComponent } from './category-view/category-view.component';
import { ContentType } from './content-type.enum';
import { NavigationBarComponent } from './navigation-bar/navigation-bar.component';
import { VodDetailsComponent } from './vod-details/vod-details.component';

import { toSignal } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { StorageMap } from '@ngx-pwa/local-storage';
import { Observable } from 'rxjs';
import {
    XtreamSerieDetails,
    XtreamSerieEpisode,
} from '../../../shared/xtream-serie-details.interface';
import { PlaylistsService } from '../services/playlists.service';
import { Settings, VideoPlayer } from '../settings/settings.interface';
import { ExternalPlayerInfoDialogComponent } from '../shared/components/external-player-info-dialog/external-player-info-dialog.component';
import { STORE_KEY } from '../shared/enums/store-keys.enum';
import { Breadcrumb, PortalActions } from './breadcrumb.interface';
import { ContentTypeNavigationItem } from './content-type-navigation-item.interface';
import { PlayerDialogComponent } from './player-dialog/player-dialog.component';
import { PortalStore } from './portal.store';
import { SerialDetailsComponent } from './serial-details/serial-details.component';

const ContentTypes = {
    [ContentType.ITV]: {
        getContentAction: XtreamCodeActions.GetLiveStreams,
        getCategoryAction: XtreamCodeActions.GetLiveCategories,
    },
    [ContentType.VODS]: {
        getContentAction: XtreamCodeActions.GetVodStreams,
        getCategoryAction: XtreamCodeActions.GetVodCategories,
        getDetailsAction: XtreamCodeActions.GetVodInfo,
    },
    [ContentType.SERIES]: {
        getContentAction: XtreamCodeActions.GetSeries,
        getCategoryAction: XtreamCodeActions.GetSeriesCategories,
        getDetailsAction: XtreamCodeActions.GetSeriesInfo,
    },
};

type LayoutView =
    | 'category'
    | 'category_content'
    | 'vod-details'
    | 'player'
    | 'serie-details'
    | 'favorites';

@Component({
    selector: 'app-xtream-main-container',
    templateUrl: './xtream-main-container.component.html',
    styleUrls: ['./xtream-main-container.component.scss'],
    standalone: true,
    imports: [
        KeyValuePipe,
        MatButtonToggleModule,
        NgFor,
        NgIf,
        JsonPipe,
        CategoryViewComponent,
        NgSwitch,
        MatButtonModule,
        MatCardModule,
        MatIconModule,
        NavigationBarComponent,
        VodDetailsComponent,
        CategoryContentViewComponent,
        SerialDetailsComponent,
        PlayerDialogComponent,
        MatProgressSpinnerModule,
        AsyncPipe,
        ExternalPlayerInfoDialogComponent,
    ],
})
export class XtreamMainContainerComponent implements OnInit {
    dataService = inject(DataService);
    dialog = inject(MatDialog);
    ngZone = inject(NgZone);
    playlistService = inject(PlaylistsService);
    portalStore = inject(PortalStore);
    snackBar = inject(MatSnackBar);
    storage = inject(StorageMap);
    store = inject(Store);
    currentPlaylist = this.store.selectSignal(selectCurrentPlaylist);
    navigationContentTypes: ContentTypeNavigationItem[] = [
        {
            contentType: ContentType.ITV,
            label: 'Live Streams',
        },
        {
            contentType: ContentType.VODS,
            label: 'VOD Streams',
        },
        {
            contentType: ContentType.SERIES,
            label: 'Series',
        },
    ];

    favorites$: Observable<any>;
    breadcrumbs: Breadcrumb[] = [];
    items = [];
    listeners = [];
    selectedContentType = ContentType.VODS;
    currentLayout: LayoutView = 'category';
    vodDetails!: XtreamVodDetails | XtreamSerieDetails;
    settings = toSignal(
        this.storage.get(STORE_KEY.Settings)
    ) as Signal<Settings>;
    isLoading = true;
    searchPhrase = this.portalStore.searchPhrase();
    contentId: number;

    commandsList = [
        new IpcCommand(XTREAM_RESPONSE, (response: XtreamResponse) =>
            this.handleResponse(response)
        ),
        new IpcCommand(ERROR, (response: { message: string; status: number }) =>
            this.showErrorAsNotification(response)
        ),
    ];

    constructor() {
        effect(() => {
            if (this.currentPlaylist()) {
                this.getCategories(this.selectedContentType);
                this.favorites$ = this.playlistService.getPortalFavorites(
                    this.currentPlaylist()._id
                );
            }
        });
    }

    ngOnInit() {
        this.setInitialBreadcrumb();

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

    handleResponse(response: XtreamResponse) {
        switch (response.action) {
            case XtreamCodeActions.GetSeriesCategories:
            case XtreamCodeActions.GetVodCategories:
            case XtreamCodeActions.GetLiveCategories:
            case XtreamCodeActions.GetVodStreams:
            case XtreamCodeActions.GetLiveStreams:
            case XtreamCodeActions.GetSeries:
                this.items = response.payload as unknown[];
                break;
            case XtreamCodeActions.GetVodInfo:
                this.currentLayout = 'vod-details';
                this.vodDetails = response.payload as XtreamVodDetails;
                break;
            case XtreamCodeActions.GetSeriesInfo:
                this.currentLayout = 'serie-details';
                this.vodDetails = response.payload as XtreamSerieDetails;
                break;
            default:
                break;
        }
        this.isLoading = false;
    }

    getCategories(contentType: ContentType = this.selectedContentType) {
        this.currentLayout = 'category';
        const action = ContentTypes[contentType].getCategoryAction;
        this.setInitialBreadcrumb(action);
        this.sendRequest({ action });
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

    setInitialBreadcrumb(action = XtreamCodeActions.GetVodCategories) {
        this.breadcrumbs = [{ title: 'All categories', action }];
    }

    categoryClicked(item: XtreamCategory) {
        this.items = [];
        this.portalStore.setSearchPhrase('');
        const action = ContentTypes[this.selectedContentType].getContentAction;
        this.breadcrumbs.push({
            title: item.category_name,
            category_id: item.category_id,
            action,
        });
        this.sendRequest({ action, category_id: item.category_id });
        this.currentLayout = 'category_content';
    }

    itemClicked(
        item: any /* XtreamLiveStream | XtreamVodStream | XtreamSerieItem */
    ) {
        let action;

        if (item.stream_type && item.stream_type === 'movie') {
            this.items = [];
            action = XtreamCodeActions.GetVodInfo;
            this.breadcrumbs.push({ title: item.name, action });
            this.contentId = item.stream_id;
            this.sendRequest({ action, vod_id: item.stream_id });
        } else if (item.stream_type && item.stream_type === 'live') {
            this.playLiveStream(item);
        } else if (item.series_id) {
            this.items = [];
            action = XtreamCodeActions.GetSeriesInfo;
            this.breadcrumbs.push({ title: item.name, action });
            this.contentId = item.series_id;
            this.sendRequest({ action, series_id: item.series_id });
        }
    }

    playLiveStream(item: XtreamLiveStream) {
        const { serverUrl, username, password } = this.currentPlaylist();
        const streamUrl = `${serverUrl}/${item.stream_type}/${username}/${password}/${item.stream_id}.ts`;
        this.openPlayer(streamUrl, item.name);
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

    playVod(vodItem: XtreamVodDetails) {
        const { serverUrl, username, password } = this.currentPlaylist();
        this.items = [];
        const streamUrl = `${serverUrl}/movie/${username}/${password}/${vodItem.movie_data.stream_id}.${vodItem.movie_data.container_extension}`;

        this.openPlayer(streamUrl, vodItem.info.name);
    }

    playEpisode(episode: XtreamSerieEpisode) {
        const { serverUrl, username, password } = this.currentPlaylist();
        const player = this.settings().player;
        const streamUrl = `${serverUrl}/series/${username}/${password}/${episode.id}.${episode.container_extension}`;
        if (player === VideoPlayer.MPV) {
            this.dataService.sendIpcEvent(OPEN_MPV_PLAYER, { url: streamUrl });
        } else {
            this.dialog.open(PlayerDialogComponent, {
                data: { streamUrl, player, title: episode.title },
                width: '80%',
            });
        }
    }

    changeContentType(contentType: ContentType) {
        this.selectedContentType = contentType;
        this.getCategories();
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

    /**
     * Should get the position of the clicked breadcrumb and remove all the items after
     * @param breadcrumb clicked breadcrumb item
     */
    breadcrumbClicked(breadcrumb: Breadcrumb) {
        this.items = [];
        const itemIndex = this.breadcrumbs.findIndex((i) => i === breadcrumb);

        // do nothing if last breadcrumb child was clicked
        if (itemIndex === this.breadcrumbs.length - 1) return;

        this.breadcrumbs.splice(
            itemIndex + 1,
            this.breadcrumbs.length - itemIndex - 1
        );
        this.currentLayout = this.getLayoutViewBasedOnAction(breadcrumb.action);
        this.sendRequest({
            action: breadcrumb.action,
            ...(breadcrumb.category_id
                ? { category_id: breadcrumb.category_id }
                : {}),
        });
    }

    getLayoutViewBasedOnAction(action: PortalActions) {
        let result: LayoutView = 'category';
        switch (action) {
            case XtreamCodeActions.GetLiveCategories:
            case XtreamCodeActions.GetVodCategories:
            case XtreamCodeActions.GetSeriesCategories:
                result = 'category';
                break;
            case XtreamCodeActions.GetLiveStreams:
            case XtreamCodeActions.GetVodStreams:
            case XtreamCodeActions.GetSeries:
                result = 'category_content';
                break;
            case XtreamCodeActions.GetVodInfo:
            case XtreamCodeActions.GetSeriesInfo:
                result = 'vod-details';
                break;
            default:
                console.error(`Error: Unknown action was provided: ${action}`);
                break;
        }

        return result;
    }

    sendRequest(params: Record<string, string | number>) {
        this.isLoading = true;
        const { serverUrl, username, password } = this.currentPlaylist();
        this.dataService.sendIpcEvent(XTREAM_REQUEST, {
            url: serverUrl,
            params: {
                password,
                username,
                ...params,
            },
        });
    }

    setSearchPhrase(searchPhrase: string) {
        this.searchPhrase = searchPhrase;
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

    removeFromFavorites(favoriteId: number) {
        this.playlistService
            .removeFromPortalFavorites(this.currentPlaylist()._id, favoriteId)
            .subscribe(() => {
                this.snackBar.open('Removed from favorites', null, {
                    duration: 1000,
                });
            });
    }

    favoritesClicked() {
        this.currentLayout = 'favorites';
        this.setInitialBreadcrumb();
    }
}
