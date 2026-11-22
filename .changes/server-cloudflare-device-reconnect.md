---
type: fix
area: server
---

Android clears the server address when you disconnect or when the host revokes the device. To restore access to a revoked device, scan a fresh Cloudflare pairing QR from the host.

Android keeps you signed in when a connection check and a library request both need to renew the same Cloudflare session.
