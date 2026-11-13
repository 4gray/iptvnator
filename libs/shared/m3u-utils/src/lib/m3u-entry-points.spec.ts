import * as catalog from '../catalog';
import * as nameStrip from '../name-strip';
import * as series from '../series';

/**
 * The secondary entry points. They exist so the catalog, series and
 * name-stripping code stays out of the startup bundle; a symbol dropped from one of them breaks
 * the lazy routes at build time, far from the change that dropped it.
 */
describe('m3u-utils secondary entry points', () => {
    it('exposes channel-name stripping', () => {
        expect(typeof nameStrip.stripCountryPrefix).toBe('function');
        expect(typeof nameStrip.applyChannelNameStrip).toBe('function');
        expect(typeof nameStrip.findM3uTagSeparator).toBe('function');
    });

    it('exposes the catalog layer', () => {
        expect(typeof catalog.classifyM3uEntry).toBe('function');
        expect(typeof catalog.buildM3uCatalogIndex).toBe('function');
        expect(typeof catalog.hasStrongEpisodeCode).toBe('function');
        expect(typeof catalog.withholdM3uCatalogGroups).toBe('function');
    });

    it('exposes the series layer', () => {
        expect(typeof series.buildM3uSeriesCatalog).toBe('function');
        expect(typeof series.parseM3uEpisode).toBe('function');
        expect(typeof series.splitM3uNameTag).toBe('function');
        expect(typeof series.regroupM3uSeriesByYear).toBe('function');
        expect(typeof series.withholdM3uSeriesGroups).toBe('function');
    });
});
