import { sourceProfileName } from './source-connection';

/** Settings shared by the device keep their own keys; source sidecars do not. */
export function sourceProfileStorageKey(key: string): string {
    const profile = sourceProfileName();
    return profile === 'iptvnator' ? key : `${profile}:${key}`;
}
