export const STALKER_WATCHDOG_INTERVALS = {
    defaultMs: 25_000,
    jitterRatio: 0.1,
    maximumMs: 5 * 60_000,
    minimumMs: 10_000,
} as const;

const PROFILE_INTERVAL_FIELDS = ['timeslot', 'watchdog_timeout'] as const;
const DECIMAL_SECONDS = /^(?:\d+(?:\.\d*)?|\.\d+)$/;
const DEFAULT_WATCHDOG_JITTER = () => Math.random() * 2 - 1;

export type StalkerWatchdogClockCallback = () => void | Promise<void>;

export interface StalkerWatchdogClock {
    schedule(
        callback: StalkerWatchdogClockCallback,
        delayMs: number
    ): () => void;
}

export interface StalkerWatchdogTarget {
    readonly principal: string;
    readonly sessionKey: string;
}

export interface StalkerWatchdogActivation extends StalkerWatchdogTarget {
    readonly leaseRef: string;
    readonly profile?: Readonly<Record<string, unknown>>;
}

export type StalkerWatchdogDeactivation = Pick<
    StalkerWatchdogActivation,
    'leaseRef' | 'principal' | 'sessionKey'
>;

export interface StalkerWatchdogCallbacks {
    readonly isWireActive: (
        target: Readonly<StalkerWatchdogTarget>
    ) => boolean | Promise<boolean>;
    /**
     * Returns the current refresh promise when one exists. The callback must
     * never start a refresh: a watchdog tick only joins manager-owned work.
     */
    readonly joinRefresh: (
        target: Readonly<StalkerWatchdogTarget>
    ) => Promise<void> | undefined;
    readonly ping: (target: Readonly<StalkerWatchdogTarget>) => Promise<void>;
}

export interface StalkerWatchdogDependencies extends StalkerWatchdogCallbacks {
    readonly clock?: StalkerWatchdogClock;
    /**
     * Returns a deterministic jitter unit in [-1, 1]. Values outside the
     * range are clamped; non-finite values mean no jitter.
     */
    readonly jitter?: () => number;
}

interface StalkerWatchdogEntry {
    readonly baseIntervalMs: number;
    cancelScheduled?: () => void;
    inFlight?: Promise<void>;
    readonly key: string;
    readonly leaseRefs: Set<string>;
    readonly target: Readonly<StalkerWatchdogTarget>;
}

const SYSTEM_WATCHDOG_CLOCK: StalkerWatchdogClock = {
    schedule(callback, delayMs) {
        const timer = setTimeout(() => {
            void callback();
        }, delayMs);
        return () => clearTimeout(timer);
    },
};

export function resolveStalkerWatchdogIntervalMs(
    profile?: Readonly<Record<string, unknown>> | null,
    jitterUnit = 0
): number {
    const baseIntervalMs = resolveBaseIntervalMs(profile);
    const normalizedJitter = normalizeJitter(jitterUnit);
    const jitteredIntervalMs =
        baseIntervalMs *
        (1 + STALKER_WATCHDOG_INTERVALS.jitterRatio * normalizedJitter);
    return Math.round(clampIntervalMs(jitteredIntervalMs));
}

export class StalkerWatchdog {
    readonly #callbacks: StalkerWatchdogCallbacks;
    readonly #clock: StalkerWatchdogClock;
    readonly #entries = new Map<string, StalkerWatchdogEntry>();
    readonly #jitter: () => number;

    constructor(dependencies: StalkerWatchdogDependencies) {
        this.#callbacks = dependencies;
        this.#clock = dependencies.clock ?? SYSTEM_WATCHDOG_CLOCK;
        this.#jitter = dependencies.jitter ?? DEFAULT_WATCHDOG_JITTER;
    }

    activate(activation: StalkerWatchdogActivation): void {
        const key = createEntryKey(activation);
        const existing = this.#entries.get(key);
        if (existing) {
            existing.leaseRefs.add(activation.leaseRef);
            return;
        }

        const entry: StalkerWatchdogEntry = {
            baseIntervalMs: resolveStalkerWatchdogIntervalMs(
                activation.profile
            ),
            key,
            leaseRefs: new Set([activation.leaseRef]),
            target: Object.freeze({
                principal: activation.principal,
                sessionKey: activation.sessionKey,
            }),
        };
        this.#entries.set(key, entry);
        this.#schedule(entry);
    }

