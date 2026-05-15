import { NgComponentOutlet } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    Injector,
    Type,
    effect,
    inject,
    input,
    signal,
    untracked,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ContentHeroComponent } from '@iptvnator/ui/components';
import { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import {
    XtreamPlaylistData,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { PlaylistsService } from '@iptvnator/services';
import { Playlist } from '@iptvnator/shared/interfaces';
import { firstValueFrom } from 'rxjs';
import { SerialDetailsComponent } from './serial-details/serial-details.component';
import { VodDetailsRouteComponent } from './vod-details/vod-details-route.component';

interface XtreamCollectionStateSnapshot {
    playlistId: string | null;
    currentPlaylist: XtreamPlaylistData | null;
    selectedContentType: 'live' | 'vod' | 'series';
    selectedCategoryId: number | null;
    selectedItem: unknown;
    isLoadingDetails: boolean;
    detailsError: string | null;
}

@Component({
    selector: 'app-xtream-collection-detail',
    imports: [ContentHeroComponent, NgComponentOutlet],
    template: `
        @if (detailComponent() && detailInjector()) {
            <ng-container
                *ngComponentOutlet="
                    detailComponent();
                    injector: detailInjector()
                "
            />
        } @else {
            <app-content-hero [isLoading]="true" />
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [
        `
            :host {
                display: block;
                width: 100%;
                height: 100%;
                min-height: 0;
            }
        `,
    ],
})
export class XtreamCollectionDetailComponent {
    readonly item = input<UnifiedCollectionItem | null>(null);

    private readonly parentInjector = inject(Injector);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly originalState = this.captureStoreState();
    readonly detailComponent = signal<Type<unknown> | null>(null);
    readonly detailInjector = signal<Injector | null>(null);

    private initRequestId = 0;

    constructor() {
        effect(() => {
            const item = this.item();
            untracked(() => {
                void this.prepareDetail(item);
            });
        });
    }

    ngOnDestroy(): void {
        this.restoreStoreState();
    }

    private async prepareDetail(
        item: UnifiedCollectionItem | null
    ): Promise<void> {
        const requestId = ++this.initRequestId;

        if (!item) {
            this.detailComponent.set(null);
            this.detailInjector.set(null);
            return;
        }

        const xtreamId = this.resolveXtreamId(item);
        if (!xtreamId) {
            this.detailComponent.set(null);
            this.detailInjector.set(null);
            return;
        }

        const playlist = await this.loadPlaylist(item.playlistId);
        if (requestId !== this.initRequestId) {
            return;
        }

        if (!playlist?.serverUrl || !playlist.username || !playlist.password) {
            this.detailComponent.set(null);
            this.detailInjector.set(null);
            return;
        }

        const xtreamPlaylist = this.toXtreamPlaylist(playlist);
        this.xtreamStore.setPlaylistId(xtreamPlaylist.id);
        this.xtreamStore.setCurrentPlaylist(xtreamPlaylist);
        this.xtreamStore.setSelectedContentType(
            item.contentType === 'movie' ? 'vod' : 'series'
        );
        this.xtreamStore.setSelectedCategory(
            this.toCategoryId(item.categoryId)
        );
        this.xtreamStore.setSelectedItem(null);
        this.xtreamStore.setIsLoadingDetails(false);
        this.xtreamStore.setDetailsError(null);

        this.detailComponent.set(
            item.contentType === 'movie'
                ? VodDetailsRouteComponent
                : SerialDetailsComponent
        );
        this.detailInjector.set(
            Injector.create({
                providers: [
                    {
                        provide: ActivatedRoute,
                        useValue: {
                            snapshot: {
                                params:
                                    item.contentType === 'movie'
                                        ? {
                                              categoryId: this.toPathSegment(
                                                  item.categoryId
                                              ),
                                              vodId: xtreamId,
                                          }
                                        : {
                                              categoryId: this.toPathSegment(
                                                  item.categoryId
                                              ),
                                              serialId: xtreamId,
                                          },
                            },
                        },
                    },
                ],
                parent: this.parentInjector,
            })
        );
    }

    private captureStoreState(): XtreamCollectionStateSnapshot {
        return {
            playlistId: this.xtreamStore.playlistId(),
            currentPlaylist: this.xtreamStore.currentPlaylist(),
            selectedContentType: this.xtreamStore.selectedContentType(),
            selectedCategoryId: this.xtreamStore.selectedCategoryId(),
            selectedItem: this.xtreamStore.selectedItem(),
            isLoadingDetails: this.xtreamStore.isLoadingDetails(),
            detailsError: this.xtreamStore.detailsError(),
        };
    }

    private restoreStoreState(): void {
        this.xtreamStore.setPlaylistId(this.originalState.playlistId ?? '');
        this.xtreamStore.setCurrentPlaylist(this.originalState.currentPlaylist);
        this.xtreamStore.setSelectedContentType(
            this.originalState.selectedContentType
        );
        this.xtreamStore.setSelectedCategory(
            this.originalState.selectedCategoryId
        );
        this.xtreamStore.setSelectedItem(
            this.originalState.selectedItem as never
        );
        this.xtreamStore.setIsLoadingDetails(
            this.originalState.isLoadingDetails
        );
        this.xtreamStore.setDetailsError(this.originalState.detailsError);
    }

    private async loadPlaylist(playlistId: string): Promise<Playlist | null> {
        try {
            return (
                (await firstValueFrom(
                    this.playlistsService.getPlaylistById(playlistId)
                )) ?? null
            );
        } catch {
            return null;
        }
    }

    private toXtreamPlaylist(playlist: Playlist): XtreamPlaylistData {
        return {
            id: playlist._id,
            name: playlist.title || '',
            title: playlist.title || '',
            serverUrl: playlist.serverUrl || '',
            username: playlist.username || '',
            password: playlist.password || '',
            type: 'xtream',
            userAgent: playlist.userAgent,
            referrer: playlist.referrer,
            origin: playlist.origin,
        };
    }

    private resolveXtreamId(item: UnifiedCollectionItem): string | null {
        const directId = Number(item.xtreamId);
        if (Number.isFinite(directId) && directId > 0) {
            return String(directId);
        }

        const uidSegments = item.uid.split('::');
        const fallbackId = Number(uidSegments[uidSegments.length - 1]);
        return Number.isFinite(fallbackId) && fallbackId > 0
            ? String(fallbackId)
            : null;
    }

    private toCategoryId(value: unknown): number | null {
        const categoryId = Number(String(value ?? '').trim());
        return Number.isFinite(categoryId) ? categoryId : null;
    }

    private toPathSegment(value: unknown): string {
        return String(value ?? '').trim();
    }
}
