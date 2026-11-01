import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import type { ActivityAddress } from '@iptvnator/shared/interfaces/activity-sync';
import { activityIdentityKey } from './activity-projection';

export class ActivitySupersededError extends Error {}

/** Explicit actions supersede older launches, including their failure fallback. */
export class ActivityActionFence {
    private readonly current = new Map<string, object>();

    position(
        sourceId: string,
        position: Partial<PlaybackPositionData>
    ): () => boolean {
        return this.advance(this.keys(sourceId, position));
    }

    watch(
        sourceId: string,
        position: Partial<PlaybackPositionData>
    ): () => boolean {
        const keys = this.keys(sourceId, position);
        const tokens = keys.map((key) => this.current.get(key));
        return () =>
            keys.every((key, index) => this.current.get(key) === tokens[index]);
    }

    private keys(
        sourceId: string,
        position: Partial<PlaybackPositionData>
    ): string[] {
        const keys = [
            JSON.stringify([
                'raw',
                sourceId,
                position.contentType,
                String(position.contentXtreamId),
            ]),
        ];
        if (position.activityIdentity)
            keys.push(
                JSON.stringify([
                    'identity',
                    sourceId,
                    activityIdentityKey(position.activityIdentity),
                ])
            );
        return keys;
    }

    address(
        address: ActivityAddress,
        alias?: PlaybackPositionData
    ): () => boolean {
        const keys = [
            JSON.stringify([
                'identity',
                address.sourceId,
                activityIdentityKey(address.content),
            ]),
        ];
        if (alias)
            keys.push(
                JSON.stringify([
                    'raw',
                    address.sourceId,
                    alias.contentType,
                    String(alias.contentXtreamId),
                ])
            );
        else if (
            address.content.provider === 'xtream' ||
            address.content.kind === 'vod'
        )
            keys.push(
                JSON.stringify([
                    'raw',
                    address.sourceId,
                    address.content.kind === 'vod' ? 'vod' : 'episode',
                    address.content.id,
                ])
            );
        return this.advance(keys);
    }

    private advance(keys: string[]): () => boolean {
        const token = {};
        for (const key of keys) this.current.set(key, token);
        return () => keys.every((key) => this.current.get(key) === token);
    }
}
