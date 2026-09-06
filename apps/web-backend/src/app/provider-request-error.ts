import type { ProviderUrlError } from './provider-url-policy';

/** Internal chain evidence, separate from the deliberately small public body. */
export class ProviderRequestError extends Error {
    constructor(
        readonly initialResponded: boolean,
        readonly cause: unknown,
        readonly policyError?: ProviderUrlError
    ) {
        super('Provider request failed');
    }
}
