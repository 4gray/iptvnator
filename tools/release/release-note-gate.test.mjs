import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    evaluateGate,
    GATE_LABEL,
} from './check-release-note-gate.mjs';

function file(filename, status = 'modified') {
    return { filename, status };
}

function gate(files, labels = []) {
    return evaluateGate({ files, labels });
}

describe('evaluateGate', () => {
    it('passes when runtime code ships with an added note', () => {
        const verdict = gate([
            file('libs/ui/playback/src/lib/player.ts'),
            file('.changes/playback-volume-memory.md', 'added'),
        ]);

        assert.equal(verdict.ok, true);
        assert.match(verdict.message, /playback-volume-memory/);
    });

    it('fails when runtime code ships without a note', () => {
        const verdict = gate([file('apps/web/src/app/app.component.ts')]);

        assert.equal(verdict.ok, false);
        assert.match(verdict.message, /app\.component\.ts/);
        assert.match(verdict.message, /\.changes\/<area>-<short-slug>\.md/);
        assert.match(verdict.message, new RegExp(GATE_LABEL));
    });

    it('accepts the escape label', () => {
        const verdict = gate(
            [file('apps/web/src/app/app.component.ts')],
            [GATE_LABEL]
        );

        assert.equal(verdict.ok, true);
    });

    it('a modified existing note does not satisfy the gate', () => {
        const verdict = gate([
            file('libs/m3u-state/src/lib/reducer.ts'),
            file('.changes/old-note.md', 'modified'),
        ]);

        assert.equal(verdict.ok, false);
    });

    it('a renamed note does not satisfy the gate', () => {
        // A note added and renamed within one PR still reports as `added`;
        // `renamed` means it came from the base branch, i.e. another PR's.
        const verdict = gate([
            file('libs/m3u-state/src/lib/reducer.ts'),
            file('.changes/m3u-better-name.md', 'renamed'),
        ]);

        assert.equal(verdict.ok, false);
    });

    it('a nested note does not satisfy the gate', () => {
        // loadNotes() only reads the immediate directory, so a nested file
        // would never be validated or rendered into a release surface.
        const verdict = gate([
            file('libs/m3u-state/src/lib/reducer.ts'),
            file('.changes/subdir/m3u-note.md', 'added'),
        ]);

        assert.equal(verdict.ok, false);
    });

    it('accepts a top-level note regardless of surrounding path noise', () => {
        const verdict = gate([
            file('libs/m3u-state/src/lib/reducer.ts'),
            file('.changes/m3u-long-urls.md', 'added'),
        ]);

        assert.equal(verdict.ok, true);
    });

    it('.changes/README.md is not a note', () => {
        const verdict = gate([
            file('libs/m3u-state/src/lib/reducer.ts'),
            file('.changes/README.md', 'added'),
        ]);

        assert.equal(verdict.ok, false);
    });

    it('ignores changes outside apps/ and libs/', () => {
        const verdict = gate([
            file('tools/release/build-release-notes.mjs'),
            file('.github/workflows/ci.yml'),
            file('CLAUDE.md'),
            file('package.json'),
        ]);

        assert.equal(verdict.ok, true);
        assert.match(verdict.message, /not required/);
    });

    it('exempts tests, snapshots, e2e, website, mock servers and docs', () => {
        const verdict = gate([
            file('apps/web/src/app/app.component.spec.ts'),
            file('apps/web-e2e/src/xtream.e2e.ts'),
            file('apps/electron-backend-e2e/src/search.e2e.ts'),
            file('apps/website/src/pages/index.astro'),
            file('apps/xtream-mock-server/src/main.ts'),
            file('apps/stalker-mock-server/src/main.ts'),
            file('libs/shared/testing/src/lib/helpers.ts'),
            file('libs/ui/playback/src/lib/__snapshots__/player.snap'),
            file('libs/ui/playback/README.md'),
        ]);

        assert.equal(verdict.ok, true);
    });

    it('one runtime file among exempt ones still triggers the gate', () => {
        const verdict = gate([
            file('apps/web/src/app/app.component.spec.ts'),
            file('apps/web/src/app/app.component.ts'),
        ]);

        assert.equal(verdict.ok, false);
        assert.match(verdict.message, /app\.component\.ts/);
        assert.doesNotMatch(verdict.message, /spec\.ts/);
    });

    it('truncates long file listings in the failure message', () => {
        const files = Array.from({ length: 15 }, (_, index) =>
            file(`libs/services/src/lib/file-${index}.ts`)
        );
        const verdict = gate(files);

        assert.equal(verdict.ok, false);
        assert.match(verdict.message, /… and 5 more/);
    });
});
