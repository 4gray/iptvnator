import {
    Component,
    input,
    output,
    ChangeDetectionStrategy,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { SOURCE_TYPE_ICONS } from '@iptvnator/shared/interfaces';
import { StateViewComponent } from '@iptvnator/ui/state';
import type { PlaylistType } from '../../add-playlist-menu/playlist-type';

/**
 * The first-run welcome of the dashboard and of Sources. Every other empty,
 * no-results, error and offline view is `app-state-view`.
 */
export type EmptyStateType = 'welcome-dashboard' | 'welcome-sources';

interface FeatureCard {
    icon: string;
    titleKey: string;
    descKey: string;
    electronOnly?: boolean;
}

interface SourceCard {
    type: PlaylistType;
    icon: string;
    nameKey: string;
    /** The dashboard's link for this source type. */
    linkKey: string;
    needsKey: string;
    addLabelKey: string;
    contentKeys: readonly string[];
}

const FEATURE_CARDS: readonly FeatureCard[] = [
    {
        icon: 'live_tv',
        titleKey: 'HOME.PLAYLISTS.FEATURE_LIVE_TITLE',
        descKey: 'HOME.PLAYLISTS.FEATURE_LIVE_DESC',
    },
    {
        icon: 'movie',
        titleKey: 'HOME.PLAYLISTS.FEATURE_VOD_TITLE',
        descKey: 'HOME.PLAYLISTS.FEATURE_VOD_DESC',
    },
    {
        icon: 'event_note',
        titleKey: 'HOME.PLAYLISTS.FEATURE_EPG_TITLE',
        descKey: 'HOME.PLAYLISTS.FEATURE_EPG_DESC',
    },
    {
        icon: 'download_for_offline',
        titleKey: 'HOME.PLAYLISTS.FEATURE_OFFLINE_TITLE',
        descKey: 'HOME.PLAYLISTS.FEATURE_OFFLINE_DESC',
        electronOnly: true,
    },
];

const SOURCE_CARDS: readonly SourceCard[] = [
    {
        type: 'url',
        icon: SOURCE_TYPE_ICONS.m3u,
        nameKey: 'HOME.PLAYLISTS.FEATURE_M3U',
        linkKey: 'HOME.PLAYLISTS.FEATURE_M3U_LABEL',
        needsKey: 'HOME.PLAYLISTS.SOURCE_M3U_NEEDS',
        addLabelKey: 'HOME.PLAYLISTS.SOURCE_M3U_ADD',
        contentKeys: [
            'HOME.PLAYLISTS.CONTENT_LIVE',
            'HOME.PLAYLISTS.CONTENT_EPG',
        ],
    },
    {
        type: 'xtream',
        icon: SOURCE_TYPE_ICONS.xtream,
        nameKey: 'HOME.PLAYLISTS.FEATURE_XTREAM',
        linkKey: 'HOME.PLAYLISTS.FEATURE_XTREAM_LABEL',
        needsKey: 'HOME.PLAYLISTS.SOURCE_XTREAM_NEEDS',
        addLabelKey: 'HOME.PLAYLISTS.SOURCE_XTREAM_ADD',
        contentKeys: [
            'HOME.PLAYLISTS.CONTENT_LIVE',
            'HOME.PLAYLISTS.CONTENT_VOD',
            'HOME.PLAYLISTS.CONTENT_SERIES',
            'HOME.PLAYLISTS.CONTENT_EPG',
        ],
    },
    {
        type: 'stalker',
        icon: SOURCE_TYPE_ICONS.stalker,
        nameKey: 'HOME.PLAYLISTS.FEATURE_STALKER',
        linkKey: 'HOME.PLAYLISTS.FEATURE_STALKER_LABEL',
        needsKey: 'HOME.PLAYLISTS.SOURCE_STALKER_NEEDS',
        addLabelKey: 'HOME.PLAYLISTS.SOURCE_STALKER_ADD',
        contentKeys: [
            'HOME.PLAYLISTS.CONTENT_LIVE',
            'HOME.PLAYLISTS.CONTENT_VOD',
            'HOME.PLAYLISTS.CONTENT_SERIES',
            'HOME.PLAYLISTS.CONTENT_EPG',
        ],
    },
];

@Component({
    selector: 'app-empty-state',
    templateUrl: './empty-state.component.html',
    styleUrl: './empty-state.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatButton, MatIcon, StateViewComponent, TranslatePipe],
})
export class EmptyStateComponent {
    readonly type = input.required<EmptyStateType>();
    readonly showElectronOnlyValueProps = input<boolean>(false);

    readonly addPlaylistClicked = output<PlaylistType | undefined>();

    readonly featureCards = FEATURE_CARDS;
    readonly sourceCards = SOURCE_CARDS;

    onAddPlaylist(type?: PlaylistType): void {
        this.addPlaylistClicked.emit(type);
    }

    isFeatureCardVisible(card: FeatureCard): boolean {
        return !card.electronOnly || this.showElectronOnlyValueProps();
    }
}
