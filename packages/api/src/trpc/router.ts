import { ISSUE_TITLE_MAX_LENGTH, ISSUE_DESCRIPTION_MAX_LENGTH } from "@spectron/shared";
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  ProjectAccessError,
  TrackerRequestError,
  JiraApiError,
  IssueInputError,
  FileInputError,
  IssueConflictError,
  InvitationError,
  LogoError,
  discoverProjectLogo,
} from "@spectron/backend";
import {
  applicationIdPattern,
  aiProviders,
  gitProviders,
  aiEfforts,
  aiCatalog,
  exportActions,
  issueTriggers,
  normalizeProjectURL,
} from "@spectron/shared";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      message:
        error.code === "INTERNAL_SERVER_ERROR"
          ? "Something went wrong. Please try again."
          : shape.message,
      data: { ...shape.data, stack: undefined },
    };
  },
});
const authenticated = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  const result = await next({ ctx: { ...ctx, userId: ctx.userId } });
  if (!result.ok && result.error.cause instanceof ProjectAccessError) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: result.error.cause.message,
    });
  }
  if (!result.ok && result.error.cause instanceof IssueConflictError)
    throw new TRPCError({
      code: "CONFLICT",
      message: result.error.cause.message,
    });
  if (
    !result.ok &&
    (result.error.cause instanceof TrackerRequestError ||
      result.error.cause instanceof JiraApiError ||
      result.error.cause instanceof FileInputError ||
      result.error.cause instanceof IssueInputError ||
      result.error.cause instanceof LogoError ||
      result.error.cause instanceof InvitationError)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: result.error.cause.message,
    });
  return result;
});
const websiteURL = z
  .string()
  .max(2048)
  .nullable()
  .optional()
  .transform((value, ctx) => {
    try {
      return normalizeProjectURL(value || null);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Enter a valid HTTP or HTTPS website URL.",
      });
      return z.NEVER;
    }
  });
const projectInput = z
  .object({
    name: z.string().trim().min(1, "Enter a project name.").max(80),
    key: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^[A-Z][A-Z0-9]{1,9}$/,
        "Use 2–10 letters or numbers, starting with a letter.",
      ),
    url: websiteURL,
    logo: z
      .string()
      .max(2_800_000)
      .nullable()
      .optional()
      .transform((value) => value || null),
  })
  .strict();
// Accept retained UUIDs so existing project links and invitations keep working.
const applicationId = z.union([
  z.string().regex(applicationIdPattern),
  z.uuid(),
]);
const projectId = z.object({ id: applicationId }).strict();

const gitProject = z.object({ projectId: applicationId }).strict();
const gitRef = gitProject.extend({ id: applicationId, revision: z.number().int().positive() });
const gitName = z.string().trim().min(1).max(255);
const gitToken = z.string().min(1).max(4096).regex(/^[^\s\x00-\x1f\x7f]+$/, "Enter a token without whitespace.");
const aiName = z.string().trim().min(1).max(80);
const aiKey = z.string().min(1).max(4096).regex(/^[^\s\x00-\x1f\x7f]+$/, "Enter an API key without whitespace.");
const aiRevision = z.object({ id: applicationId, revision: z.number().int().positive() }).strict();
const agentInput = z.object({
  name: aiName,
  avatar: z.string().max(2_800_000).nullable(),
  connectionId: applicationId,
  model: z.string().min(1).max(128),
  effort: z.enum(aiEfforts).nullable(),
  role: z.string().trim().min(1).max(80),
  instructions: z.string().max(32000),
}).strict();

const invitationToken = z
  .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
const issueScope = z.object({ projectId: applicationId }).strict();
const issueRef = issueScope.extend({ id: applicationId });
const issueFields = z
  .object({
    estimateTime: z.number().int().min(0).max(2147483647).nullable(),
    startAt: z.iso.datetime({ offset: true }).nullable(),
    finishAt: z.iso.datetime({ offset: true }).nullable(),
    fieldValues: z.record(
      z.string().min(1).max(128),
      z.union([z.string().max(100000), z.number().finite(), z.null()]),
    ),
    title: z.string().trim().min(1).max(ISSUE_TITLE_MAX_LENGTH),
    description: z.string().max(ISSUE_DESCRIPTION_MAX_LENGTH),
    parentId: applicationId.nullable(),
    assigneeId: z.string().min(1).max(128).nullable(),
    stateId: applicationId,
    priorityId: applicationId.nullable(),
    issueTypeId: applicationId.nullable(),
    tagIds: z.array(applicationId).max(100),
  })
  .strict();
