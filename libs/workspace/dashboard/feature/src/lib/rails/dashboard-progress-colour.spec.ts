import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Watch progress in app chrome reads one theme token, so a title's bar on a
// rail card, in the hero and in a catalog grid is the same colour. Live
// programme progress keeps the live accent (see the UI guidelines).
function styles(file: string): string {
    return readFileSync(resolve(__dirname, file), 'utf8');
}

/** The declarations of the first `selector { … }` rule, nesting excluded. */
function ruleBody(source: string, selector: RegExp): string {
    return (
        source.match(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`))?.[1] ??
        ''
    );
}

describe('dashboard watch-progress colour', () => {
    it('fills the rail card artwork bar with the watch-progress token', () => {
        const rail = styles('dashboard-rail.component.scss');
        const bar = rail.slice(rail.indexOf('.rail__art-progress {'));

        expect(ruleBody(bar, /\bi/)).toMatch(
            /background:\s*var\(--app-progress-color\);/
        );
    });

    it('fills the hero resume bar with the token and live bars with the live accent', () => {
        const hero = styles('dashboard-hero.component.scss');
        const bar = hero.slice(hero.indexOf('.hero__progress {'));

        expect(ruleBody(bar, /\bi/)).toMatch(
            /background:\s*var\(--app-progress-color\);/
        );
        expect(ruleBody(bar, /&--live i/)).toMatch(
            /background:\s*var\(--app-live-color\b/
        );
    });
});
