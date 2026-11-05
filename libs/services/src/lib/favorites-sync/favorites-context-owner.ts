import type { FavoritesSyncClient } from './favorites-sync-client';
import { FavoriteSupersededError } from './favorites-sync-errors';

export function captureFavoriteOwner(
    client: FavoritesSyncClient,
    sourceId: string
): () => void {
    const incarnation = client.contexts.get(sourceId)?.sourceIncarnation;
    const consent = client.options.consent();
    const assertCurrent = () => {
        if (
            client.options.profileActive?.() === false ||
            client.options.consent() !== consent ||
            client.contexts.get(sourceId)?.sourceIncarnation !== incarnation
        )
            throw new FavoriteSupersededError();
    };
    assertCurrent();
    return assertCurrent;
}
