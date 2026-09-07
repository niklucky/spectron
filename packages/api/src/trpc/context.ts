import type {
  Auth,
  TrackerService,
  ProjectFieldService,
  ActivityService,
  WorklogService,
  CommentService,
  IssueService,
  FileService,
  ProjectService,
  InvitationService,
} from "@spectron/backend";

export type Context = {
  userId: string | null;
  tracker?: TrackerService;
  projectFields?: ProjectFieldService;
  projects: ProjectService;
  invitations: InvitationService;
  issues: IssueService;
  files: FileService;
  comments: CommentService;
  worklogs: WorklogService;
  activity: ActivityService;
};
export async function createContext(
  auth: Auth,
  projects: ProjectService,
  invitations: InvitationService,
  request: Request,
  issues: IssueService,
  files: FileService,
  comments: CommentService,
  worklogs: WorklogService,
  activity: ActivityService,
  tracker?: TrackerService,
  projectFields?: ProjectFieldService,
): Promise<Context> {
  const session = await auth.api.getSession({ headers: request.headers });
  return {
    userId: session?.user.id || null,
    ...(tracker ? { tracker } : {}),
    ...(projectFields ? { projectFields } : {}),
    projects,
    invitations,
    issues,
    files,
    comments,
    worklogs,
    activity,
  };
}
