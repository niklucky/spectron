import { APIError } from "better-auth/api";
import { schema, type Database } from "@spectron/db";
import { eq, sql } from "drizzle-orm";
import { LogoError, normalizeLogoDataURL } from "./project-logo/images";

export const profileAvatarPath = "/api/profile-avatars";

export async function storeProfileAvatar({ image }: { image?: unknown }) {
  if (image == null) return;
  try {
    const png = await normalizeLogoDataURL(typeof image === "string" ? image : null);
    if (!png) throw new LogoError();
    // The database stores the PNG and replaces the data URL in the same write.
    return { data: { image: png } };
  } catch (error) {
    if (!(error instanceof LogoError)) throw error;
    throw new APIError("BAD_REQUEST", { message: "Choose a valid avatar image." });
  }
}

export async function readProfileAvatar(db: Database, key: string, revalidate: boolean) {
  const { profileAvatar } = schema;
  const [avatar] = await db
    .select({ data: revalidate ? sql<null>`null` : profileAvatar.data })
    .from(profileAvatar)
    .where(eq(profileAvatar.key, key));
  return avatar;
}
