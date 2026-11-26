import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    compareWithBaseline,
    findStateFindings,
    isEmptyBlockClass,
    loweredBaseline,
} from './check-state-blocks.mjs';

test('names empty and no-results blocks, not their modifiers or elements', () => {
    assert.equal(isEmptyBlockClass('empty-state'), true);
    assert.equal(isEmptyBlockClass('grid-empty-state'), true);
    assert.equal(isEmptyBlockClass('no-results-state'), true);
    assert.equal(isEmptyBlockClass('rails-page--empty'), false);
    assert.equal(isEmptyBlockClass('emptyish'), false);
    assert.equal(isEmptyBlockClass('channel-row'), false);
});

test('counts the outermost bespoke block once', () => {
    const template = [
        '<div class="empty-state">',
        '    <mat-icon class="empty-state__icon">inbox</mat-icon>',
        '    <p class="empty-state-hint">Nothing</p>',
        '</div>',
        '<p class="no-results">None</p>',
    ].join('\n');
    const { blocks } = findStateFindings('a.html', template);
    assert.deepEqual(
        blocks.map(({ line, block }) => ({ line, block })),
        [
            { line: 1, block: 'empty-state' },
            { line: 5, block: 'no-results' },
        ]
    );
});

test('ignores hook classes on the shared state view', () => {
    const template =
        '<app-state-view class="groups-view-empty-state" heading="x" />';
    assert.deepEqual(findStateFindings('a.html', template).blocks, []);
});

test('reads inline component templates', () => {
    const source = [
        "@Component({ selector: 'x', template: `",
        '    <div class="empty-message">None</div>',
        '` })',
        'export class X {}',
    ].join('\n');
    assert.equal(findStateFindings('x.ts', source).blocks[0]?.line, 2);
});

test('keeps spinners on the 16 / 24 / 40 scale', () => {
    const template = [
        '<mat-spinner diameter="16" />',
        '<mat-progress-spinner diameter="28" />',
        '<mat-spinner [diameter]="SPINNER_DIAMETERS.lg" />',
        '<mat-spinner [diameter]="size" />',
        '<mat-spinner />',
    ].join('\n');
    const { spinners } = findStateFindings('a.html', template);
    assert.deepEqual(
        spinners.map(({ line, diameter }) => ({ line, diameter })),
        [
            { line: 2, diameter: '28' },
            { line: 4, diameter: 'size' },
            { line: 5, diameter: 'default (100)' },
        ]
    );
});

test('fails a file above its entry and reports one below it', () => {
    const baseline = {
        'a.html': { count: 2, reason: 'x' },
        'b.html': { count: 1, reason: 'y' },
    };
    const { over, stale } = compareWithBaseline(
        { 'a.html': 1, 'c.html': 1 },
        baseline
    );
    assert.deepEqual(over, [{ file: 'c.html', count: 1, allowed: 0 }]);
    assert.deepEqual(stale, [
        { file: 'a.html', count: 1, allowed: 2 },
        { file: 'b.html', count: 0, allowed: 1 },
    ]);
});

test('update only lowers the baseline', () => {
    const baseline = { 'a.html': { count: 2, reason: 'x' } };
    assert.deepEqual(loweredBaseline({ 'a.html': 1 }, baseline), {
        'a.html': { count: 1, reason: 'x' },
    });
    assert.deepEqual(loweredBaseline({ 'a.html': 5 }, baseline), baseline);
    assert.deepEqual(loweredBaseline({}, baseline), {});
});
