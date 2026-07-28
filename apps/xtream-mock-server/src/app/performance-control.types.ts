export const PERFORMANCE_CONTROL_LIMITS = {
    jsonBytes: 16 * 1024,
    ledger: 128,
    occurrences: 512,
    rules: 32,
} as const;

export type PerformanceTransport = 'direct' | 'proxy';
export type PerformanceAction =
    | 'get_account_info'
    | 'get_live_categories'
    | 'get_vod_categories'
    | 'get_series_categories'
    | 'get_live_streams'
    | 'get_vod_streams'
    | 'get_series'
    | 'get_vod_info'
    | 'get_series_info'
    | 'get_short_epg'
    | 'get_simple_data_table'
    | 'get_simple_date_table';
export type PerformanceLifecycleStatus =
    'arrived' | 'blocked' | 'delayed' | 'responded' | 'aborted';

export interface PerformanceRuleMatch {
    readonly scenario: 'performance-100k';
    readonly transport: PerformanceTransport;
    readonly action: PerformanceAction;
    readonly occurrence: number;
    readonly categoryId: string;
}

export type PerformanceRuleInput =
    | {
          readonly id: string;
          readonly kind: 'barrier';
          readonly match: PerformanceRuleMatch;
      }
    | {
          readonly id: string;
          readonly kind: 'delay';
          readonly match: PerformanceRuleMatch;
          readonly milliseconds: number;
      };

export interface PerformanceManifest {
    readonly epoch: number;
    readonly scenario: 'performance-100k';
    readonly seed: number;
    readonly counts: {
        readonly categories: {
            readonly live: number;
            readonly vod: number;
            readonly series: number;
            readonly total: number;
        };
        readonly items: {
            readonly live: number;
            readonly vod: number;
            readonly series: number;
            readonly total: number;
        };
    };
    readonly bytes: number;
    readonly catalogSha256: string;
}

export interface PerformanceIdentity {
    readonly epoch: number;
    readonly scenario: string;
    readonly transport: PerformanceTransport;
    readonly action: PerformanceAction | 'unknown';
    readonly categoryId: string;
    readonly occurrence: number;
}

export interface PerformanceOccurrenceState {
    readonly scenario: string;
    readonly transport: PerformanceTransport;
    readonly action: PerformanceAction | 'unknown';
    readonly categoryId: string;
    readonly count: number;
}

export interface PerformanceLedgerEntry extends PerformanceIdentity {
    readonly status: PerformanceLifecycleStatus;
    readonly atMs: number;
}

export interface PerformanceControlState {
    readonly epoch: number;
    readonly prepared: PerformanceManifest | null;
    readonly rules: ReadonlyArray<PerformanceRuleInput>;
    readonly heldIds: string[];
    readonly heldCount: number;
    readonly occurrences: ReadonlyArray<PerformanceOccurrenceState>;
    readonly ledger: ReadonlyArray<PerformanceLedgerEntry>;
}
