import { useCallback, useEffect, useEffectEvent, useRef } from "react";
import type { FlowMessage, SubscribeToFlow } from "@spectron/shared";

export function useFlowEvents(refreshIssues: () => Promise<void>, refreshProjects: () => Promise<void>) {
  const listeners = useRef(new Set<(message: FlowMessage) => void>());
  const subscribe = useCallback<SubscribeToFlow>(listener => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);
  const refreshProjectList = useEffectEvent(refreshProjects);
  const refresh = useEffectEvent(refreshIssues);
  useEffect(() => {
    let stopped = false;
    let socket: WebSocket;
    let retry: number | undefined;
    let delay = 500;
    let refreshing = false;
    let dirty = false;
    async function updateIssues() {
      dirty = true;
      if (refreshing) return;
      refreshing = true;
      try {
        while (dirty && !stopped) {
          dirty = false;
          await refresh();
        }
      } finally {
        refreshing = false;
      }
    }
    function connect() {
      const url = new URL("/api/flow/events", location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url);
      socket.onmessage = event => {
        const message: FlowMessage = JSON.parse(event.data);
        if (message.type === "ready") {
          delay = 500;
          void refreshProjectList();
        }
        for (const listener of listeners.current) listener(message);
        if (message.type === "ready" || message.changes.some(change => change.kind === "issue")) void updateIssues();
      };
      socket.onclose = () => {
        if (stopped) return;
        retry = window.setTimeout(connect, delay + Math.random() * delay / 4);
        delay = Math.min(30000, delay * 2);
      };
    }
    connect();
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      socket.onmessage = null;
      socket.close();
    };
  }, []);
  return subscribe;
}
