export interface ShakaErrorLike {
    readonly severity: number;
    readonly category: number;
    readonly code: number;
    readonly data?: readonly unknown[];
}
