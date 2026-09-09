import { trpc } from "./trpc";
import type { ExportProvider } from "@spectron/shared";
import type { ExportActions } from "@spectron/frontend";
export function exportActionsFor(projectId: string, provider: ExportProvider): ExportActions {
  const scope = { projectId, provider };
  return {
    get: () => trpc.exports.get.query(scope),
    save: config => trpc.exports.save.mutate({ ...scope, config }),
    retry: id => trpc.exports.retry.mutate({ ...scope, id }),
    reconcile: (id, remoteId) => trpc.exports.reconcile.mutate({ ...scope, id, remoteId }),
  };
}
