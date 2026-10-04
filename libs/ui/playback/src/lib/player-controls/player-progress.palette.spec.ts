import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { PLAYER_PROGRESS_COLOR } from './player-palette';

// Watch progress inside the player is one colour: the fixed `--pc-progress`,
// never the app theme and never a literal of its own. The same episode must
// read the same in the dock's Up next card, the Up Next rail and the
// fullscreen episode panel (see the UI guidelines' Progress Bars section).
const LIB_DIR = resolve(process.cwd(), 'libs/ui/playback/src/lib');
const CONTROLS_DIR = resolve(LIB_DIR, 'player-controls');

function stripComments(source: string): string {
    return source
        .replace(/\r\n/g, '\n')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

function listSources(dir: string, extension: string): string[] {
    return readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .filter((file) => file.endsWith(extension))
        .filter((file) => !/\.spec(-[a-z]+)?\.ts$/.test(file))
        .map((file) => resolve(dir, file));
}

function read(file: string): string {
    return stripComments(readFileSync(file, 'utf8'));
}

/** The declarations of the first rule whose selector list is exactly `selector`. */
function ruleBody(source: string, selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (
        source.match(
            new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`)
        )?.[1] ?? ''
    );
}

const PALETTE = read(resolve(CONTROLS_DIR, '_player-palette.scss'));
const STYLESHEETS = listSources(LIB_DIR, '.scss');

const PROGRESS_FILLS: ReadonlyArray<[file: string, selector: string]> = [
    [
        'player-controls/player-timeline.component.scss',
        '.player-controls__timeline-fill',
    ],
    [
        'player-controls/player-up-next-card.component.scss',
        '.player-up-next__progress-bar',
    ],
    [
        'portal-inline-player/up-next-rail.component.scss',
        '.up-next__progress-bar',
    ],
    [
        'fullscreen-episode-panel/fullscreen-episode-panel.component.scss',
        '.episode-panel__progress-bar',
    ],
];

describe('player watch-progress colour', () => {
    it('draws every progress fill inside the player with --pc-progress', () => {
        for (const [file, selector] of PROGRESS_FILLS) {
            expect({
                file,
                body: ruleBody(read(resolve(LIB_DIR, file)), selector),
            }).toEqual({
                file,
                body: expect.stringMatching(
                    /background:\s*var\(--pc-progress\);/
                ),
            });
        }
    });

    it('leaves no other BEM progress fill on a colour of its own', () => {
        const fills = STYLESHEETS.flatMap((file) =>
            [
                ...read(file).matchAll(
                    /([^{}]*__progress-(?:bar|fill))\s*\{([^}]*)\}/g
                ),
            ].map(([, selector, body]) => ({
                fill: `${relative(LIB_DIR, file)} ${selector.trim()}`,
                background: body.match(
                    /background(?:-color)?:\s*([^;]+);/
                )?.[1],
            }))
        );

        expect(fills.length).toBeGreaterThanOrEqual(3);
        expect(
            fills.filter(
                ({ background }) => background !== 'var(--pc-progress)'
            )
        ).toEqual([]);
    });

    it('declares --pc-progress wherever it is read outside the controls host', () => {
        // A top-level `:host` block runs to the first unindented `}`; Sass
        // interpolation (`#{...}`) inside it would end `ruleBody` too early.
        const declaresOnHost = (source: string) =>
            /@include palette\.progress-token;/.test(
                source.match(/^:host\s*\{([\s\S]*?)^\}/m)?.[1] ?? ''
            );

        // The host declares the palette its own children (timeline, card) read.
        expect(
            declaresOnHost(
                read(resolve(CONTROLS_DIR, 'player-controls.component.scss'))
            )
        ).toBe(true);

        const readers = STYLESHEETS.filter(
            (file) =>
                !file.startsWith(CONTROLS_DIR + sep) &&
                read(file).includes('var(--pc-progress')
        );
        expect(
            readers
                .map((file) => relative(LIB_DIR, file).split(sep).join('/'))
                .sort()
        ).toEqual([
            'fullscreen-episode-panel/fullscreen-episode-panel.component.scss',
            'portal-inline-player/up-next-rail.component.scss',
        ]);
        for (const file of readers) {
            expect({ file, declared: declaresOnHost(read(file)) }).toEqual({
                file,
                declared: true,
            });
        }
    });

    it('gives ArtPlayer the same colour as the Sass palette', () => {
        const accent = PALETTE.match(/\$accent-blue:\s*(#[0-9a-f]{6});/i)?.[1];

        expect(accent).toBeDefined();
        expect(PALETTE).toMatch(
            /@mixin progress-token\s*\{\s*--pc-progress:\s*#\{\$accent-blue\};\s*\}/
        );
        expect(PLAYER_PROGRESS_COLOR.toLowerCase()).toBe(accent?.toLowerCase());
        expect(
            read(resolve(LIB_DIR, 'art-player/art-player.component.ts'))
        ).toMatch(/theme:\s*PLAYER_PROGRESS_COLOR,/);
    });

    it('keeps the old progress reds out of the player', () => {
        const sources = [
            ...STYLESHEETS,
            ...listSources(LIB_DIR, '.ts'),
            ...listSources(LIB_DIR, '.html'),
        ];
        const offenders = sources
            .filter((file) => /#e50914|#ff0000\b/i.test(read(file)))
            .map((file) => relative(LIB_DIR, file));

        expect(sources.length).toBeGreaterThan(50);
        expect(offenders).toEqual([]);
    });
});
