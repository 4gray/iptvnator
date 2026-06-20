import { readFileSync } from 'fs';
import { join } from 'path';

describe('WorkspaceSourcesComponent styles', () => {
    const html = readFileSync(
        join(__dirname, 'workspace-sources.component.html'),
        'utf8'
    );
    const scss = readFileSync(
        join(__dirname, 'workspace-sources.component.scss'),
        'utf8'
    );

    it('uses the shared panel header pattern for the sources toolbar', () => {
        expect(html).toContain('class="sources-header__meta"');
        expect(scss).toContain(
            "@use '../../../../../../ui/styles/panel-header' as panel;"
        );
        expect(scss).toContain(
            '@include panel.standard-panel-header($sticky: true);'
        );
        expect(scss).toContain('@include panel.standard-panel-meta();');
        expect(scss).toContain('@include panel.standard-panel-title();');
        expect(scss).toContain('@include panel.standard-panel-subtitle();');
    });
});
