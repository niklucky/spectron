import type {
  Auth,
  AgentRunService,
  AIService,
  GitService,
  ExportService,
  TrackerService,
  FieldService,
  JiraService,
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
  runs: AgentRunService;
  ai: AIService;
  git: GitService;
  exports: ExportService;
  tracker: TrackerService;
  fields: FieldService;
  jira: JiraService;
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
  fields: FieldService,
  jira: JiraService,
  tracker: TrackerService,
  exports: ExportService,
  ai: AIService,
  git: GitService,
  runs: AgentRunService,
): Promise<Context> {
  const session = await auth.api.getSession({ headers: request.headers });
  return {
    userId: session?.user.id || null,
    ai,
    runs,
    git,
    tracker,
    exports,
    projects,
    invitations,
    issues,
    files,
    comments,
    worklogs,
    activity,
    fields,
    jira,
  };
}
