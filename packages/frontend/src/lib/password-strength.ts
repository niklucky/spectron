/**
 * Rough password strength for the sign-up and reset forms. It is a hint for
 * the person typing, not a policy: the only hard rule is the minimum length,
 * which the server enforces too.
 */
export const PASSWORD_MIN_LENGTH = 8;

export type PasswordStrength = {
  /** 0 = too short, 1 = weak, 2 = fair, 3 = good, 4 = strong */
  score: 0 | 1 | 2 | 3 | 4;
  label: "Too short" | "Weak" | "Fair" | "Good" | "Strong";
};

const labels = ["Too short", "Weak", "Fair", "Good", "Strong"] as const;
const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/];
const common = /password|spectron|qwerty|letmein|welcome|iloveyou|abc123|123456/i;
const sequences = /0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwer|asdf|zxcv/gi;

export function passwordStrength(
  password: string,
  min = PASSWORD_MIN_LENGTH,
): PasswordStrength {
  if (password.length < min) return { score: 0, label: labels[0] };
  let points = 0;
  const variety = classes.filter((rule) => rule.test(password)).length;
  points += variety >= 3 ? 2 : variety === 2 ? 1 : 0;
  if (password.length >= 12) points += 1;
  if (password.length >= 16) points += 1;
  const unique = new Set(password).size;
  if (unique <= Math.max(3, password.length / 3)) points -= 1;
  if (/^(.)\1+$/.test(password)) points -= 1;
  points -= (password.match(sequences) ?? []).length;
  if (common.test(password)) points -= 2;
  const score = (1 + Math.min(3, Math.max(0, points))) as 1 | 2 | 3 | 4;
  return { score, label: labels[score] };
}
