import type { Request } from 'express';
import {
    canonicalObservedAction,
    isAllowedPerformanceCategory,
    PerformanceControlError,
} from './performance-control-validation.js';
import {
    PERFORMANCE_CONTROL_LIMITS,
    type PerformanceAction,
    type PerformanceIdentity,
    type PerformanceOccurrenceState,
    type PerformanceRuleMatch,
    type PerformanceTransport,
} from './performance-control.types.js';
import { getScenario } from './scenarios.js';

export class PerformanceOccurrenceTracker {
    private readonly entries = new Map<string, PerformanceOccurrenceState>();

    next(
        request: Request,
        transport: PerformanceTransport,
        epoch: number
    ): PerformanceIdentity {
        const username = stringQuery(request.query['username']);
        const password = stringQuery(request.query['password']);
        const scenario = getScenario(username, password).name;
        const action = canonicalObservedAction(request.query['action']);
        const rawCategoryId = stringQuery(request.query['category_id']);
        const categoryId =
            scenario === 'performance-100k' &&
            action !== 'unknown' &&
            rawCategoryId !== 'all' &&
            isAllowedPerformanceCategory(action, rawCategoryId)
                ? rawCategoryId
                : 'all';
        const base = { scenario, transport, action, categoryId };
        const key = baseIdentityKey(base);
        const previous = this.entries.get(key);
        if (
            !previous &&
            this.entries.size >= PERFORMANCE_CONTROL_LIMITS.occurrences
        ) {
            throw new PerformanceControlError(503, 'control-occurrence-limit');
        }
        const count = (previous?.count ?? 0) + 1;
        this.entries.set(key, { ...base, count });
        return { epoch, ...base, occurrence: count };
    }

    count(match: PerformanceRuleMatch): number {
        return this.entries.get(baseIdentityKey(match))?.count ?? 0;
    }

    snapshot(): PerformanceOccurrenceState[] {
        return [...this.entries.values()];
    }

    clear(): void {
        this.entries.clear();
    }
}

export function ruleMatchKey(match: PerformanceRuleMatch): string {
    return JSON.stringify([
        match.scenario,
        match.transport,
        match.action,
        match.categoryId,
        match.occurrence,
    ]);
}

export function identityKey(identity: PerformanceIdentity): string {
    return JSON.stringify([
        identity.scenario,
        identity.transport,
        identity.action,
        identity.categoryId,
        identity.occurrence,
    ]);
}

function baseIdentityKey(
    identity:
        | Omit<PerformanceRuleMatch, 'occurrence'>
        | {
              scenario: string;
              transport: PerformanceTransport;
              action: PerformanceAction | 'unknown';
              categoryId: string;
          }
): string {
    return JSON.stringify([
        identity.scenario,
        identity.transport,
        identity.action,
        identity.categoryId,
    ]);
}

function stringQuery(value: unknown): string {
    return typeof value === 'string' ? value : '';
}
