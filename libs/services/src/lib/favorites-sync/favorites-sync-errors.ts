export class FavoriteSupersededError extends Error {}
export class FavoriteRequestError extends Error {
    constructor(readonly status: number) {
        super('Favorite request failed');
    }
    get transient(): boolean {
        return this.status >= 500 && this.status < 600;
    }
}
