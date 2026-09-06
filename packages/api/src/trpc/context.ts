import type {
  Auth,
  ProjectService,
  InvitationService,
} from "@spectron/backend";

export type Context = {
  userId: string | null;
  projects: ProjectService;
  invitations: InvitationService;
};
export async function createContext(
  auth: Auth,
  projects: ProjectService,
  invitations: InvitationService,
  request: Request,
): Promise<Context> {
  const session = await auth.api.getSession({ headers: request.headers });
  return { userId: session?.user.id || null, projects, invitations };
}
