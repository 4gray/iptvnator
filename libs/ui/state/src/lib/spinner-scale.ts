/**
 * The app's one spinner scale (UI-44). Every `mat-spinner` and
 * `mat-progress-spinner` uses one of these diameters; `pnpm run
 * ui:states:check` rejects any other.
 *
 * - `sm` (16px): inside a button, a chip, a row or a line of text;
 * - `md` (24px): a list footer, a dialog section or a panel;
 * - `lg` (40px): a page or a main pane that has nothing else to show.
 */
export const SPINNER_DIAMETERS = {
    sm: 16,
    md: 24,
    lg: 40,
} as const;

export type SpinnerSize = keyof typeof SPINNER_DIAMETERS;
