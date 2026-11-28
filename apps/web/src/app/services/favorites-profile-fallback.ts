import { ProfileStateUnavailableError } from '@iptvnator/services/profiles';

/** The raw favorites are the household's: a profile reads nothing from them and never writes. */
export function profileRawFallback(method: string): [] | false {
    if (method === 'getFavorites') return [];
    if (method === 'isFavorite') return false;
    throw new ProfileStateUnavailableError();
}
