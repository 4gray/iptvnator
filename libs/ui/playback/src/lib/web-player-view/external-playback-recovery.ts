import { computed, signal, type Signal } from '@angular/core';
import type {
    ExternalPlayerName,
    ExternalPlayerSession,
} from '@iptvnator/shared/interfaces';

export const EXTERNAL_RECOVERY_LAUNCH_TIMEOUT_MS = 10_000;

export type ExternalRecoveryStatus =
    'idle' | 'launching' | 'started' | 'playing' | 'error';

export interface ExternalRecoveryTargetState {
    readonly attempts: number;
    readonly sessionId: string | null;
    readonly status: ExternalRecoveryStatus;
}

export interface ExternalRecoveryIntent {
    readonly target: ExternalPlayerName;
    readonly token: symbol;
}

export type ExternalRecoveryStates = Readonly<
    Record<ExternalPlayerName, ExternalRecoveryTargetState>
>;

interface ActiveIntent extends ExternalRecoveryIntent {
    readonly ignoredSessionId: string | null;
    readonly sessionId: string | null;
}

function idleState(): ExternalRecoveryTargetState {
    return Object.freeze({ attempts: 0, sessionId: null, status: 'idle' });
}

function initialStates(): ExternalRecoveryStates {
    return Object.freeze({ mpv: idleState(), vlc: idleState() });
}

export class ExternalPlaybackRecovery {
    private readonly statesState =
        signal<ExternalRecoveryStates>(initialStates());
    private readonly activeIntentState = signal<ActiveIntent | null>(null);
    private contentSessionKey: string | null = null;
    private launchTimer: ReturnType<typeof setTimeout> | null = null;

    readonly states: Signal<ExternalRecoveryStates> =
        this.statesState.asReadonly();
    readonly pending = computed(() => this.activeIntentState() !== null);

    syncSession(key: string): boolean {
        if (this.contentSessionKey === key) {
            return false;
        }

        this.contentSessionKey = key;
        this.clearActiveIntent();
        this.statesState.set(initialStates());
        return true;
    }

    begin(
        target: ExternalPlayerName,
        previousSessionId: string | null
    ): ExternalRecoveryIntent | null {
        if (this.activeIntentState() !== null) {
            return null;
        }

        const token = Symbol();
        const intent: ActiveIntent = Object.freeze({
            ignoredSessionId: previousSessionId,
            sessionId: null,
            target,
            token,
        });
        const previous = this.target(target);
        this.setTarget(target, {
            attempts: previous.attempts + 1,
            sessionId: null,
            status: 'launching',
        });
        this.activeIntentState.set(intent);
        this.launchTimer = setTimeout(
            () => this.fail(intent),
            EXTERNAL_RECOVERY_LAUNCH_TIMEOUT_MS
        );
        return intent;
    }

    owns(intent: ExternalRecoveryIntent): boolean {
        const active = this.activeIntentState();
        return (
            active?.token === intent.token && active.target === intent.target
        );
    }

    observe(session: ExternalPlayerSession | null): boolean {
        if (!session) {
            return false;
        }

        const correlated = this.target(session.player);
        if (correlated.sessionId === session.id) {
            return this.applySession(session.player, session);
        }

        const active = this.activeIntentState();
        if (active) {
            if (active.sessionId === null) {
                if (
                    session.player !== active.target ||
                    session.id === active.ignoredSessionId
                ) {
                    return false;
                }
                this.activeIntentState.set(
                    Object.freeze({ ...active, sessionId: session.id })
                );
            } else if (session.id !== active.sessionId) {
                return false;
            }

            return this.applySession(active.target, session);
        }

        const target = session.player;
        return this.target(target).sessionId === session.id
            ? this.applySession(target, session)
            : false;
    }

    fail(intent: ExternalRecoveryIntent): boolean {
        if (!this.owns(intent)) {
            return false;
        }

        const current = this.target(intent.target);
        this.setTarget(intent.target, {
            attempts: current.attempts,
            sessionId: current.sessionId,
            status: 'error',
        });
        this.clearActiveIntent();
        return true;
    }

    target(target: ExternalPlayerName): ExternalRecoveryTargetState {
        return this.statesState()[target];
    }

    destroy(): void {
        this.clearActiveIntent();
    }

    private applySession(
        target: ExternalPlayerName,
        session: ExternalPlayerSession
    ): boolean {
        const previous = this.target(target);
        const status = this.toRecoveryStatus(session.status);
        this.setTarget(target, {
            attempts: previous.attempts,
            sessionId: status === 'idle' ? null : session.id,
            status,
        });
        const active = this.activeIntentState();
        if (
            session.status !== 'launching' &&
            active?.target === target &&
            active.sessionId === session.id
        ) {
            this.clearActiveIntent();
        }
        return true;
    }

    private toRecoveryStatus(
        status: ExternalPlayerSession['status']
    ): ExternalRecoveryStatus {
        switch (status) {
            case 'launching':
                return 'launching';
            case 'opened':
                return 'started';
            case 'playing':
                return 'playing';
            case 'error':
                return 'error';
            case 'closed':
                return 'idle';
        }
    }

    private setTarget(
        target: ExternalPlayerName,
        state: ExternalRecoveryTargetState
    ): void {
        this.statesState.update((states) =>
            Object.freeze({
                ...states,
                [target]: Object.freeze(state),
            })
        );
    }

    private clearActiveIntent(): void {
        if (this.launchTimer !== null) {
            clearTimeout(this.launchTimer);
            this.launchTimer = null;
        }
        this.activeIntentState.set(null);
    }
}
