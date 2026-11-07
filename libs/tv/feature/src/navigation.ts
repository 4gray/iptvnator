import type { Kind, Media } from '@iptvnator/tv/util';
export type View =
    | 'home'
    | 'live'
    | 'movies'
    | 'series'
    | 'favorites'
    | 'history'
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
    ['history', 'History'],
    ['search', 'Search'],
    ['sources', 'Sources'],
    ['settings', 'Settings'],
];
export const isCollectionView = (view?: View) =>
    view === 'favorites' || view === 'history';
export const isSavedView = (view?: View) =>
    view === 'home' || isCollectionView(view);
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
