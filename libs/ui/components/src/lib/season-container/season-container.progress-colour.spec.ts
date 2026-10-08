import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Watch progress in app chrome reads one theme token in both season view
// modes: the episode item draws its own 3px bar on the thumbnail (see the UI
// guidelines' Progress Bars section).
const DIR = resolve(
    process.cwd(),
    'libs/ui/components/src/lib/season-container'
);

function read(file: string): string {
    return readFileSync(resolve(DIR, file), 'utf8');
}

describe('season container watch-progress colour', () => {
    it('fills the episode progress bar with the app watch-progress token', () => {
        const styles = read('episode-item.component.scss');
        const bar = styles.slice(styles.indexOf('.episode-item__progress {'));
        const fill = bar.match(/\bi\s*\{([^}]*)\}/)?.[1];

        expect(read('episode-item.component.html')).toContain(
            'class="episode-item__progress"'
        );
        expect(fill).toMatch(/background:\s*var\(--ep-accent\);/);
        expect(styles).toMatch(
            /--ep-accent:\s*var\(--app-progress-color, #78adff\);/
        );
    });
});
