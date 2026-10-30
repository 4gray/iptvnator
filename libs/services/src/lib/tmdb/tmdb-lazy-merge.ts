/** Keep detail-only provider merges out of the eager services barrel. */
export function loadTmdbMergers() {
    return import('./tmdb-merge');
}
