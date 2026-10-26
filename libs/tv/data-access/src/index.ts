import { Source, ProviderClient } from '@iptvnator/tv/util';
import { ProviderTransport } from './transport';
import { XtreamProvider } from './xtream';
import { StalkerProvider } from './stalker';
import { M3uProvider } from './m3u';
export * from './storage';
export * from './player';
export { ProviderTransport };
export { ProviderRequestError } from './transport';
export function createProvider(
    source: Source,
    transport: ProviderTransport,
    save: (s: Source) => Promise<void>
): ProviderClient {
    if (source.provider === 'xtream')
        return new XtreamProvider(source, transport);
    if (source.provider === 'stalker')
        return new StalkerProvider(source, transport, save);
    return new M3uProvider(source, transport);
}

export { StalkerSession } from './stalker-session';
export { stalkerEpisodes } from './stalker-series';
export { probeDirect } from './direct-probe';
export { TvMetadata, checkTmdbKey } from './tmdb';
export {
    findFilmographyTitle,
    type FilmographyMatch,
} from './filmography-search';
export * from './backend';
export * from './pairing';
export { storedMediaPoster } from './stored-artwork';
export { findParentSeries } from './parent-series';

export * from './library';
export * from './library-sources';
