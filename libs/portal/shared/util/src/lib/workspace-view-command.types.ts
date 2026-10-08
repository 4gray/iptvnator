/**
 * `settings` holds one command per searchable settings row. The palette
 * lists them only for a non-empty query, ranked and capped, so they never
 * flood the default command list.
 */
export type WorkspaceCommandGroup = 'view' | 'playlist' | 'global' | 'settings';

export interface WorkspaceCommandActionContext {
    query: string;
}

export type WorkspaceCommandParams = Record<string, string | number>;

export type WorkspaceCommandValue<T> = T | (() => T);

export interface WorkspaceCommandMetadata {
    labelKey: string;
    labelParams?:
        | WorkspaceCommandParams
        | (() => WorkspaceCommandParams | undefined);
    descriptionKey?: string;
    descriptionParams?:
        | WorkspaceCommandParams
        | (() => WorkspaceCommandParams | undefined);
    priority?: number;
    keywords?: readonly string[] | (() => readonly string[] | undefined);
    visible?: boolean | (() => boolean | undefined);
    enabled?: boolean | (() => boolean | undefined);
}

export interface WorkspaceCommandContribution extends WorkspaceCommandMetadata {
    id: string;
    group: WorkspaceCommandGroup;
    icon: string;
    run: (context: WorkspaceCommandActionContext) => void;
}

export interface WorkspaceHeaderCommandMetadata extends WorkspaceCommandMetadata {
    group?: WorkspaceCommandGroup;
}

export interface WorkspaceResolvedCommandItem {
    id: string;
    group: WorkspaceCommandGroup;
    icon: string;
    label: string;
    description: string;
    keywords: readonly string[];
    priority: number;
    visible: boolean;
    enabled: boolean;
    run: (context: WorkspaceCommandActionContext) => void;
}

export interface WorkspaceCommandSelection {
    commandId: string;
    query: string;
}
