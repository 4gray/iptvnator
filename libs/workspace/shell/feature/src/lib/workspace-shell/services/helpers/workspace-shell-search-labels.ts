import {
    PortalRailLink,
    PortalRailSection,
} from '@iptvnator/portal/shared/util';
import {
    WorkspacePortalContext,
    WorkspaceShellPageKind,
} from '@iptvnator/workspace/shell/util';
import {
    FILTER_SECTION_PLACEHOLDER,
    RAIL_TOOLTIP_KEYS,
    SEARCH_PLAYLIST_PLACEHOLDER,
    SEARCH_SECTION_PLACEHOLDER,
    SEARCH_SOURCES_PLACEHOLDER,
} from './workspace-shell-constants';

export type TranslateFn = (
    key: string,
    params?: Record<string, string | number>
) => string;

export interface SearchScopeContext {
    kind: WorkspaceShellPageKind;
    context: WorkspacePortalContext | null;
    section: PortalRailSection | null;
    translate: TranslateFn;
    xtreamCategory:
        | { category_name?: string; name?: string }
        | null
        | undefined;
    stalkerCategoryName: string;
}

export function getRailTooltipKey(
    provider: WorkspacePortalContext['provider'],
    section?: PortalRailSection
): string {
    if (provider === 'xtreams' && section === 'library') {
        return 'WORKSPACE.SHELL.RAIL_LIBRARY';
    }

    return (
        (section ? RAIL_TOOLTIP_KEYS[section] : null) ??
        'WORKSPACE.SHELL.RAIL_CONTEXT_ACTIONS'
    );
}

export function translateRailSection(
    section: PortalRailSection,
    translate: TranslateFn
): string {
    return translate(getRailTooltipKey('playlists', section));
}

export function translateRailLinks(
    links: PortalRailLink[],
    provider: WorkspacePortalContext['provider'],
    translate: TranslateFn
): PortalRailLink[] {
    return links.map((link) => ({
        ...link,
        tooltip: translate(getRailTooltipKey(provider, link.section)),
    }));
}

export function resolveSearchPlaceholderKey(
    kind: WorkspaceShellPageKind,
    context: WorkspacePortalContext | null,
    section: PortalRailSection | null
): string {
    if (kind === 'sources') {
        return SEARCH_SOURCES_PLACEHOLDER;
    }

    if (kind === 'dashboard' || section === 'search') {
        return SEARCH_PLAYLIST_PLACEHOLDER;
    }

    if (
        context &&
        (section === 'vod' ||
            section === 'series' ||
            section === 'live' ||
            section === 'itv' ||
            section === 'radio')
    ) {
        return SEARCH_SECTION_PLACEHOLDER;
    }

    return FILTER_SECTION_PLACEHOLDER;
}

export function resolveActiveCategoryLabel(ctx: SearchScopeContext): string {
    const { context, section, translate, xtreamCategory, stalkerCategoryName } =
        ctx;
    if (!context || !section) {
        return '';
    }

    if (context.provider === 'xtreams') {
        return (
            xtreamCategory?.category_name ??
            xtreamCategory?.name ??
            translateRailSection(section, translate)
        );
    }

    if (context.provider === 'stalker') {
        return (
            stalkerCategoryName.trim() ||
            translateRailSection(section, translate)
        );
    }

    return translateRailSection(section, translate);
}

export function resolveSearchScopeLabel(ctx: SearchScopeContext): string {
    const { kind, context, section, translate } = ctx;

    if (kind === 'sources') {
        return translate('WORKSPACE.SHELL.RAIL_SOURCES');
    }

    if (kind === 'global-favorites') {
        return translate('HOME.PLAYLISTS.GLOBAL_FAVORITES');
    }

    if (kind === 'global-recent') {
        return translate('PORTALS.RECENTLY_VIEWED');
    }

    if (kind === 'global-search') {
        return translate('WORKSPACE.SHELL.RAIL_GLOBAL_SEARCH');
    }

    if (kind === 'downloads') {
        return translate('WORKSPACE.SHELL.RAIL_DOWNLOADS');
    }

    if (kind === 'dashboard' || section === 'search') {
        return translate('WORKSPACE.SHELL.RAIL_SEARCH');
    }

    if (!context || !section) {
        return '';
    }

    if (
        section === 'vod' ||
        section === 'series' ||
        section === 'live' ||
        section === 'itv' ||
        section === 'radio'
    ) {
        const categoryLabel = resolveActiveCategoryLabel(ctx);
        const sectionLabel = translateRailSection(section, translate);

        return categoryLabel
            ? `${sectionLabel} / ${categoryLabel}`
            : sectionLabel;
    }

    return translateRailSection(section, translate);
}
