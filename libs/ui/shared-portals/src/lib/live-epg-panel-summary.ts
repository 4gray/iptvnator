export interface LiveEpgPanelSummary {
    readonly title?: string | null;
    readonly start?: string | number | Date | null;
    readonly stop?: string | number | Date | null;
    readonly progress?: number | null;
}
