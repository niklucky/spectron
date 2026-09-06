import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  ProjectAccessError,
  InvitationError,
  LogoError,
  discoverProjectLogo,
} from "@spectron/backend";
import { normalizeProjectURL } from "@spectron/shared";
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
  if (
    !result.ok &&
    (result.error.cause instanceof LogoError ||
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
const projectId = z.object({ id: z.uuid() }).strict();

const invitationToken = z
  .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export const appRouter = t.router({
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
            id: z.uuid(),
            email: z.string().trim().toLowerCase().email().max(254),
          })
          .strict(),
      )
      .mutation(({ ctx, input }) =>
        ctx.invitations.invite(ctx.userId, input.id, input.email),
      ),
    cancelInvitation: authenticated
      .input(z.object({ id: z.uuid(), invitationId: z.uuid() }).strict())
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
      .input(projectInput.extend({ id: z.uuid() }))
      .mutation(({ ctx, input: { id, ...input } }) =>
        ctx.projects.update(ctx.userId, id, input),
      ),
  }),
});
export type AppRouter = typeof appRouter;
