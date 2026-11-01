import type {
    ActivityAddress,
    ActivityContentIdentity,
} from './activity-sync.contract';

export function assertActivityToken(value: string): void {
    if (
        typeof value !== 'string' ||
        !value.length ||
        value.length > 1024 ||
        value !== value.trim() ||
        Array.from(value).some((character) => character.charCodeAt(0) < 32)
    ) {
        throw new Error('Invalid activity identifier');
    }
}

/** Serialize only canonical fields; separators and extra snapshot properties cannot collide. */
export function activityAddressKey(address: ActivityAddress): string {
    if (address.scope !== 'shared') throw new Error('Invalid activity scope');
    const fields = [
        address.instanceId,
        address.sourceId,
        address.sourceIncarnation,
    ];
    fields.forEach(assertActivityToken);
    return JSON.stringify([
        'activity-v1',
        ...fields,
        address.scope,
        ...contentFields(address.content),
    ]);
}

function contentFields(content: ActivityContentIdentity): (string | number)[] {
    if (content.provider !== 'xtream' && content.provider !== 'stalker') {
        throw new Error('Invalid activity provider');
    }
    assertActivityToken(content.id);
    if (content.kind === 'vod')
        return [content.provider, content.kind, content.id];
    if (content.kind !== 'episode') throw new Error('Invalid activity kind');
    assertActivityToken(content.seriesId);
    const fields = [
        content.provider,
        content.kind,
        content.seriesId,
        content.id,
    ];
    if (content.provider === 'xtream') return fields;
    if (!['regular', 'embedded', 'lazy'].includes(content.mode)) {
        throw new Error('Invalid Stalker episode mode');
    }
    assertActivityToken(content.seasonKey);
    if (
        !Number.isSafeInteger(content.episodeNumber) ||
        content.episodeNumber < 0
    ) {
        throw new Error('Invalid activity episode number');
    }
    return [...fields, content.mode, content.seasonKey, content.episodeNumber];
}
