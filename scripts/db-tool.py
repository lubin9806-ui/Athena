import json
import re
import sqlite3
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = PROJECT_ROOT / "database" / "athena.db"


def main() -> None:
    command = sys.argv[1] if len(sys.argv) > 1 else "stats"
    if command == "stats":
        print(json.dumps(get_stats(), ensure_ascii=False, indent=2))
        return
    if command == "reindex":
        print(json.dumps(reindex(), ensure_ascii=False, indent=2))
        return
    print("Usage: python scripts/db-tool.py [stats|reindex]", file=sys.stderr)
    raise SystemExit(2)


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    run_migrations(conn)
    return conn


def run_migrations(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS memory_index (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_table TEXT NOT NULL,
          source_id INTEGER NOT NULL,
          keywords TEXT NOT NULL,
          created_at DATETIME DEFAULT (datetime('now', 'localtime')),
          UNIQUE(source_table, source_id)
        );
        CREATE INDEX IF NOT EXISTS idx_memory_index_source ON memory_index(source_table, source_id);
        """
    )


def get_stats() -> dict:
    with connect() as conn:
        tables = ["messages", "profile", "events", "project_notes", "memory_index"]
        stats = {"database": str(DB_PATH), "sizeBytes": DB_PATH.stat().st_size if DB_PATH.exists() else 0}
        for table in tables:
            stats[table] = safe_count(conn, table)
        stats["indexByTable"] = dict(
            conn.execute(
                "SELECT source_table, COUNT(*) FROM memory_index GROUP BY source_table ORDER BY source_table"
            ).fetchall()
        )
        return stats


def safe_count(conn: sqlite3.Connection, table: str) -> int:
    try:
        return int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
    except sqlite3.Error:
        return 0


def reindex() -> dict:
    with connect() as conn:
        conn.execute("DELETE FROM memory_index")
        counts = {
            "messages": index_rows(
                conn,
                "messages",
                "SELECT id, role, content, COALESCE(emotion, '') FROM messages",
            ),
            "profile": index_rows(
                conn,
                "profile",
                "SELECT id, category, fact, COALESCE(source, '') FROM profile",
            ),
            "events": index_rows(
                conn,
                "events",
                "SELECT id, summary, COALESCE(detail, ''), COALESCE(tags, ''), COALESCE(emotion, '') FROM events",
            ),
            "project_notes": index_rows(
                conn,
                "project_notes",
                "SELECT id, project, title, note, status, COALESCE(tags, '') FROM project_notes",
            ),
        }
        conn.commit()
        return {"database": str(DB_PATH), "indexed": counts, "memory_index": safe_count(conn, "memory_index")}


def index_rows(conn: sqlite3.Connection, table: str, query: str) -> int:
    count = 0
    for row in conn.execute(query).fetchall():
        if upsert_memory_index(conn, table, row[0], " ".join(map(str, row[1:]))):
            count += 1
    return count


def upsert_memory_index(conn: sqlite3.Connection, source_table: str, source_id: int, text: str) -> bool:
    keywords = extract_index_keywords(text)
    if not keywords:
        return False
    conn.execute(
        """
        INSERT INTO memory_index (source_table, source_id, keywords)
        VALUES (?, ?, ?)
        ON CONFLICT(source_table, source_id)
        DO UPDATE SET keywords = excluded.keywords,
                      created_at = datetime('now', 'localtime')
        """,
        (source_table, source_id, json.dumps(keywords, ensure_ascii=False)),
    )
    return True


def extract_index_keywords(text: str) -> list[str]:
    words: list[str] = []
    normalized = str(text).lower()
    for phrase in re.findall(r"[\u4e00-\u9fff]{2,}", normalized):
        if len(phrase) <= 16:
            words.append(phrase)
        for size in range(2, 5):
            for i in range(0, max(0, len(phrase) - size + 1)):
                words.append(phrase[i:i + size])
    words.extend(re.findall(r"[a-z][a-z0-9_-]{1,}", normalized))
    stop_words = {
        "这个", "那个", "什么", "怎么", "可以", "我们", "他们", "你们", "一个", "一些",
        "没有", "不是", "自己", "知道", "这样", "今天", "明天", "昨天", "帮我", "需要",
        "the", "this", "that", "what", "how", "can", "you", "your", "and", "for", "with",
    }
    result: list[str] = []
    seen = set()
    for word in words:
        word = word.strip()
        if len(word) < 2 or word in stop_words or word in seen:
            continue
        seen.add(word)
        result.append(word)
        if len(result) >= 48:
            break
    return result


if __name__ == "__main__":
    main()
