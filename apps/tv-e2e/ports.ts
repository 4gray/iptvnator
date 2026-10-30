// Allow parallel worktrees to run isolated servers without stopping another run.
const offset = Number(process.env['TV_E2E_PORT_OFFSET'] ?? 0);
export const tvPorts = {
    app: 4311 + offset,
    backend: 3433 + offset,
    library: 3434 + offset,
    xtream: 3421 + offset,
    stalker: 3420 + offset,
};
export const tvOrigins = Object.fromEntries(
    Object.entries(tvPorts).map(([key, port]) => [
        key,
        `http://127.0.0.1:${port}`,
    ])
) as Record<keyof typeof tvPorts, string>;
