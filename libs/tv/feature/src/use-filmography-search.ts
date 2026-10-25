import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ActorFilmographyCredit } from '@iptvnator/shared/tmdb';
import {
    findFilmographyTitle,
    FilmographyMatch,
} from '@iptvnator/tv/data-access';
import { restoreFocus } from '@iptvnator/tv/ui';
import type { TvModel } from './use-tv';

export const filmographyKey = (credit: ActorFilmographyCredit) =>
    `filmography:${credit.mediaType}:${credit.tmdbId}`;
export function useFilmographySearch(tv: TvModel) {
    const request = useRef<AbortController>();
    const [state, setState] = useState<{
        credit: ActorFilmographyCredit;
        busy: boolean;
        result?: FilmographyMatch;
        error?: boolean;
    }>();
    const provider = tv.guideClient;
    useLayoutEffect(
        () => () => {
            request.current?.abort();
            request.current = undefined;
        },
        [provider, tv.data.activeId, tv.route.person?.tmdbId]
    );
    async function search(credit: ActorFilmographyCredit) {
        request.current?.abort();
        const abort = new AbortController();
        request.current = abort;
        setState({ credit, busy: true });
        const deadline = setTimeout(() => {
            if (request.current === abort) {
                setState({ credit, busy: false, error: true });
                request.current = undefined;
                abort.abort();
            }
        }, 15000);
        try {
            if (!provider) throw new Error('Provider unavailable.');
            const result = await findFilmographyTitle(
                provider,
                tv.data.activeId,
                credit,
                abort.signal
            );
            if (request.current !== abort || abort.signal.aborted) return;
            if (result.status === 'found') tv.open(result.item);
            else setState({ credit, busy: false, result });
        } catch {
            if (request.current === abort)
                setState({ credit, busy: false, error: true });
        } finally {
            clearTimeout(deadline);
        }
    }
    return {
        state,
        search,
        cancel: () => {
            request.current?.abort();
            request.current = undefined;
            setState(undefined);
            if (state) restoreFocus(filmographyKey(state.credit));
        },
    };
}
