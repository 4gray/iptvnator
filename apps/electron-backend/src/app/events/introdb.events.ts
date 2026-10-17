/**
 * IntroDB segment lookup for the "Skip intro" button.
 *
 * Runs in the main process because the renderer cannot reach the API: its
 * CORS policy only admits https://introdb.app, and Electron keeps
 * `webSecurity` on. The host is fixed here and the payload is validated, so
 * the renderer can choose an episode but never a URL.
 */

import axios from 'axios';
import { ipcMain } from 'electron';
import {
    INTRODB_GET_SEGMENTS,
    type IntroDbEpisodeSegments,
    isIntroDbSegmentsRequest,
    normalizeIntroDbSegments,
} from '@iptvnator/shared/interfaces';

const INTRODB_SEGMENTS_URL = 'https://api.introdb.app/segments';
const INTRODB_TIMEOUT_MS = 8000;

/**
 * The episode's segments, or null when IntroDB has none (404), the request
 * is invalid, or the service cannot be reached — the button simply does not
 * appear in any of those cases.
 */
export async function fetchIntroDbSegments(
    payload: unknown
): Promise<IntroDbEpisodeSegments | null> {
    if (!isIntroDbSegmentsRequest(payload)) {
        return null;
    }
    try {
        const response = await axios.get(INTRODB_SEGMENTS_URL, {
            params: {
                imdb_id: payload.imdbId,
                season: payload.seasonNumber,
                episode: payload.episodeNumber,
            },
            timeout: INTRODB_TIMEOUT_MS,
            maxRedirects: 0,
            responseType: 'json',
            validateStatus: () => true,
        });
        return response.status === 200
            ? normalizeIntroDbSegments(response.data)
            : null;
    } catch {
        return null;
    }
}

export function registerIntroDbHandlers(): void {
    ipcMain.handle(INTRODB_GET_SEGMENTS, async (_event, payload: unknown) =>
        fetchIntroDbSegments(payload)
    );
}
