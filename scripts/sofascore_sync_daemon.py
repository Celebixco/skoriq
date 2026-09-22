import os
import sys
import time
import subprocess

def run_sync():
    print("=" * 60)
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] STARTING SOFASCORE SYNC CYCLE")
    print("=" * 60)

    # 1. Scrape SofaScore with curl_cffi
    print("Step 1: Scraping latest matches, standings, and telemetry from SofaScore...")
    scraper_path = os.path.join(os.path.dirname(__file__), "scrape_sofascore.py")
    result = subprocess.run([sys.executable, scraper_path], capture_output=True, text=True)
    if result.returncode != 0:
        print("Scraper error:", result.stderr)
        return False
    print(result.stdout.strip().split("\n")[-6:])

    # 2. Ingest into database
    print("\nStep 2: Syncing into PostgreSQL database...")
    db_seed_path = os.path.join(os.path.dirname(__file__), "db-seed.ts")
    npx_cmd = "npx.cmd" if sys.platform == "win32" else "npx"
    sync_env = dict(os.environ)
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
    interval_minutes = int(os.environ.get("SYNC_INTERVAL_MINUTES", "180")) # Default 3 hours
    once_mode = "--once" in sys.argv

    if once_mode:
        success = run_sync()
        sys.exit(0 if success else 1)

    print(f"Starting SofaScore Continuous Sync Daemon (Interval: {interval_minutes} minutes)...")
    while True:
        try:
            run_sync()
        except Exception as e:
            print(f"Unexpected sync error: {e}")

        print(f"\nNext sync in {interval_minutes} minutes. Sleeping...")
        time.sleep(interval_minutes * 60)

if __name__ == "__main__":
    main()
