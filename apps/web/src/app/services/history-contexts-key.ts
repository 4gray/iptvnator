import {
    DEFAULT_PERSONAL_SCOPE,
    type PersonalScope,
} from '@iptvnator/shared/interfaces/profiles';

/** The Default profile keeps its historic key, so contexts saved before profiles still read. */
export const historyContextsKey = (
    instanceId: string,
    scope: PersonalScope
): string =>
    `iptvnator-server:${instanceId}:history-contexts-v1${
        scope === DEFAULT_PERSONAL_SCOPE ? '' : `:${scope}`
    }`;
