import { performance } from 'node:perf_hooks';
import type { Request, Response } from 'express';
import { resetAll } from './data-store.js';
import { buildPerformanceManifest } from './performance-manifest.js';
import { PerformanceControlError } from './performance-control-validation.js';
import {
    PERFORMANCE_CONTROL_LIMITS,
    type PerformanceControlState,
    type PerformanceIdentity,
    type PerformanceLedgerEntry,
    type PerformanceLifecycleStatus,
    type PerformanceManifest,
    type PerformanceRuleInput,
    type PerformanceTransport,
} from './performance-control.types.js';
import {
    identityKey,
    PerformanceOccurrenceTracker,
    ruleMatchKey,
} from './performance-occurrences.js';

export {
    PERFORMANCE_CONTROL_LIMITS,
    type PerformanceAction,
    type PerformanceControlState,
    type PerformanceLedgerEntry,
    type PerformanceLifecycleStatus,
    type PerformanceManifest,
    type PerformanceOccurrenceState,
    type PerformanceRuleInput,
    type PerformanceRuleMatch,
    type PerformanceTransport,
} from './performance-control.types.js';

type HeldOutcome = 'released' | 'aborted' | 'reset';
interface PendingRequest {
    readonly kind: 'barrier' | 'delay';
    settle(outcome: HeldOutcome): void;
}

export class XtreamPerformanceController {
    private epoch = 1;
    private prepared: PerformanceManifest | null = null;
    private readonly rules = new Map<string, PerformanceRuleInput>();
    private readonly matchKeys = new Set<string>();
    private readonly seenRuleIds = new Set<string>();
    private acceptedRuleCount = 0;
    private readonly pending = new Map<string, PendingRequest>();
    private readonly occurrences = new PerformanceOccurrenceTracker();
    private readonly ledger: PerformanceLedgerEntry[] = [];

    prepare(): PerformanceManifest {
        this.prepared ??= buildPerformanceManifest(this.epoch);
        return this.prepared;
    }

    reset(mode: 'all' | 'observations'): { epoch: number; mode: string } {
        this.settlePending('reset');
        this.clearObservations();
        if (mode === 'all') {
            resetAll();
            this.prepared = null;
            this.epoch += 1;
        }
        return { epoch: this.epoch, mode };
    }

    addRule(input: PerformanceRuleInput): PerformanceRuleInput {
        if (this.acceptedRuleCount >= PERFORMANCE_CONTROL_LIMITS.rules) {
            conflict('control-rule-limit');
        }
        if (this.seenRuleIds.has(input.id)) conflict('duplicate-rule-id');
        const matchKey = ruleMatchKey(input.match);
        if (this.matchKeys.has(matchKey)) conflict('duplicate-rule-match');
        if (input.match.occurrence <= this.occurrences.count(input.match)) {
            conflict('past-rule-occurrence');
        }

        this.acceptedRuleCount += 1;
        this.seenRuleIds.add(input.id);
        this.matchKeys.add(matchKey);
        this.rules.set(input.id, input);
        return input;
    }

    releaseBarrier(id: string): boolean {
        const pending = this.pending.get(id);
        if (!pending || pending.kind !== 'barrier') return false;
        this.settleOnePending(id, 'released');
        return true;
    }

    snapshot(): PerformanceControlState {
        const heldIds = [...this.pending.entries()]
            .filter(([, request]) => request.kind === 'barrier')
            .map(([id]) => id);
        return {
            epoch: this.epoch,
            prepared: this.prepared,
            rules: [...this.rules.values()],
            heldIds,
            heldCount: heldIds.length,
            occurrences: this.occurrences.snapshot(),
            ledger: [...this.ledger],
        };
    }

