-- Accounts created before login links existed were never asked to verify
-- their email: nothing depended on it. The magic-link plugin treats an
-- unverified account as unproven and, on the first link login, drops its
-- password and sessions so a pre-registered address cannot hand access to a
-- squatter. Everyone who exists at this point registered themselves or came
-- in on an invitation to this address, so they are marked verified here and
-- keep their passwords. New sign-ups verify through the email sent on sign-up.
UPDATE "users" SET "email_verified" = true WHERE "email_verified" = false;
