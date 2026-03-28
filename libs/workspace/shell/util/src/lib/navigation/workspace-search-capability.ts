import { PortalRailSection } from '@iptvnator/portal/shared/util';
import {
    WorkspacePortalContext,
    WorkspaceShellSearchMode,
} from './workspace-shell-route.utils';

export type WorkspaceSearchBehavior =
    | 'disabled'
    | 'local-filter'
    | 'remote-search'
    | 'advanced-only'
    | 'degraded-loaded-only';

export interface WorkspaceSearchCapability {
    enabled: boolean;
    behavior: WorkspaceSearchBehavior;
    context: WorkspacePortalContext | null;
    section: PortalRailSection | null;
    searchMode: WorkspaceShellSearchMode;
    placeholderKey: string;
    scopeLabel: string;
    statusLabel: string;
    minLength: number;
    advancedRouteTarget: readonly string[] | null;
}
