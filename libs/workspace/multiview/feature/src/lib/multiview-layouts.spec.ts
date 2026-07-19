import {
    DEFAULT_MULTIVIEW_LAYOUT_ID,
    getMultiviewLayoutPreset,
    isMultiviewLayoutId,
    MULTIVIEW_LAYOUT_PRESETS,
} from './multiview-layouts';

describe('multiview layout presets', () => {
    it('defines four unique presets', () => {
        const ids = MULTIVIEW_LAYOUT_PRESETS.map((preset) => preset.id);
        expect(ids).toEqual([
            'grid-1x2',
            'grid-2x2',
            'focus-1-3',
            'grid-3x3',
        ]);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it.each(MULTIVIEW_LAYOUT_PRESETS.map((preset) => [preset.id, preset]))(
        'preset %s references every tile area exactly once up to its capacity',
        (_id, preset) => {
            const areaNames = (preset.areas.match(/t\d+/g) ?? []).sort();
            const uniqueAreas = [...new Set(areaNames)];

            expect(uniqueAreas.length).toBe(preset.capacity);
            for (let i = 0; i < preset.capacity; i++) {
                expect(uniqueAreas).toContain(`t${i}`);
            }
        }
    );

    it.each(MULTIVIEW_LAYOUT_PRESETS.map((preset) => [preset.id, preset]))(
        'preset %s has a translation key and icon',
        (_id, preset) => {
            expect(preset.labelKey).toMatch(/^MULTIVIEW\.LAYOUT/);
            expect(preset.icon.length).toBeGreaterThan(0);
        }
    );

    describe('getMultiviewLayoutPreset', () => {
        it('returns the requested preset', () => {
            expect(getMultiviewLayoutPreset('grid-3x3').capacity).toBe(9);
            expect(getMultiviewLayoutPreset('focus-1-3').columns).toBe(
                '2fr 1fr'
            );
        });

        it('falls back to the default preset for unknown ids', () => {
            expect(getMultiviewLayoutPreset('bogus').id).toBe(
                DEFAULT_MULTIVIEW_LAYOUT_ID
            );
            expect(getMultiviewLayoutPreset(null).id).toBe(
                DEFAULT_MULTIVIEW_LAYOUT_ID
            );
            expect(getMultiviewLayoutPreset(undefined).id).toBe(
                DEFAULT_MULTIVIEW_LAYOUT_ID
            );
        });
    });

    describe('isMultiviewLayoutId', () => {
        it('accepts known ids and rejects everything else', () => {
            expect(isMultiviewLayoutId('grid-1x2')).toBe(true);
            expect(isMultiviewLayoutId('grid-4x4')).toBe(false);
            expect(isMultiviewLayoutId(null)).toBe(false);
        });
    });
});
