import { WorkspacePortalContext } from '@iptvnator/workspace/shell/util';
import {
    SearchScopeContext,
    resolveSearchScopeLabel,
} from './workspace-shell-search-labels';

const LABELS: Record<string, string> = {
    'WORKSPACE.SHELL.RAIL_MOVIES': 'Movies',
    'WORKSPACE.SHELL.RAIL_SERIES': 'Series',
};

function scope(
    provider: WorkspacePortalContext['provider'],
    section: SearchScopeContext['section'],
    overrides: Partial<SearchScopeContext> = {}
): SearchScopeContext {
    return {
        kind: 'portal',
        context: { provider, playlistId: 'pl-1' },
        section,
        translate: (key) => LABELS[key] ?? key,
        xtreamCategory: null,
        stalkerCategoryName: '',
        ...overrides,
    };
}

describe('resolveSearchScopeLabel', () => {
    it('names only the section for an M3U catalog section', () => {
        // An M3U section has no category the header knows of, so the label
        // must not repeat the section ("Movies / Movies").
        expect(resolveSearchScopeLabel(scope('playlists', 'vod'))).toBe(
            'Movies'
        );
        expect(resolveSearchScopeLabel(scope('playlists', 'series'))).toBe(
            'Series'
        );
    });

    it('keeps the selected Xtream category after the section', () => {
        expect(
            resolveSearchScopeLabel(
                scope('xtreams', 'vod', {
                    xtreamCategory: { category_name: 'Adventure' },
                })
            )
        ).toBe('Movies / Adventure');
    });

    it('keeps the Stalker category after the section', () => {
        expect(
            resolveSearchScopeLabel(
                scope('stalker', 'series', { stalkerCategoryName: 'Drama' })
            )
        ).toBe('Series / Drama');
    });
});
