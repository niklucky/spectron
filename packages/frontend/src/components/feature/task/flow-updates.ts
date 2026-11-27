import { useEffect, useState } from "react";
import type { FlowChangeKind, SubscribeToFlow } from "@spectron/shared";

function subscribeToChanges(subscribe: SubscribeToFlow | undefined, issueId: string, kind: FlowChangeKind, changed: () => void) {
  return subscribe?.(message => {
    if (message.type === "ready" || message.changes.some(c => c.issueId === issueId && c.kind === kind)) changed();
  });
}

export function useFlowRevision(subscribe: SubscribeToFlow | undefined, issueId: string, kind: FlowChangeKind) {
  const [revision, setRevision] = useState(0);
  useEffect(() => subscribeToChanges(subscribe, issueId, kind, () => setRevision(value => value + 1)), [subscribe, issueId, kind]);
  return revision;
}

// A busy run can commit more often than a request completes. Show each finished
// snapshot, then fetch once more if changes arrived while it was in flight.
export function watchFlowQuery<T>(
  subscribe: SubscribeToFlow | undefined,
  issueId: string,
  kind: FlowChangeKind,
  load: () => Promise<T>,
  apply: (value: T) => void,
  onError: (cause: unknown) => void,
) {
  let active = true;
  let running = false;
  let dirty = false;
  async function refresh() {
    dirty = true;
    if (running) return;
    running = true;
    while (active && dirty) {
      dirty = false;
      try {
        const value = await load();
        if (active) apply(value);
      } catch (cause) {
        if (active) onError(cause);
      }
    }
    running = false;
  }
  const unsubscribe = subscribeToChanges(subscribe, issueId, kind, refresh);
  window.addEventListener("focus", refresh);
  void refresh();
  return () => {
    active = false;
    unsubscribe?.();
    window.removeEventListener("focus", refresh);
  };
}
