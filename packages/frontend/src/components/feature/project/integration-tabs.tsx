export type IntegrationTab = "connection" | "mapping" | "sync";
export function IntegrationTabs({ value, onChange, busy, connected }: {
  value: IntegrationTab; onChange: (value: IntegrationTab) => void; busy: boolean; connected: boolean;
}) {
  return <nav className="integration-tabs" aria-label="Integration sections">
    {([['connection', 'Connection'], ['mapping', 'Field mapping'], ['sync', 'Sync']] as const).map(([id, label]) =>
      <button key={id} type="button" aria-current={value === id ? 'page' : undefined} disabled={busy || (id !== 'connection' && !connected)} onClick={() => onChange(id)}>{label}</button>)}
  </nav>;
}
