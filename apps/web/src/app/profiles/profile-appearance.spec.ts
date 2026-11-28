import { PROFILE_LIMIT } from '@iptvnator/shared/interfaces/profiles';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    isSingleEmoji,
    PROFILE_SWATCHES,
    readableTextColour,
} from './profile-appearance';

describe('PROFILE_SWATCHES', () => {
    it('offers a distinct colour for every profile a household can have', () => {
        expect(new Set(PROFILE_SWATCHES.map((s) => s.hex)).size).toBe(
            PROFILE_SWATCHES.length
        );
        expect(PROFILE_SWATCHES.length).toBeGreaterThanOrEqual(PROFILE_LIMIT);
        for (const { hex } of PROFILE_SWATCHES)
            expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    });

    it('names every colour in English, for the swatch label', () => {
        const names = (
            JSON.parse(
                readFileSync(
                    resolve(process.cwd(), 'apps/web/src/assets/i18n/en.json'),
                    'utf8'
                )
            ) as { THEMES: Record<string, string> }
        ).THEMES;
        for (const { id } of PROFILE_SWATCHES)
            expect(names[`ACCENT_${id.toUpperCase()}`]).toBeTruthy();
    });

    it('keeps the initial readable on every colour', () => {
        for (const { hex } of PROFILE_SWATCHES)
            expect(['#000000', '#ffffff']).toContain(readableTextColour(hex));
    });
});

describe('isSingleEmoji', () => {
    it.each(['🦊', '👩‍👩‍👧', '🇨🇭', '1️⃣', '👍🏽'])('accepts %s', (value) => {
        expect(isSingleEmoji(value)).toBe(true);
    });

    it.each(['', 'a', '🦊🦊', 'ab🦊', '1', '👩‍👩‍👧'.repeat(8)])(
        'refuses %j',
        (value) => {
            expect(isSingleEmoji(value)).toBe(false);
        }
    );
});
