import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Watch progress in app chrome reads one theme token in both season view
// modes; the list rows draw their own fill rather than the grid's capsule
// (see the UI guidelines' Progress Bars section).
const DIR = resolve(
    process.cwd(),
    'libs/ui/components/src/lib/season-container'
);

function read(file: string): string {
    return readFileSync(resolve(DIR, file), 'utf8');
}

describe('season container watch-progress colour', () => {
    it('fills list rows with the app watch-progress token', () => {
        const styles = read('season-container.component.scss');
        const listItem = styles.slice(styles.indexOf('.episode-list-item {'));
        const fill = listItem.match(/&__progress-fill\s*\{([^}]*)\}/)?.[1];

        expect(read('season-container.component.html')).toContain(
            'class="episode-list-item__progress-fill"'
        );
        expect(fill).toMatch(/background:\s*var\(--app-progress-color\);/);
    });
});
