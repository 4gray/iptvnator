/**
 * Layout presets for the multiview grid. Each preset describes a CSS grid
 * template; tiles bind `grid-area: t0..tN` so a preset fully controls the
 * visual arrangement without component logic.
 */
export type MultiviewLayoutId =
    | 'grid-1x2'
    | 'grid-2x2'
    | 'focus-1-3'
    | 'grid-3x3';

export interface MultiviewLayoutPreset {
    readonly id: MultiviewLayoutId;
    readonly labelKey: string;
    readonly icon: string;
    /** Number of tiles the preset can display. */
    readonly capacity: number;
    /** Value for `grid-template-columns`. */
    readonly columns: string;
    /** Value for `grid-template-rows`. */
    readonly rows: string;
    /** Value for `grid-template-areas` (areas named t0..tN). */
    readonly areas: string;
}

export const MULTIVIEW_LAYOUT_PRESETS: readonly MultiviewLayoutPreset[] = [
    {
        id: 'grid-1x2',
        labelKey: 'MULTIVIEW.LAYOUT_1X2',
        icon: 'splitscreen_vertical_add',
        capacity: 2,
        columns: '1fr 1fr',
        rows: '1fr',
        areas: '"t0 t1"',
    },
    {
        id: 'grid-2x2',
        labelKey: 'MULTIVIEW.LAYOUT_2X2',
        icon: 'grid_view',
        capacity: 4,
        columns: '1fr 1fr',
        rows: '1fr 1fr',
        areas: '"t0 t1" "t2 t3"',
    },
    {
        id: 'focus-1-3',
        labelKey: 'MULTIVIEW.LAYOUT_1_PLUS_3',
        icon: 'view_sidebar',
        capacity: 4,
        columns: '2fr 1fr',
        rows: '1fr 1fr 1fr',
        areas: '"t0 t1" "t0 t2" "t0 t3"',
    },
    {
        id: 'grid-3x3',
        labelKey: 'MULTIVIEW.LAYOUT_3X3',
        icon: 'apps',
        capacity: 9,
        columns: 'repeat(3, 1fr)',
        rows: 'repeat(3, 1fr)',
        areas: '"t0 t1 t2" "t3 t4 t5" "t6 t7 t8"',
    },
];

export const DEFAULT_MULTIVIEW_LAYOUT_ID: MultiviewLayoutId = 'grid-2x2';

export function getMultiviewLayoutPreset(
    id: string | null | undefined
): MultiviewLayoutPreset {
    return (
        MULTIVIEW_LAYOUT_PRESETS.find((preset) => preset.id === id) ??
        MULTIVIEW_LAYOUT_PRESETS.find(
            (preset) => preset.id === DEFAULT_MULTIVIEW_LAYOUT_ID
        )!
    );
}

export function isMultiviewLayoutId(
    id: string | null | undefined
): id is MultiviewLayoutId {
    return MULTIVIEW_LAYOUT_PRESETS.some((preset) => preset.id === id);
}
