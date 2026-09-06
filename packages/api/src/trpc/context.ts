import type {
  Auth,
  IssueService,
  ProjectService,
  InvitationService,
} from "@spectron/backend";

export type Context = {
  userId: string | null;
  projects: ProjectService;
  invitations: InvitationService;
  issues: IssueService;
};
export async function createContext(
  auth: Auth,
  projects: ProjectService,
  invitations: InvitationService,
  request: Request,
  issues: IssueService,
): Promise<Context> {
  const session = await auth.api.getSession({ headers: request.headers });
  return { userId: session?.user.id || null, projects, invitations, issues };
}
