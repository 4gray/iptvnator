import { activePersonalScope } from '@iptvnator/services/profiles';
import type { PersonalScope } from '@iptvnator/shared/interfaces/profiles';

const LIMIT = 100;

/** The scope each playback session began in: a late checkpoint never lands in another profile. */
export class ActivitySessionScopes {
    private readonly scopes = new Map<string, PersonalScope>();

    begin(sessionId: string | undefined): void {
        if (!sessionId) return;
        if (this.scopes.size >= LIMIT)
            this.scopes.delete(this.scopes.keys().next().value!);
        this.scopes.set(sessionId, activePersonalScope());
    }

    /** True when the session began under a profile other than the active one. */
    foreign(position: { activitySessionId?: string }): boolean {
        const scope = this.scopes.get(position.activitySessionId ?? '');
        return !!scope && scope !== activePersonalScope();
    }
}
