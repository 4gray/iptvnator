export function HomeSourceStatus({
    actions,
}: {
    actions: { pending: boolean; cancel: () => void; sourceName?: string };
}) {
    return actions.pending ? (
        <div class="home-source-pending" role="status">
            Opening the title… {actions.sourceName}{' '}
            <button onClick={actions.cancel}>Cancel opening title</button>
        </div>
    ) : null;
}