const optionRef = issueScope.extend({
  kind: z.enum(["state", "priority", "type", "tag"]),
  id: applicationId,
});
const commentScope = z
  .object({ projectId: applicationId, issueId: applicationId })
  .strict();
const commentDraft = commentScope.extend({
  body: z
    .array(
      z.discriminatedUnion("type", [
        z
          .object({ type: z.literal("text"), text: z.string().max(100000) })
          .strict(),
        z
          .object({
            type: z.literal("mention"),
            userId: z.string().min(1).max(128),
            label: z.string().max(255),
          })
          .strict(),
      ]),
    )
    .max(1000),
  files: z
    .array(
      z
        .object({ projectId: applicationId, projectFileId: applicationId })
        .strict(),
    )
    .max(20),
});
const worklogScope = z
  .object({ projectId: applicationId, issueId: applicationId })
  .strict();
const worklogDraft = worklogScope.extend({
  workerUserId: z.string().min(1).max(128),
  startedAt: z.iso.datetime({ offset: true }),
  durationSeconds: z.number().int().min(1).max(2147483647),
  description: z.string().max(10000),
});
const jiraConfig = z
  .object({
    baseUrl: z.url().max(2048),
    projectKey: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .max(80),
    email: z.email().max(254),
    apiToken: z.string().max(4096).optional(),
    issueTypeId: z.string().max(128),
  })
  .strict();