    async intercept(
        request: Request,
        response: Response,
        transport: PerformanceTransport,
        dispatch: () => void | Promise<void>
    ): Promise<void> {
        const identity = this.occurrences.next(request, transport, this.epoch);
        this.record(identity, 'arrived');
        let terminal = false;
        let suppressTerminal = false;
        let pendingId: string | undefined;

        const cleanup = () => {
            request.off('aborted', onAborted);
            response.off('finish', onFinished);
            response.off('close', onClosed);
        };
        const finish = (status: 'responded' | 'aborted') => {
            if (terminal) return;
            terminal = true;
            cleanup();
            if (pendingId) {
                this.settleOnePending(pendingId, 'aborted');
                pendingId = undefined;
            }
            if (!suppressTerminal) this.record(identity, status);
        };
        const onAborted = () => finish('aborted');
        const onFinished = () => finish('responded');
        const onClosed = () => {
            if (!response.writableFinished) finish('aborted');
        };
        request.once('aborted', onAborted);
        response.once('finish', onFinished);
        response.once('close', onClosed);

        const rule = this.consumeRule(identity);
        if (rule?.kind === 'barrier') {
            this.record(identity, 'blocked');
            pendingId = rule.id;
            const outcome = await new Promise<HeldOutcome>((resolve) => {
                this.pending.set(rule.id, {
                    kind: 'barrier',
                    settle: (value) => {
                        if (value === 'reset') {
                            suppressTerminal = true;
                            cleanup();
                        }
                        resolve(value);
                    },
                });
            });
            pendingId = undefined;
            if (this.finishControlledWait(outcome, response)) return;
        } else if (rule?.kind === 'delay') {
            this.record(identity, 'delayed');
            pendingId = rule.id;
            const outcome = await new Promise<HeldOutcome>((resolve) => {
                const timer = setTimeout(
                    () => this.settleOnePending(rule.id, 'released'),
                    rule.milliseconds
                );
                this.pending.set(rule.id, {
                    kind: 'delay',
                    settle: (value) => {
                        clearTimeout(timer);
                        if (value === 'reset') {
                            suppressTerminal = true;
                            cleanup();
                        }
                        resolve(value);
                    },
                });
            });
            pendingId = undefined;
            if (this.finishControlledWait(outcome, response)) return;
        }

        if (request.aborted || response.destroyed) {
            finish('aborted');
            return;
        }
        await dispatch();
    }

    private consumeRule(
        identity: PerformanceIdentity
    ): PerformanceRuleInput | undefined {
        for (const rule of this.rules.values()) {
            if (ruleMatchKey(rule.match) !== identityKey(identity)) continue;
            this.rules.delete(rule.id);
            this.matchKeys.delete(ruleMatchKey(rule.match));
            return rule;
        }
        return undefined;
    }

    private record(
        identity: PerformanceIdentity,
        status: PerformanceLifecycleStatus
    ): void {
        this.ledger.push({
            ...identity,
            status,
            atMs: Number(performance.now().toFixed(3)),
        });
        if (this.ledger.length > PERFORMANCE_CONTROL_LIMITS.ledger) {
            this.ledger.splice(
                0,
                this.ledger.length - PERFORMANCE_CONTROL_LIMITS.ledger
            );
        }
    }

    private finishControlledWait(
        outcome: HeldOutcome,
        response: Response
    ): boolean {
        if (outcome === 'released') return false;
        if (
            outcome === 'reset' &&
            !response.headersSent &&
            !response.destroyed
        ) {
            response.status(409).json({ error: 'control-reset' });
        }
        return true;
    }

    private settlePending(outcome: HeldOutcome): void {
        for (const id of [...this.pending.keys()]) {
            this.settleOnePending(id, outcome);
        }
    }

    private settleOnePending(id: string, outcome: HeldOutcome): void {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.settle(outcome);
    }

    private clearObservations(): void {
        this.rules.clear();
        this.matchKeys.clear();
        this.seenRuleIds.clear();
        this.acceptedRuleCount = 0;
        this.occurrences.clear();
        this.ledger.length = 0;
    }
}

function conflict(code: string): never {
    throw new PerformanceControlError(409, code);
}
