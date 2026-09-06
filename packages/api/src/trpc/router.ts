import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  ProjectAccessError,
  IssueInputError,
  FileInputError,
  IssueConflictError,
  InvitationError,
  LogoError,
  discoverProjectLogo,
} from "@spectron/backend";
import {
  applicationIdPattern,
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
    (result.error.cause instanceof FileInputError ||
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

const invitationToken = z
  .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
const issueScope = z.object({ projectId: applicationId }).strict();
const issueRef = issueScope.extend({ id: applicationId });
const issueFields = z
  .object({
    title: z.string().trim().min(1).max(140),
    description: z.string().max(100_000),
    parentId: applicationId.nullable(),
    assigneeId: z.string().min(1).max(128).nullable(),
    stateId: applicationId,
    priorityId: applicationId.nullable(),
  })
  .strict();
const optionRef = issueScope.extend({
  kind: z.enum(["state", "priority"]),
  id: applicationId,
});
export const appRouter = t.router({
  files: t.router({
    limits: authenticated.query(({ ctx }) => ({ maxBytes: ctx.files.maxBytes })),
    library: authenticated.input(z.object({ projectId: applicationId.optional(), search: z.string().max(255).optional(), offset: z.number().int().min(0).default(0) }).strict()).query(({ ctx, input }) => ctx.files.library(ctx.userId, input)),
    attachments: authenticated.input(z.object({ projectId: applicationId, issueId: applicationId }).strict()).query(({ ctx, input }) => ctx.files.attachments(ctx.userId, input.projectId, input.issueId)),
    link: authenticated.input(z.object({ projectId: applicationId, issueId: applicationId, sourceProjectId: applicationId, projectFileId: applicationId }).strict()).mutation(({ ctx, input }) => ctx.files.link(ctx.userId, input)),
    unlink: authenticated.input(z.object({ projectId: applicationId, issueId: applicationId, attachmentId: applicationId }).strict()).mutation(({ ctx, input }) => ctx.files.unlink(ctx.userId, input)),
  }),
  issues: t.router({
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
        issueFields
          .partial()
          .extend({ projectId: applicationId, title: issueFields.shape.title }),
      )
      .mutation(({ ctx, input }) => ctx.issues.create(ctx.userId, input)),
    update: authenticated
      .input(
        issueFields
          .partial()
          .extend({
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
          position: z.number().int().min(0).max(10000),
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