const mapping = z.record(
  z.string().min(1).max(255),
  z.string().min(1).max(128),
);
const trackerMapping = z.record(
  z.string().min(1).max(255),
  applicationId.nullable(),
);
const exportScope = z.object({ projectId: applicationId, provider: z.enum(["jira", "tracker"]) });
export const appRouter = t.router({
  git: t.router({
    connections: authenticated.input(gitProject).query(({ ctx, input }) => ctx.git.connections(ctx.userId, input.projectId)),
    createConnection: authenticated.input(gitProject.extend({ name: gitName, provider: z.enum(gitProviders), baseURL: z.string().trim().min(1).max(2048), token: gitToken }))
      .mutation(({ ctx, input }) => ctx.git.createConnection(ctx.userId, input.projectId, input)),
    updateConnection: authenticated.input(gitRef.extend({ name: gitName, token: gitToken.optional(), commitAuthorName: z.string().trim().max(255), commitAuthorEmail: z.string().trim().max(254) }))
      .mutation(({ ctx, input }) => ctx.git.updateConnection(ctx.userId, input)),
    checkConnection: authenticated.input(gitRef).mutation(({ ctx, input }) => ctx.git.checkConnection(ctx.userId, input)),
    deleteConnection: authenticated.input(gitRef).mutation(({ ctx, input }) => ctx.git.deleteConnection(ctx.userId, input)),
    browse: authenticated.input(gitRef.extend({ page: z.number().int().min(1).max(10000).default(1) })).query(({ ctx, input }) => ctx.git.browse(ctx.userId, input)),
    repositories: authenticated.input(gitProject).query(({ ctx, input }) => ctx.git.repositories(ctx.userId, input.projectId)),
    addRepository: authenticated.input(gitRef.extend({ fullName: z.string().min(1).max(1024), externalId: z.string().regex(/^[1-9]\d{0,19}$/) }))
      .mutation(({ ctx, input }) => ctx.git.addRepository(ctx.userId, input)),
    updateRepository: authenticated.input(gitRef.extend({ targetBranch: z.string().min(1).max(255), isDefault: z.boolean() }))
      .mutation(({ ctx, input }) => ctx.git.updateRepository(ctx.userId, input)),
    removeRepository: authenticated.input(gitRef).mutation(({ ctx, input }) => ctx.git.removeRepository(ctx.userId, input)),
  }),
  ai: t.router({
    catalog: authenticated.query(() => aiCatalog),
    connections: authenticated.query(({ ctx }) => ctx.ai.connections(ctx.userId)),
    createConnection: authenticated.input(z.object({ name: aiName, provider: z.enum(aiProviders), apiKey: aiKey }).strict())
      .mutation(({ ctx, input }) => ctx.ai.createConnection(ctx.userId, input)),
    updateConnection: authenticated.input(aiRevision.extend({ name: aiName, apiKey: aiKey.optional() }))
      .mutation(({ ctx, input }) => ctx.ai.updateConnection(ctx.userId, input)),
    deleteConnection: authenticated.input(aiRevision).mutation(({ ctx, input }) => ctx.ai.deleteConnection(ctx.userId, input)),
    checkConnection: authenticated.input(aiRevision).mutation(({ ctx, input }) => ctx.ai.checkConnection(ctx.userId, input)),
    agents: authenticated.query(({ ctx }) => ctx.ai.agents(ctx.userId)),
    createAgent: authenticated.input(agentInput).mutation(({ ctx, input }) => ctx.ai.saveAgent(ctx.userId, input)),
    updateAgent: authenticated.input(agentInput.extend(aiRevision.shape)).mutation(({ ctx, input }) => ctx.ai.saveAgent(ctx.userId, input)),
    deleteAgent: authenticated.input(aiRevision).mutation(({ ctx, input }) => ctx.ai.deleteAgent(ctx.userId, input)),
    sharing: authenticated.input(projectId).query(({ ctx, input }) => ctx.ai.sharing(ctx.userId, input.id)),
    setSharing: authenticated.input(aiRevision.extend({ projectId: applicationId, visibility: z.enum(["private", "selected", "project"]), memberIds: z.array(z.string().min(1).max(128)).max(500) }))
      .mutation(({ ctx, input }) => ctx.ai.setSharing(ctx.userId, input)),
    available: authenticated.input(z.object({ projectId: applicationId }).strict()).query(({ ctx, input }) => ctx.ai.available(ctx.userId, input.projectId)),
  }),
  exports: t.router({
    get: authenticated.input(exportScope).query(({ ctx, input }) => ctx.exports.get(ctx.userId, input.projectId, input.provider)),
    save: authenticated.input(exportScope.extend({ config: z.object({ mode: z.enum(["off", "on_save", "scheduled"]), intervalMinutes: z.union([z.literal(15), z.literal(60), z.literal(1440)]), actions: z.array(z.enum(exportActions)).max(6) }) })).mutation(({ ctx, input }) => ctx.exports.save(ctx.userId, input.projectId, input.provider, input.config)),
    retry: authenticated.input(exportScope.extend({ id: applicationId })).mutation(({ ctx, input }) => ctx.exports.retry(ctx.userId, input.projectId, input.provider, input.id)),
    reconcile: authenticated.input(exportScope.extend({ id: applicationId, remoteId: z.string().trim().min(1).max(200) })).mutation(({ ctx, input }) => ctx.exports.reconcile(ctx.userId, input.projectId, input.provider, input.id, input.remoteId)),
  }),
  tracker: t.router({
    pushIssue: authenticated
      .input(issueScope.extend({ id: applicationId }))
      .mutation(({ ctx, input }) =>
        ctx.tracker.run(ctx.userId, input.projectId, "push", false, { issueId: input.id }),
      ),
    test: authenticated.input(issueScope.extend({
      token: z.string().trim().min(1).max(4096).optional(),
      organizationId: z.string().trim().regex(/^[a-zA-Z0-9_-]+$/).max(128),
      organizationType: z.enum(["cloud", "360"]),
      queue: z.string().trim().regex(/^[A-Z][A-Z0-9_]*$/).max(80),
    })).mutation(({ ctx, input }) => ctx.tracker.test(ctx.userId, input)),
    get: authenticated
      .input(issueScope)
      .query(({ ctx, input }) => ctx.tracker.get(ctx.userId, input.projectId)),
    save: authenticated
      .input(
        issueScope.extend({
          token: z.string().trim().min(1).max(4096).optional(),
          organizationId: z
            .string()
            .trim()
            .regex(/^[a-zA-Z0-9_-]+$/)
            .max(128),
          organizationType: z.enum(["cloud", "360"]),
          queue: z
            .string()
            .trim()
            .regex(/^[A-Z][A-Z0-9_]*$/)
            .max(80),
          mappings: z
            .object({
              statuses: trackerMapping,
              priorities: trackerMapping,
              fields: trackerMapping,
              users: z.record(
                z.string().min(1).max(255),
                z.string().min(1).max(128).nullable(),
              ),
            })
            .strict(),
        }),
      )
      .mutation(({ ctx, input }) => ctx.tracker.save(ctx.userId, input)),
    metadata: authenticated
      .input(issueScope)
      .mutation(({ ctx, input }) =>
        ctx.tracker.metadata(ctx.userId, input.projectId),
      ),
    run: authenticated
      .input(
        issueScope.extend({
          direction: z.enum(["import", "push"]),
          overwriteConflicts: z.boolean().default(false),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.tracker.run(
          ctx.userId,
          input.projectId,
          input.direction,
          input.overwriteConflicts,
        ),
      ),
  }),

  fields: t.router({
    save: authenticated
      .input(
        issueScope.extend({
          id: applicationId.optional(),
          name: z.string().trim().min(1).max(80),
          type: z.enum(["text", "date", "number", "user"]),
        }),
      )
      .mutation(({ ctx, input }) => ctx.fields.save(ctx.userId, input)),
  }),
  jira: t.router({
    test: authenticated.input(issueScope.extend({ config: jiraConfig })).mutation(({ ctx, input }) => ctx.jira.test(ctx.userId, input.projectId, input.config)),
    get: authenticated
      .input(issueScope)
      .query(({ ctx, input }) => ctx.jira.get(ctx.userId, input.projectId)),
    save: authenticated
      .input(issueScope.extend({ config: jiraConfig }))
      .mutation(({ ctx, input }) =>
        ctx.jira.save(ctx.userId, input.projectId, input.config),
      ),
    discover: authenticated
      .input(issueScope.extend({ config: jiraConfig.optional() }))
      .mutation(({ ctx, input }) =>
        ctx.jira.discover(ctx.userId, input.projectId, input.config),
      ),
    mappings: authenticated
      .input(
        issueScope.extend({
          mappings: z
            .object({
              issueTypes: mapping.optional(),
              statuses: mapping,
              priorities: mapping,
              users: mapping,
              fields: z.record(
                z.string().min(1).max(255),
                z.string().min(1).max(128).nullable(),
              ),
            })
            .strict(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.jira.mappings(ctx.userId, input.projectId, input.mappings),
      ),
    schedule: authenticated
      .input(
        issueScope.extend({
          minutes: z
            .union([z.literal(15), z.literal(60), z.literal(1440)])
            .nullable(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.jira.schedule(ctx.userId, input.projectId, input.minutes),
      ),
    startImport: authenticated
      .input(issueScope)
      .mutation(({ ctx, input }) =>
        ctx.jira.startImport(ctx.userId, input.projectId),
      ),
    stopImport: authenticated
      .input(issueScope.extend({ runId: applicationId }))
      .mutation(({ ctx, input }) =>
        ctx.jira.stopImport(ctx.userId, input.projectId, input.runId),
      ),
    finishImport: authenticated
      .input(issueScope.extend({ runId: applicationId }))
      .mutation(({ ctx, input }) =>
        ctx.jira.finishImport(ctx.userId, input.projectId, input.runId),
      ),
    prepare: authenticated
      .input(issueScope.extend({ runId: applicationId.optional() }))
      .mutation(({ ctx, input }) =>
        ctx.jira.prepare(ctx.userId, input.projectId, input.runId),
      ),
    search: authenticated
      .input(
        issueScope.extend({
          runId: applicationId.optional(),
          nextPageToken: z.string().max(10000).optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.jira.search(
          ctx.userId,
          input.projectId,
          input.nextPageToken,
          input.runId,
        ),
      ),
    import: authenticated
      .input(
        issueScope.extend({
          externalId: z.string().min(1).max(128),
          overwriteLocal: z.boolean().default(false),
          runId: applicationId.optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.jira.import(
          ctx.userId,
          input.projectId,
          input.externalId,
          input.overwriteLocal,
          input.runId,
        ),
      ),
    pushIssue: authenticated
      .input(issueRef.extend({ overwriteRemote: z.boolean().default(false) }))
      .mutation(({ ctx, input }) =>
        ctx.jira.pushIssue(
          ctx.userId,
          input.projectId,
          input.id,
          input.overwriteRemote,
        ),
      ),
    pushComment: authenticated
      .input(issueRef.extend({ overwriteRemote: z.boolean().default(false) }))
      .mutation(({ ctx, input }) =>
        ctx.jira.pushComment(
          ctx.userId,
          input.projectId,
          input.id,
          input.overwriteRemote,
        ),
      ),
    pending: authenticated
      .input(issueScope)
      .query(({ ctx, input }) => ctx.jira.pending(ctx.userId, input.projectId)),
    reconcile: authenticated
      .input(
        issueRef.extend({
          kind: z.enum(["issue", "comment"]),
          externalId: z.string().min(1).max(128),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.jira.reconcile(
          ctx.userId,
          input.projectId,
          input.kind,
          input.id,
          input.externalId,
        ),
      ),
  }),
  worklogs: t.router({
    list: authenticated
      .input(
        worklogScope.extend({
          includeDeleted: z.boolean().default(false),
          cursor: z
            .object({ createdAt: z.iso.datetime(), id: applicationId })
            .strict()
            .optional(),
        }),
      )
      .query(({ ctx, input }) => ctx.worklogs.list(ctx.userId, input)),
    create: authenticated
      .input(worklogDraft)
      .mutation(({ ctx, input }) => ctx.worklogs.save(ctx.userId, input)),
    update: authenticated
      .input(
        worklogDraft.extend({
          id: applicationId,
          expectedUpdatedAt: z.iso.datetime(),
        }),
      )
      .mutation(({ ctx, input }) => ctx.worklogs.save(ctx.userId, input)),
    setDeleted: authenticated
      .input(
        worklogScope.extend({
          id: applicationId,
          expectedUpdatedAt: z.iso.datetime(),
          deleted: z.boolean(),
        }),
      )
      .mutation(({ ctx, input }) => ctx.worklogs.setDeleted(ctx.userId, input)),
  }),
  comments: t.router({
    list: authenticated
      .input(
        commentScope.extend({
          parentId: applicationId.nullable(),
          cursor: z
            .object({ createdAt: z.iso.datetime(), id: applicationId })
            .strict()
            .optional(),
        }),
      )
      .query(({ ctx, input }) => ctx.comments.list(ctx.userId, input)),
    create: authenticated
      .input(commentDraft.extend({ parentId: applicationId.nullable() }))
      .mutation(({ ctx, input }) => ctx.comments.save(ctx.userId, input)),
    update: authenticated
      .input(
        commentDraft.extend({
          id: applicationId,
          expectedUpdatedAt: z.iso.datetime(),
        }),
      )
      .mutation(({ ctx, input }) => ctx.comments.save(ctx.userId, input)),
    delete: authenticated
      .input(
        commentScope.extend({
          id: applicationId,
          expectedUpdatedAt: z.iso.datetime(),
        }),
      )
      .mutation(({ ctx, input }) => ctx.comments.delete(ctx.userId, input)),
  }),
  files: t.router({
    limits: authenticated.query(({ ctx }) => ({
      maxBytes: ctx.files.maxBytes,
    })),
    library: authenticated
      .input(
        z
          .object({
            projectId: applicationId.optional(),
            search: z.string().max(255).optional(),
            offset: z.number().int().min(0).default(0),
          })
          .strict(),
      )
      .query(({ ctx, input }) => ctx.files.library(ctx.userId, input)),
    attachments: authenticated
      .input(
        z.object({ projectId: applicationId, issueId: applicationId }).strict(),
      )
      .query(({ ctx, input }) =>
        ctx.files.attachments(ctx.userId, input.projectId, input.issueId),
      ),
    link: authenticated
      .input(
        z
          .object({
            projectId: applicationId,
            issueId: applicationId,
            sourceProjectId: applicationId,
            projectFileId: applicationId,
          })
          .strict(),
      )
      .mutation(({ ctx, input }) => ctx.files.link(ctx.userId, input)),
    unlink: authenticated
      .input(
        z
          .object({
            projectId: applicationId,
            issueId: applicationId,
            attachmentId: applicationId,
          })
          .strict(),
      )
      .mutation(({ ctx, input }) => ctx.files.unlink(ctx.userId, input)),
  }),
  issues: t.router({
    activity: authenticated
      .input(worklogScope.extend({ cursor: applicationId.optional() }))
      .query(({ ctx, input }) => ctx.activity.list(ctx.userId, input)),
    list: authenticated
      .input(issueScope)
      .query(({ ctx, input }) => ctx.issues.list(ctx.userId, input.projectId)),
    settings: authenticated
      .input(issueScope)
      .query(({ ctx, input }) =>
        ctx.issues.settings(ctx.userId, input.projectId),
      ),
    create: authenticated
      .input(
        issueFields.partial().extend({
          projectId: applicationId,
          title: issueFields.shape.title,
          projectFileIds: z.array(applicationId).max(20).optional(),
        }),
      )
      .mutation(({ ctx, input }) => ctx.issues.create(ctx.userId, input)),
    update: authenticated
      .input(
        issueFields.partial().extend({
          projectId: applicationId,
          id: applicationId,
          expectedUpdatedAt: z.iso.datetime(),
        }),
      )
      .mutation(({ ctx, input }) => ctx.issues.update(ctx.userId, input)),
    setDeleted: authenticated
      .input(
        issueRef.extend({
          deleted: z.boolean(),
          expectedUpdatedAt: z.iso.datetime(),
        }),
      )
      .mutation(({ ctx, input }) => ctx.issues.setDeleted(ctx.userId, input)),
    history: authenticated
      .input(issueRef.extend({ offset: z.number().int().min(0).default(0) }))
      .query(({ ctx, input }) =>
        ctx.issues.history(ctx.userId, input.projectId, input.id, input.offset),
      ),
    saveOption: authenticated
      .input(
        optionRef.omit({ id: true }).extend({
          id: applicationId.optional(),
          name: z.string().trim().min(1).max(80),
          position: z.number().int().min(0).max(2147483647),
          color: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .nullable(),
          trigger: z.enum(issueTriggers).optional(),
          isDefault: z.boolean().optional(),
        }),
      )
      .mutation(({ ctx, input }) => ctx.issues.saveOption(ctx.userId, input)),
    deleteOption: authenticated
      .input(optionRef)
      .mutation(({ ctx, input }) => ctx.issues.deleteOption(ctx.userId, input)),
  }),
  invitations: t.router({
    preview: authenticated
      .input(invitationToken)
      .mutation(({ ctx, input }) =>
        ctx.invitations.preview(ctx.userId, input.token),
      ),
    accept: authenticated
      .input(invitationToken)
      .mutation(({ ctx, input }) =>
        ctx.invitations.accept(ctx.userId, input.token),
      ),
  }),
  projects: t.router({
    discoverLogo: authenticated
      .input(
        z.object({
          url: websiteURL.refine((value) => !!value, "Enter a website URL."),
        }),
      )
      .mutation(({ input }) => discoverProjectLogo(input.url!)),
    archive: authenticated
      .input(projectId)
      .mutation(({ ctx, input }) => ctx.projects.archive(ctx.userId, input.id)),
    members: authenticated
      .input(projectId)
      .query(({ ctx, input }) => ctx.invitations.members(ctx.userId, input.id)),
    invitations: authenticated
      .input(projectId)
      .query(({ ctx, input }) => ctx.invitations.list(ctx.userId, input.id)),
    invite: authenticated
      .input(
        z
          .object({
            id: applicationId,
            email: z.string().trim().toLowerCase().email().max(254),
          })
          .strict(),
      )
      .mutation(({ ctx, input }) =>
        ctx.invitations.invite(ctx.userId, input.id, input.email),
      ),
    cancelInvitation: authenticated
      .input(
        z.object({ id: applicationId, invitationId: applicationId }).strict(),
      )
      .mutation(({ ctx, input }) =>
        ctx.invitations.cancel(ctx.userId, input.id, input.invitationId),
      ),
    list: authenticated.query(({ ctx }) => ctx.projects.list(ctx.userId)),
    get: authenticated
      .input(projectId)
      .query(({ ctx, input }) => ctx.projects.get(ctx.userId, input.id)),
    create: authenticated
      .input(projectInput)
      .mutation(({ ctx, input }) => ctx.projects.create(ctx.userId, input)),
    update: authenticated
      .input(projectInput.extend({ id: applicationId }))
      .mutation(({ ctx, input: { id, ...input } }) =>
        ctx.projects.update(ctx.userId, id, input),
      ),
  }),
});
export type AppRouter = typeof appRouter;
