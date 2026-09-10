import type { AISettingsActions } from "@spectron/frontend/components/feature/account";
import { trpc } from "./trpc";

export const aiActions: AISettingsActions = {
  catalog: () => trpc.ai.catalog.query(),
  connections: () => trpc.ai.connections.query(),
  createConnection: (input) => trpc.ai.createConnection.mutate(input),
  updateConnection: (input) => trpc.ai.updateConnection.mutate(input),
  deleteConnection: (input) => trpc.ai.deleteConnection.mutate(input),
  checkConnection: (input) => trpc.ai.checkConnection.mutate(input),
  agents: () => trpc.ai.agents.query(),
  createAgent: (input) => trpc.ai.createAgent.mutate(input),
  updateAgent: (input) => trpc.ai.updateAgent.mutate(input),
  deleteAgent: (input) => trpc.ai.deleteAgent.mutate(input),
  sharing: (id) => trpc.ai.sharing.query({ id }),
  setSharing: (input) => trpc.ai.setSharing.mutate(input),
  available: (projectId) => trpc.ai.available.query({ projectId }),
  members: (id) => trpc.projects.members.query({ id }),
};
