import sqlite3
import sys
import tempfile
import zipfile
from pathlib import Path


TABLES = (
    "messages",
    "profile",
    "events",
    "daily_memory_summaries",
    "procedural_memories",
    "memory_entities",
    "memory_facts",
    "memory_fact_sources",
    "memory_review_queue",
    "project_notes",
    "memory_index",
    "data_activity_records",
)
DATABASE_ENTRY = "app/resources/database/athena.db"


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage", "expected one AppX/MSIX artifact path")

    artifact = Path(sys.argv[1]).resolve()
    if not artifact.is_file():
        fail("artifact-missing", str(artifact))

    with tempfile.TemporaryDirectory(prefix="athena-store-db-") as temp_dir:
        database_path = Path(temp_dir) / "athena.db"
        try:
            with zipfile.ZipFile(artifact) as archive:
                database_path.write_bytes(archive.read(DATABASE_ENTRY))
        except (KeyError, OSError, zipfile.BadZipFile) as error:
            fail("database-extract-failed", str(error))

        connection = sqlite3.connect(f"file:{database_path.as_posix()}?mode=ro", uri=True)
        try:
            integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
            schema_version = int(connection.execute("PRAGMA user_version").fetchone()[0])
            freelist_count = int(connection.execute("PRAGMA freelist_count").fetchone()[0])
            counts = {
                table: int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
                for table in TABLES
            }
        except sqlite3.Error as error:
            fail("database-query-failed", str(error))
        finally:
            connection.close()

    if integrity != "ok":
        fail("integrity-failed", str(integrity))
    if schema_version != 8:
        fail("schema-version", str(schema_version))
    if freelist_count != 0:
        fail("freelist-not-empty", str(freelist_count))
    populated = {table: count for table, count in counts.items() if count != 0}
    if populated:
        fail("personal-data-present", str(populated))

    print(
        "ATHENA_STORE_SEED_CLEAN_OK "
        f"schema={schema_version} integrity={integrity} freelist={freelist_count} "
        + " ".join(f"{table}=0" for table in TABLES)
    )


def fail(code: str, detail: str) -> None:
    print(f"ATHENA_STORE_SEED_BLOCKED {code} {detail}", file=sys.stderr)
    raise SystemExit(2)


if __name__ == "__main__":
    main()
