import { SERVER_USER_STATE_NAMESPACES } from '@iptvnator/shared/interfaces';
import {
    createBrowserUserDataStorage,
    type UserDataStorage,
} from '../user-data-storage';

/** Adopt only this browser's old instance cache; never fetch or upload activity. */
export function createSourceProfileUserDataStorage(
    profile: string,
    instanceId?: string,
    local: UserDataStorage = createBrowserUserDataStorage()
): UserDataStorage {
    const prefix = profile === 'iptvnator' ? '' : `${profile}:`;
    const migratedKey = (key: string) =>
        `${prefix}legacy-cache-migrated:${key}`;
    const isLegacyNamespace = (key: string) =>
        instanceId &&
        (SERVER_USER_STATE_NAMESPACES as readonly string[]).includes(key);
    return {
        getItem: (key) => {
            if (
                isLegacyNamespace(key) &&
                local.getItem(migratedKey(key)) !== '1'
            ) {
                if (local.getItem(`${prefix}${key}`) === null) {
                    const cached = local.getItem(
                        `iptvnator-server:cache:${instanceId}:${key}`
                    );
                    if (cached !== null)
                        local.setItem(`${prefix}${key}`, cached);
                }
                local.setItem(migratedKey(key), '1');
            }
            return local.getItem(`${prefix}${key}`);
        },
        setItem: (key, value) => {
            if (isLegacyNamespace(key)) local.setItem(migratedKey(key), '1');
            local.setItem(`${prefix}${key}`, value);
        },
        removeItem: (key) => {
            if (isLegacyNamespace(key)) local.setItem(migratedKey(key), '1');
            local.removeItem(`${prefix}${key}`);
        },
    };
}
