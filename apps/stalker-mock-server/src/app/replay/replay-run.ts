import {
    REPLAY_MAX_REQUESTS,
    REPLAY_RUN_HARD_LIFETIME_MS,
    REPLAY_RUN_INACTIVITY_MS,
} from './replay.constants.js';
import {
    matchReplayRequest,
    ReplayMismatchCode,
} from './replay-request-matcher.js';
import { renderReplayResponse } from './replay-response.js';
import { parseReplayFixture } from './replay-schema.js';
import { createReplayRunId, ReplaySymbolTable } from './replay-symbols.js';
import {
    ReplayExpectation,
    ReplayFixtureV1,
    ReplayObservedRequest,
    ReplayRenderedResponse,
} from './replay.types.js';

export type ReplayRunErrorCode =
    | ReplayMismatchCode
    | 'unexpected-request'
    | 'cardinality-exceeded'
    | 'request-limit-exceeded'
    | 'run-expired'
    | 'run-finalized'
    | 'run-disposed';

export class ReplayRunError extends Error {
    constructor(readonly code: ReplayRunErrorCode) {
        super(`Replay run rejected request: ${code}.`);
        this.name = 'ReplayRunError';
    }
}

export interface ReplayLedger {
    operationCounts: Record<string, number>;
    mismatchCounts: Record<string, number>;
    terminalState: string | null;
}

export interface ReplayFinalizeIssue {
    code:
        | 'unexpected-request'
        | 'unmet-cardinality'
        | 'blocked-barrier'
        | 'nonterminal-state'
        | 'expected-endpoint-unreached'
        | 'request-limit-exceeded'
        | 'run-expired'
        | 'run-disposed';
    operation?: string;
}

export type ReplayFinalizeResult =
    | { ok: true; ledger: ReplayLedger }
    | {
          ok: false;
          issues: ReplayFinalizeIssue[];
          ledger: ReplayLedger;
      };

export interface CreateReplayRunOptions {
    runId?: string;
    now?: () => number;
}

interface PendingBarrierResponse {
    response: ReplayRenderedResponse;
    resolve: (response: ReplayRenderedResponse) => void;
    reject: (error: ReplayRunError) => void;
}

function sortedCounts(counts: Map<string, number>): Record<string, number> {
    return Object.fromEntries(
        [...counts.entries()]
            .filter(([, count]) => count > 0)
            .sort(([left], [right]) => left.localeCompare(right))
    );
}

export class ReplayRun {
    readonly runId: string;

    private readonly symbols: ReplaySymbolTable;
    private readonly now: () => number;
    private readonly createdAt: number;
    private lastActivityAt: number;
    private phaseIndex = 0;
    private state: string;
    private requestCount = 0;
    private readonly expectationCounts = new Map<string, number>();
    private readonly operationCounts = new Map<string, number>();
    private readonly mismatchCounts = new Map<string, number>();
    private readonly pendingBarrierResponses: PendingBarrierResponse[] = [];
    private barrierReleased = false;
    private hadUnexpectedRequest = false;
    private expectedEndpointReached = false;
    private expired = false;
    private disposed = false;
    private finalizedResult?: ReplayFinalizeResult;

    constructor(
        readonly fixture: ReplayFixtureV1,
        options: CreateReplayRunOptions = {}
    ) {
        this.runId = options.runId ?? createReplayRunId();
        this.now = options.now ?? Date.now;
        this.createdAt = this.now();
        this.lastActivityAt = this.createdAt;
        this.state = fixture.initialState;
        this.symbols = new ReplaySymbolTable(this.runId, fixture.symbols);
        for (const phase of fixture.phases) {
            for (const expectation of phase.expectations) {
                this.expectationCounts.set(expectation.id, 0);
            }
        }
    }

    getGeneratedInputs(): Readonly<Record<string, string>> {
        return this.disposed
            ? Object.freeze({})
            : this.symbols.clientInputSnapshot();
    }

    getLedger(): ReplayLedger {
        return {
            operationCounts: sortedCounts(this.operationCounts),
            mismatchCounts: sortedCounts(this.mismatchCounts),
            terminalState:
                this.state === this.fixture.terminalState
                    ? this.fixture.terminalState
                    : null,
        };
    }

    async request(
        observed: ReplayObservedRequest
    ): Promise<ReplayRenderedResponse> {
        this.assertActive();
        this.expireIfNeeded();
        if (this.expired) {
            throw new ReplayRunError('run-expired');
        }
        if (this.requestCount >= REPLAY_MAX_REQUESTS) {
            this.recordMismatch('request-limit-exceeded');
            throw new ReplayRunError('request-limit-exceeded');
        }
        this.requestCount += 1;
        this.lastActivityAt = this.now();

        const match = this.findMatch(observed);
        if (match === undefined) {
            return this.rejectUnexpected('unexpected-request');
        }
        if (!match.result.matched) {
            return this.rejectUnexpected(match.result.code);
        }

        const count = this.expectationCounts.get(match.expectation.id) ?? 0;
        if (count >= match.expectation.cardinality.max) {
            return this.rejectUnexpected('cardinality-exceeded');
        }
        this.expectationCounts.set(match.expectation.id, count + 1);
        if (
            observed.origin === this.fixture.expectedEndpoint.origin &&
            observed.path === this.fixture.expectedEndpoint.path
        ) {
            this.expectedEndpointReached = true;
        }
        this.operationCounts.set(
            match.expectation.operation,
            (this.operationCounts.get(match.expectation.operation) ?? 0) + 1
        );

        const response = renderReplayResponse(
            match.expectation.response,
            this.symbols
        );
        const phase = this.fixture.phases[this.phaseIndex];
        const barrier = phase?.barrier;

        if (barrier !== undefined && !this.barrierReleased) {
            const held = new Promise<ReplayRenderedResponse>(
                (resolve, reject) => {
                    this.pendingBarrierResponses.push({
                        response,
                        resolve,
                        reject,
                    });
                }
            );
            const phaseMatches = phase.expectations.reduce(
                (total, expectation) =>
                    total + (this.expectationCounts.get(expectation.id) ?? 0),
                0
            );
            if (phaseMatches >= barrier.releaseWhenMatched) {
                this.barrierReleased = true;
                const pending = this.pendingBarrierResponses.splice(0);
                pending.forEach((item) => item.resolve(item.response));
            }
            this.advanceCompletedPhase();
            return held;
        }

        this.advanceCompletedPhase();
        return response;
    }

