/** Matching is only needed once an optional asynchronous lookup runs. */
export function loadTmdbMatcher() {
    return import('./tmdb-matcher');
}
