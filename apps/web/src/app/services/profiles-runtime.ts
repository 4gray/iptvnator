import {
    DestroyRef,
    Injectable,
    Signal,
    computed,
    inject,
    signal,
} from '@angular/core';
import {
    ProfilesClient,
    type ProfilesError,
} from '@iptvnator/services/profiles';
import { sourceConnection } from '@iptvnator/services/source-sync/connection';
import type { SourceServerResponse } from '@iptvnator/shared/interfaces';
import {
    DEFAULT_PROFILE_ID,
    PROFILES_CAPABILITY,
    type ServerProfile,
    type ServerProfileList,
} from '@iptvnator/shared/interfaces/profiles';
import {
    activeProfileKey,
    clearActiveProfileId,
    readActiveProfileId,
    writeActiveProfileId,
} from './profiles-preferences';
import { PROFILES_REQUEST } from './profiles-request.token';
import { resolveActiveProfileId } from './profiles-start';
import { PROFILES_UI_ENABLED_TOKEN } from './profiles-ui-enabled';

export const PROFILES_POLL_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class ProfilesRuntime {
    private readonly destroyRef = inject(DestroyRef);
    private readonly request = inject(PROFILES_REQUEST);
    private readonly capableState = signal(false);
    private readonly listState = signal<ServerProfileList | null>(null);
    private readonly stateValue = signal<
        'idle' | 'checking' | 'ready' | 'unsupported' | 'offline'
    >('idle');
    private readonly activeIdValue = signal(DEFAULT_PROFILE_ID);
    private currentInstanceId: string | null = null;
    private probedInstanceId: string | null = null;
    private revision: number | undefined;
    private refreshing?: Promise<void>;
    private profilesClient?: ProfilesClient;

    readonly uiEnabled = inject(PROFILES_UI_ENABLED_TOKEN);
    readonly capable: Signal<boolean> = this.capableState.asReadonly();
    readonly list: Signal<ServerProfileList | null> =
        this.listState.asReadonly();
    readonly state: Signal<
        'idle' | 'checking' | 'ready' | 'unsupported' | 'offline'
    > = this.stateValue.asReadonly();
    readonly activeId: Signal<string> = this.activeIdValue.asReadonly();
    readonly active: Signal<ServerProfile | null> = computed(() => {
        const profiles = this.listState()?.profiles;
        return (
            profiles?.find((profile) => profile.id === this.activeIdValue()) ??
            profiles?.find((profile) => profile.id === DEFAULT_PROFILE_ID) ??
            null
        );
    });
    readonly enabled: Signal<boolean> = computed(
        () => this.listState()?.enabled ?? false
    );

    constructor() {
        const refresh = () => void this.refresh();
        const visibility = () => {
            if (!document.hidden) refresh();
        };
        const storage = (event: StorageEvent) => {
            const instanceId = sourceConnection()?.instanceId ?? null;
            if (event.key && event.key === activeProfileKey(instanceId))
                this.reconcile(instanceId);
        };
        window.addEventListener('focus', refresh);
        window.addEventListener('online', refresh);
        window.addEventListener('storage', storage);
        document.addEventListener('visibilitychange', visibility);
        // Profile changes are rare and a matching revision is a 304; focus and
        // visibility cover the usual cross-device change. Playback sync polls
        // faster because it carries active playback state.
        const timer = setInterval(() => {
            const instanceId = sourceConnection()?.instanceId;
            if (
                !document.hidden &&
                instanceId &&
                (this.capableState() || this.probedInstanceId !== instanceId)
            )
                refresh();
        }, PROFILES_POLL_MS);
        this.destroyRef.onDestroy(() => {
            clearInterval(timer);
            window.removeEventListener('focus', refresh);
            window.removeEventListener('online', refresh);
            window.removeEventListener('storage', storage);
            document.removeEventListener('visibilitychange', visibility);
        });
        queueMicrotask(refresh);
    }

    client(): ProfilesClient {
        return (this.profilesClient ??= new ProfilesClient({
            request: this.request,
        }));
    }

    refresh(): Promise<void> {
        return (this.refreshing ??= this.refreshNow().finally(
            () => (this.refreshing = undefined)
        ));
    }

    select(id: string): boolean {
        const list = this.listState();
        if (
            !list ||
            !list.profiles.some((profile) => profile.id === id) ||
            (id !== DEFAULT_PROFILE_ID && !list.enabled)
        )
            return false;
        if (!writeActiveProfileId(this.currentInstanceId, id)) return false;
        this.activeIdValue.set(id);
        return true;
    }

    /**
     * For a `profile_missing` or `profiles_disabled` answer to any profile
     * call: show Default at once, then catch up with the server. A missing
     * profile is forgotten; a disabled household keeps the stored id, so
     * turning profiles back on restores this device's last profile.
     */
    handleProfileError(code: ProfilesError['code']): void {
        if (code === 'profile_missing')
            clearActiveProfileId(this.currentInstanceId);
        else if (code === 'profiles_disabled') this.showDisabled();
        else return;
        this.activeIdValue.set(DEFAULT_PROFILE_ID);
        void this.refresh();
    }

    private showDisabled(): void {
        this.listState.update((list) =>
            list ? { ...list, enabled: false } : null
        );
        this.activeIdValue.set(DEFAULT_PROFILE_ID);
    }

    private async refreshNow(): Promise<void> {
        const instanceId = sourceConnection()?.instanceId;
        if (!instanceId) {
            this.reset();
            return;
        }
        if (this.currentInstanceId !== instanceId) {
            this.reset();
            this.currentInstanceId = instanceId;
        }
        if (this.probedInstanceId !== instanceId) {
            this.stateValue.set('checking');
            const capable = await this.probe(instanceId);
            if (!this.isCurrent(instanceId) || !capable) return;
        }
        if (!this.capableState() || !this.isCurrent(instanceId)) return;
        const result = await this.client().list(this.revision);
        if (!this.isCurrent(instanceId)) return;
        if (result.ok) {
            if (result.value.changed) {
                this.listState.set(result.value.list);
                this.revision = result.value.list.revision;
            }
            this.reconcile(instanceId);
            this.stateValue.set('ready');
        } else if (result.error.code === 'profiles_disabled') {
            this.showDisabled();
            this.stateValue.set('ready');
        } else {
            // Offline, refused or a body this client cannot read: keep the
            // last list and active profile until a later refresh succeeds.
            this.stateValue.set('offline');
        }
    }

    /**
     * Only a verified answer from this instance without the capability is
     * final for the instance; anything else is retried on the next refresh.
     */
    private async probe(instanceId: string): Promise<boolean> {
        let response: SourceServerResponse;
        try {
            response = await this.request({ operation: 'instance' });
        } catch {
            response = { status: 0 };
        }
        if (!this.isCurrent(instanceId)) return false;
        const info = response.body as
            { instanceId?: unknown; capabilities?: unknown } | undefined;
        if (response.status !== 200 || info?.instanceId !== instanceId) {
            this.probedInstanceId = null;
            this.capableState.set(false);
            this.stateValue.set('offline');
            return false;
        }
        const capable =
            Array.isArray(info.capabilities) &&
            info.capabilities.includes(PROFILES_CAPABILITY);
        this.probedInstanceId = instanceId;
        this.capableState.set(capable);
        this.stateValue.set(capable ? 'checking' : 'unsupported');
        return capable;
    }

    private reconcile(instanceId: string | null): void {
        const list = this.listState();
        const storedId = readActiveProfileId(instanceId);
        this.activeIdValue.set(resolveActiveProfileId(list, storedId));
        if (
            list?.enabled &&
            storedId &&
            !list.profiles.some((profile) => profile.id === storedId)
        )
            clearActiveProfileId(instanceId);
    }

    private isCurrent(instanceId: string): boolean {
        return sourceConnection()?.instanceId === instanceId;
    }

    private reset(): void {
        this.currentInstanceId = null;
        this.probedInstanceId = null;
        this.revision = undefined;
        this.capableState.set(false);
        this.listState.set(null);
        this.activeIdValue.set(DEFAULT_PROFILE_ID);
        this.stateValue.set('idle');
    }
}
