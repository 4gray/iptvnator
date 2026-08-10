import {
    applyDefaultAutoSelectFamilyAttemptTimeout,
    AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_FLAG,
} from './app/network-family-autoselection';
import { createWebBackendApp } from './app/web-backend-app';

const attemptTimeout = applyDefaultAutoSelectFamilyAttemptTimeout();
if (attemptTimeout !== null) {
    console.log(
        `[web-backend] connection attempt timeout set to ${attemptTimeout} ms for IPv6->IPv4 fallback; pass ${AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_FLAG} via NODE_OPTIONS to override`
    );
}

const port = Number(process.env['PORT'] ?? 3000);
const app = createWebBackendApp();

app.listen(port, () => {
    console.log(`IPTVnator web backend listening on http://localhost:${port}`);
});
