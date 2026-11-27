CREATE TABLE "profile_avatars" (
	"user_id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"data" text NOT NULL,
	CONSTRAINT "profile_avatars_key_unique" UNIQUE("key")
);
--> statement-breakpoint
-- A sign-up writes the avatar in a BEFORE INSERT trigger, before the new user exists.
ALTER TABLE "profile_avatars" ADD CONSTRAINT "profile_avatars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE FUNCTION "write_profile_avatar"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  png_prefix CONSTANT text := 'data:image/png;base64,';
  avatar_key text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.image IS NOT DISTINCT FROM OLD.image THEN
    RETURN NEW;
  END IF;

  IF starts_with(NEW.image, png_prefix) THEN
    avatar_key := gen_random_uuid()::text;
    INSERT INTO "profile_avatars" ("user_id", "key", "data")
    VALUES (NEW.id, avatar_key, substr(NEW.image, length(png_prefix) + 1))
    ON CONFLICT ("user_id") DO UPDATE SET "key" = EXCLUDED."key", "data" = EXCLUDED."data";
    NEW.image := '/api/profile-avatars/' || avatar_key;
  ELSIF TG_OP = 'UPDATE' THEN
    DELETE FROM "profile_avatars" WHERE "user_id" = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "users_write_profile_avatar"
BEFORE INSERT OR UPDATE OF "image" ON "users"
FOR EACH ROW EXECUTE FUNCTION "write_profile_avatar"();
