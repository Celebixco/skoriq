CREATE INDEX "matches_sofascore_id_idx" ON "matches" USING btree ((metadata_json->>'sofascoreId'));--> statement-breakpoint
CREATE INDEX "teams_sofascore_id_idx" ON "teams" USING btree ((metadata_json->>'sofascoreId'));
