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
    activePersonalScope,
    type ProfilesError,
} from '@iptvnator/services/profiles';
import { verifySourceInstance } from '@iptvnator/services/source-sync/authorization';
import {
    sourceConnection,
    sourceVerificationEpoch,
} from '@iptvnator/services/source-sync/connection';
import type { SourceServerResponse } from '@iptvnator/shared/interfaces';
import {
    DEFAULT_PERSONAL_SCOPE,
    DEFAULT_PROFILE_ID,
    PROFILES_CAPABILITY,
    type PersonalScope,
    type ServerProfile,
    type ServerProfileList,
} from '@iptvnator/shared/interfaces/profiles';
import {
    clearActiveProfileId,
    readActiveProfileId,
    writeActiveProfileId,
} from './profiles-preferences';
import { PROFILES_REQUEST } from './profiles-request.token';
import { resolveActiveProfileId } from './profiles-start';
import { PROFILES_UI_ENABLED_TOKEN } from './profiles-ui-enabled';

export const PROFILES_POLL_MS = 30_000;
/** A server without profiles may be upgraded later: ask again after this long. */
export const PROFILES_REPROBE_MS = 5 * 60_000;

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
    private unsupportedAt = 0;
    private revision: number | undefined;
    /** This session's choice, kept when storage cannot hold it. */
    private sessionChoice: string | null = null;
    /** Start-up gave up waiting: stay on Default for this session. */
    private heldOnDefault = false;
    private startupRead = false;
    /** This session's choice came from the picker, so its PIN was asked. */
    private choiceUnlocked = false;
    /**
     * Bumped when the active profile changes for a reason other than a choice
     * in flight (start-up gave up, a profile vanished, profiles were turned
     * off): a choice that began before it no longer applies.
     */
    private activeEpoch = 0;
    private refreshing?: Promise<void>;
    /** Bumped when a deletion is learned: a list requested before it is stale. */
    private deletions = 0;
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
    /** Whose personal state this device uses; the Default's `'shared'` while the UI is off. */
    readonly scope: Signal<PersonalScope> = computed(() =>
        this.uiEnabled
            ? (this.active()?.scope ?? DEFAULT_PERSONAL_SCOPE)
            : DEFAULT_PERSONAL_SCOPE
    );
    readonly enabled: Signal<boolean> = computed(
        () => this.listState()?.enabled ?? false
    );

    constructor() {
        const refresh = () => void this.refresh();
        const visibility = () => {
            if (!document.hidden) refresh();
        };
        window.addEventListener('focus', refresh);
        window.addEventListener('online', refresh);
        document.addEventListener('visibilitychange', visibility);
        // Profile changes are rare and a matching revision is a 304; focus and
        // visibility cover the usual cross-device change. Playback sync polls
        // faster because it carries active playback state.
        const timer = setInterval(() => {
            const instanceId = sourceConnection()?.instanceId;
            if (
                !document.hidden &&
                instanceId &&
                (this.capableState() ||
                    this.probedInstanceId !== instanceId ||
                    this.reprobeDue())
            )
                refresh();
        }, PROFILES_POLL_MS);
        this.destroyRef.onDestroy(() => {
            clearInterval(timer);
            window.removeEventListener('focus', refresh);
            window.removeEventListener('online', refresh);
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

    /**
     * Resolves once no refresh is running, without joining one: a refresh that
     * began earlier may predate the change its caller just made.
     */
    async idle(): Promise<void> {
        while (this.refreshing) await this.refreshing.catch(() => undefined);
    }

    /** After a failed call: the next refresh probes the instance again. */
    async recheck(): Promise<void> {
        // An in-flight refresh was not preceded by a fresh identity check:
        // let it finish rather than join it.
        await this.idle();
        this.probedInstanceId = null;
        return this.refresh();
    }

    /**
     * Moves this device to profile `id` without ever showing a profile whose
     * data it is not on. `move` takes the personal state to the profile's
     * scope and resolves once the device is on it; `moved` is the point where
     * the scope has changed and the shown profile must follow. The active
     * profile, the avatar and the saved choice change then, never before, so
     * until then the old profile stays shown and writes keep reaching it.
     * Resolves false with nothing changed (the old profile stays active) when
     * the profile is gone, `move` fails, or the active profile changed for
     * another reason meanwhile.
     */
    async switchTo(
        id: string,
        move: (scope: PersonalScope, moved: () => void) => Promise<void>
    ): Promise<boolean> {
        const profile = this.listState()?.profiles.find((p) => p.id === id);
        if (!profile || !this.canSelect(id)) return false;
        const epoch = this.activeEpoch;
        let settled = false;
        let selected = false;
        const commit = (): void => {
            if (settled) return;
            settled = true;
            selected = this.activeEpoch === epoch && this.select(id);
        };
        const restore = () =>
            move(this.scope(), () => undefined).catch(() => undefined);
        const scope = this.uiEnabled ? profile.scope : DEFAULT_PERSONAL_SCOPE;
        try {
            await move(scope, commit);
            // No `moved` call means the device was already on the scope, or a
            // newer switch took over and it is not.
            if (activePersonalScope() === scope) commit();
            settled = true;
        } catch {
            // Before the scope moved nothing changed; after it, the shown
            // profile already follows and the choice stands.
            if (!settled) {
                settled = true;
                await restore();
                return false;
            }
        }
        if (!selected) await restore();
        return selected;
    }

    private canSelect(id: string): boolean {
        const list = this.listState();
        return (
            !!list &&
            list.profiles.some((profile) => profile.id === id) &&
            (id === DEFAULT_PROFILE_ID || list.enabled)
        );
    }

    select(id: string): boolean {
        if (!this.canSelect(id)) return false;
        // Blocked storage only costs the next launch's "last profile": the
        // choice still applies to this session.
        writeActiveProfileId(this.currentInstanceId, id);
        this.sessionChoice = id;
        this.choiceUnlocked = true;
        this.heldOnDefault = false;
        this.activeIdValue.set(id);
        return true;
    }

    /**
     * The start-up guard let the user in as Default without an answer. A
     * late list must not switch to a saved profile (and skip its PIN); the
     * saved choice stays for the next launch.
     */
    holdDefault(): void {
        this.heldOnDefault = true;
        this.setActive(DEFAULT_PROFILE_ID, true);
    }

    /**
     * For a `profile_missing` or `profiles_disabled` answer to any profile
     * call: show Default at once, then catch up with the server. A missing
     * profile is forgotten; a disabled household keeps the stored id, so
     * turning profiles back on restores this device's last profile.
     * `profileId` is the profile the failed call named: another device
     * deleting that one must not change this device's choice unless it is
     * the active profile.
     */
    handleProfileError(code: ProfilesError['code'], profileId?: string): void {
        if (code === 'profile_missing') {
            if (profileId !== undefined && profileId !== this.activeIdValue()) {
                void this.refresh();
                return;
            }
            clearActiveProfileId(this.currentInstanceId);
            this.sessionChoice = null;
            this.deletions++;
        } else if (code === 'profiles_disabled') this.showDisabled();
        else return;
        this.setActive(DEFAULT_PROFILE_ID, true);
        void this.refresh();
    }

    private showDisabled(): void {
        this.listState.update((list) =>
            list ? { ...list, enabled: false } : null
        );
        this.setActive(DEFAULT_PROFILE_ID);
    }

    /** Publishes the active profile for any reason other than a choice. */
    private setActive(id: string, force = false): void {
        if (force || id !== this.activeIdValue()) this.activeEpoch++;
        this.activeIdValue.set(id);
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
        if (this.probedInstanceId !== instanceId || this.reprobeDue()) {
            this.stateValue.set('checking');
            const capable = await this.probe(instanceId);
            if (!this.isCurrent(instanceId) || !capable) return;
        }
        if (!this.capableState() || !this.isCurrent(instanceId)) return;
        const deletions = this.deletions;
        const result = await this.client().list(this.revision);
        if (!this.isCurrent(instanceId)) return;
        // Asked before a deletion was learned: it may still list that profile.
        if (deletions !== this.deletions) return this.refreshNow();
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
            // A failed request clears the browser's identity check, so the
            // next refresh probes the instance again before asking for the list.
            this.probedInstanceId = null;
            this.stateValue.set('offline');
        }
    }

    /**
     * Only a verified answer from this instance without the capability is
     * final for the instance; anything else is retried on the next refresh.
     */
    private async probe(instanceId: string): Promise<boolean> {
        let response: SourceServerResponse;
        const epoch = sourceVerificationEpoch();
        try {
            response = await this.request({ operation: 'instance' });
        } catch {
            response = { status: 0 };
        }
        if (!this.isCurrent(instanceId)) return false;
        const info = response.body as
            { instanceId?: unknown; capabilities?: unknown } | undefined;
        // A browser verifies the instance before it sends anything else; the
        // source sync may not have done so yet at start-up.
        let verified = response.status === 200;
        if (verified) {
            try {
                verifySourceInstance(info, sourceConnection(), epoch);
            } catch {
                verified = false;
            }
        }
        if (!verified || info?.instanceId !== instanceId) {
            this.probedInstanceId = null;
            this.capableState.set(false);
            this.stateValue.set('offline');
            return false;
        }
        const capable =
            Array.isArray(info.capabilities) &&
            info.capabilities.includes(PROFILES_CAPABILITY);
        this.probedInstanceId = instanceId;
        this.unsupportedAt = capable ? 0 : Date.now();
        this.capableState.set(capable);
        this.stateValue.set(capable ? 'checking' : 'unsupported');
        return capable;
    }

    private reconcile(instanceId: string | null): void {
        if (this.heldOnDefault) return;
        const list = this.listState();
        // The saved id is read once, at start-up; after that each tab keeps
        // its own choice. A saved PIN profile is never adopted without its PIN.
        if (!this.startupRead && list) {
            this.startupRead = true;
            const saved = readActiveProfileId(instanceId);
            if (
                !this.sessionChoice &&
                !list.profiles.find((profile) => profile.id === saved)?.hasPin
            )
                this.sessionChoice = saved;
        }
        // A PIN added to a profile after it was restored at launch applies
        // too: only a choice made through the picker skips the PIN.
        if (
            this.sessionChoice &&
            !this.choiceUnlocked &&
            list?.profiles.find((profile) => profile.id === this.sessionChoice)
                ?.hasPin
        )
            this.sessionChoice = null;
        const id = this.sessionChoice;
        this.setActive(resolveActiveProfileId(list, id));
        if (
            list?.enabled &&
            id &&
            !list.profiles.some((profile) => profile.id === id)
        ) {
            this.sessionChoice = null;
            clearActiveProfileId(instanceId);
        }
    }

    private reprobeDue(): boolean {
        return (
            this.stateValue() === 'unsupported' &&
            Date.now() - this.unsupportedAt >= PROFILES_REPROBE_MS
        );
    }

    private isCurrent(instanceId: string): boolean {
        return sourceConnection()?.instanceId === instanceId;
    }

    private reset(): void {
        this.currentInstanceId = null;
        this.probedInstanceId = null;
        this.revision = undefined;
        this.sessionChoice = null;
        this.choiceUnlocked = false;
        this.startupRead = false;
        this.heldOnDefault = false;
        this.capableState.set(false);
        this.listState.set(null);
        this.setActive(DEFAULT_PROFILE_ID, true);
        this.stateValue.set('idle');
    }
}