    deactivate(deactivation: StalkerWatchdogDeactivation): void {
        const entry = this.#entries.get(createEntryKey(deactivation));
        if (!entry) {
            return;
        }
        entry.leaseRefs.delete(deactivation.leaseRef);
        if (entry.leaseRefs.size === 0) {
            this.#stop(entry);
        }
    }

    cleanupSession(sessionKey: string): void {
        for (const entry of this.#entries.values()) {
            if (entry.target.sessionKey === sessionKey) {
                this.#stop(entry);
            }
        }
    }

    cleanupAll(): void {
        for (const entry of this.#entries.values()) {
            this.#stop(entry);
        }
    }

    #schedule(entry: StalkerWatchdogEntry): void {
        if (!this.#isCurrent(entry) || entry.cancelScheduled) {
            return;
        }
        const delayMs = applyJitter(entry.baseIntervalMs, this.#readJitter());
        entry.cancelScheduled = this.#clock.schedule(() => {
            entry.cancelScheduled = undefined;
            return this.#runSerializedTick(entry);
        }, delayMs);
    }

    async #runSerializedTick(entry: StalkerWatchdogEntry): Promise<void> {
        if (entry.inFlight) {
            await entry.inFlight;
            return;
        }

        const operation = this.#runTick(entry);
        entry.inFlight = operation;
        try {
            await operation;
        } finally {
            if (entry.inFlight === operation) {
                entry.inFlight = undefined;
            }
            this.#schedule(entry);
        }
    }

    async #runTick(entry: StalkerWatchdogEntry): Promise<void> {
        try {
            if (!(await this.#mayPing(entry))) {
                return;
            }

            const refresh = this.#callbacks.joinRefresh(entry.target);
            if (refresh) {
                await refresh;
            }

            if (!(await this.#mayPing(entry))) {
                return;
            }

            await this.#callbacks.ping(entry.target);
        } catch {
            // The manager-owned callbacks classify/report failures. A failed
            // tick remains non-fatal so a later interval can recover.
        }
    }

    async #mayPing(entry: StalkerWatchdogEntry): Promise<boolean> {
        if (!this.#isCurrent(entry)) {
            return false;
        }
        const wireActive = await this.#callbacks.isWireActive(entry.target);
        return wireActive && this.#isCurrent(entry);
    }

    #stop(entry: StalkerWatchdogEntry): void {
        if (this.#entries.get(entry.key) !== entry) {
            return;
        }
        this.#entries.delete(entry.key);
        entry.cancelScheduled?.();
        entry.cancelScheduled = undefined;
        entry.leaseRefs.clear();
    }

    #isCurrent(entry: StalkerWatchdogEntry): boolean {
        return (
            this.#entries.get(entry.key) === entry && entry.leaseRefs.size > 0
        );
    }

    #readJitter(): number {
        try {
            return this.#jitter();
        } catch {
            return 0;
        }
    }
}

function resolveBaseIntervalMs(
    profile?: Readonly<Record<string, unknown>> | null
): number {
    for (const field of PROFILE_INTERVAL_FIELDS) {
        const seconds = parsePositiveSeconds(profile?.[field]);
        if (seconds !== undefined) {
            return clampIntervalMs(seconds * 1_000);
        }
    }
    return STALKER_WATCHDOG_INTERVALS.defaultMs;
}

function parsePositiveSeconds(value: unknown): number | undefined {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value > 0 ? value : undefined;
    }
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim();
    if (!DECIMAL_SECONDS.test(normalized)) {
        return undefined;
    }
    const seconds = Number(normalized);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

function normalizeJitter(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(-1, Math.min(1, value));
}

function applyJitter(baseIntervalMs: number, jitterUnit: number): number {
    const jitteredIntervalMs =
        baseIntervalMs *
        (1 +
            STALKER_WATCHDOG_INTERVALS.jitterRatio *
                normalizeJitter(jitterUnit));
    return Math.round(clampIntervalMs(jitteredIntervalMs));
}

function clampIntervalMs(value: number): number {
    return Math.max(
        STALKER_WATCHDOG_INTERVALS.minimumMs,
        Math.min(STALKER_WATCHDOG_INTERVALS.maximumMs, value)
    );
}

function createEntryKey(target: StalkerWatchdogTarget): string {
    return JSON.stringify([target.sessionKey, target.principal]);
}
