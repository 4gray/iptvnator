import type { PlaylistType } from '@iptvnator/playlist/shared/ui';
import { SOURCE_TYPE_ICONS } from '@iptvnator/shared/interfaces';

export interface PlaylistMethodOption {
    value: PlaylistType;
    icon: string;
    labelKey: string;
    subKey: string;
}

// Order matches the v0.22 mockup left-to-right: URL first (Most common),
// then File, Xtream credentials, Stalker portal, raw text paste. Each
// entry stands on its own — no nested subtypes. Labels are short and
// sentence-cased; the "Add via …" / "Add Xtreme Code" wording from the
// old tab labels is redundant inside a dialog already titled "Add
// playlist".
export const PLAYLIST_METHOD_OPTIONS: PlaylistMethodOption[] = [
    {
        value: 'url',
        icon: SOURCE_TYPE_ICONS['m3u-url'],
        labelKey: 'HOME.ADD_PLAYLIST.METHOD_URL_LABEL',
        subKey: 'HOME.ADD_PLAYLIST.METHOD_URL_SUB',
    },
    {
        value: 'file',
        icon: SOURCE_TYPE_ICONS['m3u-local'],
        labelKey: 'HOME.ADD_PLAYLIST.METHOD_FILE_LABEL',
        subKey: 'HOME.ADD_PLAYLIST.METHOD_FILE_SUB',
    },
    {
        value: 'xtream',
        icon: SOURCE_TYPE_ICONS.xtream,
        labelKey: 'HOME.ADD_PLAYLIST.METHOD_XTREAM_LABEL',
        subKey: 'HOME.ADD_PLAYLIST.METHOD_XTREAM_SUB',
    },
    {
        value: 'stalker',
        icon: SOURCE_TYPE_ICONS.stalker,
        labelKey: 'HOME.ADD_PLAYLIST.METHOD_STALKER_LABEL',
        subKey: 'HOME.ADD_PLAYLIST.METHOD_STALKER_SUB',
    },
    {
        value: 'text',
        icon: SOURCE_TYPE_ICONS['m3u-text'],
        labelKey: 'HOME.ADD_PLAYLIST.METHOD_TEXT_LABEL',
        subKey: 'HOME.ADD_PLAYLIST.METHOD_TEXT_SUB',
    },
    {
        value: 'auto',
        icon: 'auto_awesome',
        labelKey: 'HOME.ADD_PLAYLIST.METHOD_AUTO_LABEL',
        subKey: 'HOME.ADD_PLAYLIST.METHOD_AUTO_SUB',
    },
    {
        value: 'bulk',
        icon: 'library_add',
        labelKey: 'HOME.ADD_PLAYLIST.METHOD_BULK_LABEL',
        subKey: 'HOME.ADD_PLAYLIST.METHOD_BULK_SUB',
    },
];
