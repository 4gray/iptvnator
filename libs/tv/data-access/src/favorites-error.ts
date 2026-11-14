export class FavoritesError extends Error {
    constructor(
        message: string,
        readonly code?: string,
        readonly retryable = false
    ) {
        super(message);
    }

    get sourceRetired() {
        return [
            'playlist_missing',
            'source_changed',
            'unsupported_source',
            'not_found',
        ].includes(this.code ?? '');
    }
}
