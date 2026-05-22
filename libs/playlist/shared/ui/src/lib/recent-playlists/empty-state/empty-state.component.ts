import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import type { PlaylistType } from '../../add-playlist-menu/playlist-type';

export type EmptyStateType =
    | 'welcome-dashboard'
    | 'welcome-sources'
    | 'no-results'
    | 'no-data';

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
        icon: 'folder_open',
        nameKey: 'HOME.PLAYLISTS.FEATURE_M3U',
        needsKey: 'HOME.PLAYLISTS.SOURCE_M3U_NEEDS',
        addLabelKey: 'HOME.PLAYLISTS.SOURCE_M3U_ADD',
        contentKeys: [
            'HOME.PLAYLISTS.CONTENT_LIVE',
            'HOME.PLAYLISTS.CONTENT_EPG',
        ],
    },
    {
        type: 'xtream',
        icon: 'cloud',
        nameKey: 'HOME.PLAYLISTS.FEATURE_XTREAM',
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
        icon: 'cast',
        nameKey: 'HOME.PLAYLISTS.FEATURE_STALKER',
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
    styleUrls: [
        './empty-state.component.scss',
        './empty-state.welcome-dashboard.scss',
        './empty-state.welcome-sources.scss',
        './empty-state.responsive.scss',
        './empty-state.themes.scss',
    ],
    imports: [MatButtonModule, MatIcon, TranslatePipe],
})
export class EmptyStateComponent {
    readonly type = input.required<EmptyStateType>();

    readonly icon = input<string>('inbox');
    readonly titleKey = input<string>('');
    readonly descriptionKey = input<string>('');
    readonly primaryActionLabelKey = input<string | null>(null);
    readonly secondaryActionLabelKey = input<string | null>(null);

    readonly showElectronOnlyValueProps = input<boolean>(false);

    readonly addPlaylistClicked = output<PlaylistType | undefined>();
    readonly primaryActionClicked = output<void>();
    readonly secondaryActionClicked = output<void>();

    readonly featureCards = FEATURE_CARDS;
    readonly sourceCards = SOURCE_CARDS;

    onAddPlaylist(type?: PlaylistType): void {
        this.addPlaylistClicked.emit(type);
    }

    onPrimaryAction(): void {
        this.primaryActionClicked.emit();
    }

    onSecondaryAction(): void {
        this.secondaryActionClicked.emit();
    }

    isFeatureCardVisible(card: FeatureCard): boolean {
        return !card.electronOnly || this.showElectronOnlyValueProps();
    }
}
