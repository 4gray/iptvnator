import type { ScopeRefusal } from '../profiles/scope-refusal';
export class FavoriteSupersededError extends Error {}
export class FavoriteRequestError extends Error {
    constructor(
        readonly status: number,
        /** Set when the server refused the profile scope itself. */
        readonly refusal: ScopeRefusal | null = null
    ) {
        super('Favorite request failed');
    }
    get transient(): boolean {
        return this.status >= 500 && this.status < 600;
    }
}
