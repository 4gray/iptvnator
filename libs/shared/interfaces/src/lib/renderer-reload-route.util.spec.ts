import {
    RENDERER_RESTORE_ROUTE_QUERY_PARAM,
    resolveRestoredRendererRoute,
} from './renderer-reload-route.util';

const rendererRoot = 'file:///Applications/IPTVnator.app/Contents/web/';
const packagedIndex = `${rendererRoot}index.html`;

function reloadedIndex(route: string): string {
    const url = new URL(packagedIndex);
    url.searchParams.set(RENDERER_RESTORE_ROUTE_QUERY_PARAM, route);
    return url.href;
}

describe('resolveRestoredRendererRoute', () => {
    it('leaves a document without a restore request alone', () => {
        expect(resolveRestoredRendererRoute(packagedIndex, packagedIndex)).toBe(
            null
        );
        expect(
            resolveRestoredRendererRoute(
                `${packagedIndex}?other=1`,
                packagedIndex
            )
        ).toBe(null);
    });

    it('restores a route relative to the renderer directory', () => {
        expect(
            resolveRestoredRendererRoute(
                reloadedIndex('workspace/sources'),
                packagedIndex
            )
        ).toBe(`${rendererRoot}workspace/sources`);
    });

    it('keeps the restored route query and fragment', () => {
        expect(
            resolveRestoredRendererRoute(
                reloadedIndex('workspace/xtreams/3/search?q=dune#top'),
                packagedIndex
            )
        ).toBe(`${rendererRoot}workspace/xtreams/3/search?q=dune#top`);
    });

    it('resolves against the base URI, not the document URL', () => {
        // The packaged <base href="./"> resolves to the renderer directory
        // even when the document itself sits deeper.
        expect(
            resolveRestoredRendererRoute(
                `${rendererRoot}workspace/sources?${RENDERER_RESTORE_ROUTE_QUERY_PARAM}=workspace%2Fdashboard`,
                rendererRoot
            )
        ).toBe(`${rendererRoot}workspace/dashboard`);
    });

    it('works for an http origin with a root base href', () => {
        expect(
            resolveRestoredRendererRoute(
                `http://localhost:4200/?${RENDERER_RESTORE_ROUTE_QUERY_PARAM}=workspace%2Fsettings%2Fplayback`,
                'http://localhost:4200/'
            )
        ).toBe('http://localhost:4200/workspace/settings/playback');
    });

    it.each([
        ['an absolute URL', 'https://example.com/phish'],
        ['another scheme', 'javascript:alert(1)'],
        ['a directory escape', '../../etc/passwd'],
        ['a root-absolute path outside the renderer', '/etc/passwd'],
        ['a scheme-relative URL', '//example.com/'],
        ['the renderer directory itself', './'],
        ['an empty route', ''],
    ])('drops %s and only removes the parameter', (_label, route) => {
        expect(
            resolveRestoredRendererRoute(reloadedIndex(route), packagedIndex)
        ).toBe(packagedIndex);
    });

    it('returns null for an unparsable document URL', () => {
        expect(resolveRestoredRendererRoute('not a url', packagedIndex)).toBe(
            null
        );
    });
});
