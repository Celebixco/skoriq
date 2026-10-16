import os
import sys
import time
import subprocess

def legacy_rebuild_allowed():
    # Reuse the same JS guard as the seed entrypoint before any provider request.
    # This legacy workflow rebuilds disposable local data; it is not incremental sync.
    guard = subprocess.run(
        ["node", "--input-type=module", "-e",
         "import { assertLegacySeedAllowed } from './db-seed.js'; "
         "try { assertLegacySeedAllowed(process.env); } "
         "catch (error) { console.error(error.message); process.exitCode = 1; }"],
        cwd=os.path.dirname(os.path.abspath(__file__)),
        capture_output=True,
        text=True,
    )
    if guard.returncode != 0:
        print("Legacy disposable test database rebuild refused:", guard.stderr.strip())
        return False
    return True

def run_sync():
    if not legacy_rebuild_allowed():
        return False
    print("=" * 60)
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] STARTING LEGACY SOFASCORE DISPOSABLE TEST DATABASE REBUILD")
    print("=" * 60)

    # 1. Scrape SofaScore with curl_cffi
    print("Step 1: Scraping latest matches, standings, and telemetry from SofaScore...")
    scraper_path = os.path.join(os.path.dirname(__file__), "scrape_sofascore.py")
    result = subprocess.run([sys.executable, scraper_path], capture_output=True, text=True)
    if result.returncode != 0:
        print("Scraper error:", result.stderr)
        return False
    print(result.stdout.strip().split("\n")[-6:])

    # 1b. Enrich squads and team recent matches
    print("\nStep 1b: Enriching squads, player profiles, and recent matches...")
    enrichment_path = os.path.join(os.path.dirname(__file__), "scrape_enrichment.py")
    enrich_result = subprocess.run([sys.executable, enrichment_path], capture_output=True, text=True)
    if enrich_result.returncode != 0:
        print("Enrichment error:", enrich_result.stderr)
    else:
        print(enrich_result.stdout.strip().split("\n")[-6:])

    # 2. Ingest into database
    print("\nStep 2: Rebuilding the explicitly opted-in disposable local PostgreSQL catalog...")
    db_seed_path = os.path.join(os.path.dirname(__file__), "db-seed.ts")
    npx_cmd = "npx.cmd" if sys.platform == "win32" else "npx"
    sync_env = dict(os.environ)
    # FORCE_SEED only bypasses the existing-data shortcut after the separate
    # ALLOW_DESTRUCTIVE_SEED and disposable local target checks have passed.
    sync_env["FORCE_SEED"] = "true"
    seed_result = subprocess.run([npx_cmd, "tsx", db_seed_path], capture_output=True, text=True, env=sync_env)
    if seed_result.returncode != 0:
        print("Database sync error:", seed_result.stderr)
        return False
    print(seed_result.stdout.strip().split("\n")[-7:])

    print("=" * 60)
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] SYNC CYCLE COMPLETED SUCCESSFULLY")
    print("=" * 60)
    return True

def main():
    if not legacy_rebuild_allowed():
        sys.exit(1)
    interval_minutes = int(os.environ.get("SYNC_INTERVAL_MINUTES", "180")) # Default 3 hours
    once_mode = "--once" in sys.argv

    if once_mode:
        success = run_sync()
        sys.exit(0 if success else 1)

    print(f"Starting legacy SofaScore disposable test rebuild daemon (Interval: {interval_minutes} minutes)...")
    while True:
        try:
            run_sync()
        except Exception as e:
            print(f"Unexpected sync error: {e}")

        print(f"\nNext sync in {interval_minutes} minutes. Sleeping...")
        time.sleep(interval_minutes * 60)

if __name__ == "__main__":
    main()
