ALTER TABLE "matches" ADD COLUMN "stage_name" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "neutral_ground" boolean;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "attendance" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "winner_team_id" uuid;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_team_id_teams_id_fk" FOREIGN KEY ("winner_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;