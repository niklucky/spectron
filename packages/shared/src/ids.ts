import { nanoid } from "nanoid";

/** Application-owned IDs use NanoID's URL-safe alphabet and 21-character size. */
export const applicationIdPattern = /^[A-Za-z0-9_-]{21}$/;

export function createId(): string {
  return nanoid(21);
}
