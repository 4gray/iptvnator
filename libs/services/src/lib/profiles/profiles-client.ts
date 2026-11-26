import type {
    SourceServerRequest,
    SourceServerResponse,
} from '@iptvnator/shared/interfaces';
import {
    DEFAULT_PROFILE_ID,
    isProfileId,
    type CreateServerProfileRequest,
    type DeleteServerProfileRequest,
    type ReorderServerProfilesRequest,
    type ServerProfile,
    type ServerProfileList,
    type UpdateServerProfileRequest,
    type UpdateServerProfilesRequest,
} from '@iptvnator/shared/interfaces/profiles';
import {
    profilesErrorOf,
    profilesOfflineError,
    type ProfilesResult,
} from './profiles-errors';
import {
    parseServerProfile,
    parseServerProfileList,
    parseUnlockResponse,
} from './profiles-parse';

export interface ProfilesClientOptions {
    request(value: SourceServerRequest): Promise<SourceServerResponse>;
}

export type ProfilesListResult =
    | { readonly changed: false }
    | { readonly changed: true; readonly list: ServerProfileList };

/**
 * Profiles transport adapter. Bound transports provide their own 15-second
 * timeout, so this client makes exactly one request and adds no timeout/retry.
 */
export class ProfilesClient {
    constructor(private readonly options: ProfilesClientOptions) {}

    async list(revision?: number): Promise<ProfilesResult<ProfilesListResult>> {
        if (
            revision !== undefined &&
            (!Number.isSafeInteger(revision) || revision < 0)
        ) {
            return failure('invalid_body');
        }
        return this.respond<ProfilesListResult>(
            {
                operation: 'profiles-list',
                ...(revision === undefined
                    ? {}
                    : { revision: String(revision) }),
            },
            (response) => {
                if (response.status === 304) {
                    return revision === undefined
                        ? failure('invalid_response')
                        : success<ProfilesListResult>({ changed: false });
                }
                if (response.status !== 200) return responseFailure(response);
                const list = parseServerProfileList(response.body);
                return list
                    ? success<ProfilesListResult>({ changed: true, list })
                    : failure('invalid_response');
            }
        );
    }

    setEnabled(enabled: boolean): Promise<ProfilesResult<ServerProfileList>> {
        const profile: UpdateServerProfilesRequest = { enabled };
        return this.listResponse({
            operation: 'profiles-set-enabled',
            profile,
        });
    }

    async reorder(
        ids: readonly string[]
    ): Promise<ProfilesResult<ServerProfileList>> {
        if (ids.some((id) => !validProfileId(id))) {
            return failure('invalid_profile_id');
        }
        const profile: ReorderServerProfilesRequest = { ids: [...ids] };
        return this.listResponse({ operation: 'profiles-order', profile });
    }

    create(
        input: CreateServerProfileRequest
    ): Promise<ProfilesResult<ServerProfile>> {
        return this.profileResponse(
            { operation: 'profile-create', profile: createInput(input) },
            [200, 201]
        );
    }

    async update(
        id: string,
        input: UpdateServerProfileRequest
    ): Promise<ProfilesResult<ServerProfile>> {
        if (!validProfileId(id)) return failure('invalid_profile_id');
        return this.profileResponse(
            { operation: 'profile-update', id, profile: updateInput(input) },
            [200]
        );
    }

    async remove(
        id: string,
        currentPin?: string
    ): Promise<ProfilesResult<void>> {
        if (!validProfileId(id)) return failure('invalid_profile_id');
        const request: SourceServerRequest = {
            operation: 'profile-delete',
            id,
            ...(currentPin === undefined
                ? {}
                : {
                      profile: {
                          currentPin,
                      } satisfies DeleteServerProfileRequest,
                  }),
        };
        return this.respond<void>(request, (response) =>
            response.status === 204 || response.status === 200
                ? success(undefined)
                : responseFailure(response)
        );
    }

    async unlock(id: string, pin: string): Promise<ProfilesResult<void>> {
        if (!validProfileId(id)) return failure('invalid_profile_id');
        return this.respond<void>(
            { operation: 'profile-unlock', id, profile: { pin } },
            (response) => {
                if (response.status !== 200) return responseFailure(response);
                return parseUnlockResponse(response.body)
                    ? success(undefined)
                    : failure('invalid_response');
            }
        );
    }

    private listResponse(
        request: SourceServerRequest
    ): Promise<ProfilesResult<ServerProfileList>> {
        return this.respond<ServerProfileList>(request, (response) => {
            if (response.status !== 200) return responseFailure(response);
            const list = parseServerProfileList(response.body);
            return list ? success(list) : failure('invalid_response');
        });
    }

    private profileResponse(
        request: SourceServerRequest,
        statuses: readonly number[]
    ): Promise<ProfilesResult<ServerProfile>> {
        return this.respond<ServerProfile>(request, (response) => {
            if (!statuses.includes(response.status)) {
                return responseFailure(response);
            }
            const profile = parseServerProfile(response.body);
            return profile ? success(profile) : failure('invalid_response');
        });
    }

    private async respond<T>(
        request: SourceServerRequest,
        handle: (response: SourceServerResponse) => ProfilesResult<T>
    ): Promise<ProfilesResult<T>> {
        try {
            return handle(await this.options.request(request));
        } catch {
            return { ok: false, error: profilesOfflineError() };
        }
    }
}

function validProfileId(id: string): boolean {
    return id === DEFAULT_PROFILE_ID || isProfileId(id);
}

function createInput(
    input: CreateServerProfileRequest
): CreateServerProfileRequest {
    const profile: {
        name?: string;
        colour?: string;
        emoji?: string;
        pin?: string;
        kids?: boolean;
    } = {};
    if (input.name !== undefined) profile.name = input.name;
    if (input.colour !== undefined) profile.colour = input.colour;
    if (input.emoji !== undefined) profile.emoji = input.emoji;
    if (input.pin !== undefined) profile.pin = input.pin;
    if (input.kids !== undefined) profile.kids = input.kids;
    return profile as CreateServerProfileRequest;
}

function updateInput(
    input: UpdateServerProfileRequest
): UpdateServerProfileRequest {
    return {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.colour === undefined ? {} : { colour: input.colour }),
        ...(input.emoji === undefined ? {} : { emoji: input.emoji }),
        ...(input.pin === undefined ? {} : { pin: input.pin }),
        ...(input.currentPin === undefined
            ? {}
            : { currentPin: input.currentPin }),
        ...(input.kids === undefined ? {} : { kids: input.kids }),
    };
}

function success<T>(value: T): ProfilesResult<T> {
    return { ok: true, value };
}

function failure<T>(
    code: 'invalid_body' | 'invalid_profile_id' | 'invalid_response'
): ProfilesResult<T> {
    return { ok: false, error: { code } };
}

function responseFailure<T>(response: SourceServerResponse): ProfilesResult<T> {
    return { ok: false, error: profilesErrorOf(response) };
}
