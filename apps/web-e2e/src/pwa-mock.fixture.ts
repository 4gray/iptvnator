import { test as base } from './fixtures';
import {
    createPwaMockIdentity,
    resetPwaMockServers,
    type PwaMockIdentity,
} from './pwa-mock-state';

export const test = base.extend<{ pwaMocks: PwaMockIdentity }>({
    pwaMocks: [
        async ({ request, context }, use, testInfo) => {
            const identity = createPwaMockIdentity(testInfo.parallelIndex);
            await resetPwaMockServers(request, identity);
            try {
                await use(identity);
            } finally {
                // Stop browser traffic before releasing its server-side resources.
                try {
                    await context.close();
                } finally {
                    await resetPwaMockServers(request, identity);
                }
            }
        },
        { auto: true },
    ],
});

export { expect } from './fixtures';
