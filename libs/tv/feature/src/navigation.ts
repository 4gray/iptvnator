import type { Kind, Media } from '@iptvnator/tv/util';
export type View =
    | 'home'
    | 'live'
    | 'movies'
    | 'series'
    | 'favorites'
    | 'search'
    | 'sources'
    | 'settings'
    | 'person'
    | 'detail';
export const mainNavigation: [View, string][] = [
    ['home', 'Home'],
    ['live', 'TV'],
    ['movies', 'Movies'],
    ['series', 'Series'],
    ['favorites', 'Favorites'],
    ['search', 'Search'],
    ['sources', 'Sources'],
    ['settings', 'Settings'],
];
export interface Route {
    view: View;
    kind: Kind;
    category: string;
    page: number;
    query: string;
    item?: Media;
    person?: { tmdbId: number; name: string; sourceId: string };
}
export const firstRoute = (): Route => ({
    view: 'home',
    kind: 'movie',
    category: '',
    page: 0,
    query: '',
});