    finalize(): ReplayFinalizeResult {
        if (this.finalizedResult !== undefined) {
            return this.finalizedResult;
        }

        this.expireIfNeeded();
        const issues: ReplayFinalizeIssue[] = [];
        if (this.disposed) {
            issues.push({ code: 'run-disposed' });
        }
        if (this.expired) {
            issues.push({ code: 'run-expired' });
        }
        if (this.hadUnexpectedRequest && this.fixture.failOnUnexpectedRequest) {
            issues.push({ code: 'unexpected-request' });
        }
        for (const phase of this.fixture.phases) {
            for (const expectation of phase.expectations) {
                if (
                    (this.expectationCounts.get(expectation.id) ?? 0) <
                    expectation.cardinality.min
                ) {
                    issues.push({
                        code: 'unmet-cardinality',
                        operation: expectation.operation,
                    });
                }
            }
        }
        if (this.pendingBarrierResponses.length > 0 && !this.barrierReleased) {
            issues.push({ code: 'blocked-barrier' });
        }
        if (this.state !== this.fixture.terminalState) {
            issues.push({ code: 'nonterminal-state' });
        }
        if (!this.expectedEndpointReached) {
            issues.push({ code: 'expected-endpoint-unreached' });
        }
        if (this.mismatchCounts.has('request-limit-exceeded')) {
            issues.push({ code: 'request-limit-exceeded' });
        }

        const ledger = this.getLedger();
        this.finalizedResult =
            issues.length === 0
                ? { ok: true, ledger }
                : { ok: false, issues, ledger };
        return this.finalizedResult;
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        const pending = this.pendingBarrierResponses.splice(0);
        pending.forEach((item) =>
            item.reject(new ReplayRunError('run-disposed'))
        );
        this.symbols.clear();
    }

    private assertActive(): void {
        if (this.disposed) {
            throw new ReplayRunError('run-disposed');
        }
        if (this.finalizedResult !== undefined) {
            throw new ReplayRunError('run-finalized');
        }
    }

    private expireIfNeeded(): void {
        if (this.expired || this.disposed) {
            return;
        }
        const current = this.now();
        if (
            current - this.createdAt >= REPLAY_RUN_HARD_LIFETIME_MS ||
            current - this.lastActivityAt >= REPLAY_RUN_INACTIVITY_MS
        ) {
            this.expired = true;
            this.recordMismatch('run-expired');
            const pending = this.pendingBarrierResponses.splice(0);
            pending.forEach((item) =>
                item.reject(new ReplayRunError('run-expired'))
            );
        }
    }

    private currentExpectations(): ReplayExpectation[] {
        const phase = this.fixture.phases[this.phaseIndex];
        if (phase === undefined) {
            return [];
        }
        if (phase.mode === 'unordered') {
            return phase.expectations;
        }
        const next = phase.expectations.find(
            (expectation) =>
                (this.expectationCounts.get(expectation.id) ?? 0) <
                expectation.cardinality.min
        );
        return next === undefined ? [] : [next];
    }

    private findMatch(observed: ReplayObservedRequest):
        | {
              expectation: ReplayExpectation;
              result: ReturnType<typeof matchReplayRequest>;
          }
        | undefined {
        let firstMismatch:
            | {
                  expectation: ReplayExpectation;
                  result: ReturnType<typeof matchReplayRequest>;
              }
            | undefined;
        for (const expectation of this.currentExpectations()) {
            const result = matchReplayRequest(
                expectation,
                observed,
                this.symbols
            );
            if (result.matched) {
                return { expectation, result };
            }
            if (
                firstMismatch === undefined &&
                expectation.origin === observed.origin &&
                expectation.method === observed.method &&
                expectation.path === observed.path
            ) {
                firstMismatch = { expectation, result };
            }
        }
        return firstMismatch;
    }

    private rejectUnexpected(
        code: ReplayMismatchCode | 'unexpected-request' | 'cardinality-exceeded'
    ): never {
        this.hadUnexpectedRequest = true;
        this.recordMismatch(code);
        throw new ReplayRunError(code);
    }

    private recordMismatch(code: string): void {
        this.mismatchCounts.set(code, (this.mismatchCounts.get(code) ?? 0) + 1);
    }

    private advanceCompletedPhase(): void {
        const phase = this.fixture.phases[this.phaseIndex];
        if (phase === undefined) {
            return;
        }
        const minimumsMet = phase.expectations.every(
            (expectation) =>
                (this.expectationCounts.get(expectation.id) ?? 0) >=
                expectation.cardinality.min
        );
        if (
            !minimumsMet ||
            (phase.barrier !== undefined && !this.barrierReleased)
        ) {
            return;
        }

        this.state = phase.nextState;
        this.phaseIndex += 1;
        this.barrierReleased = false;
    }
}

export function createReplayRun(
    fixture: ReplayFixtureV1 | unknown,
    options: CreateReplayRunOptions = {}
): ReplayRun {
    return new ReplayRun(parseReplayFixture(fixture), options);
}
