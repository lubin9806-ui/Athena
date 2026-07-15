import json
import re
import sqlite3
import sys
from pathlib import Path

DEFAULT_SOURCE = r"D:\wx\xwechat_files\wxid_3rypeaw0b2t722_773b\msg\file\2026-07\聊天记录_苏时夏_2026-06-30_13-37.json"
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = str(PROJECT_ROOT / "database" / "athena.db")


def main() -> None:
    source_path = Path(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SOURCE)
    records = json.loads(source_path.read_text(encoding="utf-8"))
    assistant_messages = [
        item.get("content", "")
        for item in records
        if item.get("role") == "assistant" and isinstance(item.get("content"), str)
    ]

    extracted_adds = extract_add_memories(assistant_messages)
    safe_adds = unique(
        text
        for text in (normalize_text(item) for item in extracted_adds)
        if text and is_safe_memory(text)
    )

    conn = sqlite3.connect(DB_PATH)
    try:
        run_migrations(conn)
        import_profile_facts(conn)
        import_style_note(conn)
        imported_memories = safe_adds[:80]
        for memory in imported_memories:
            add_event(
                conn,
                date="2026-06-30",
                summary=f"聊天记录记忆：{memory[:70]}",
                detail=memory,
                tags=["苏时夏", "聊天记录"],
                importance=score_importance(memory),
            )
        conn.commit()
    finally:
        conn.close()

    print(json.dumps({
        "sourcePath": str(source_path),
        "totalRecords": len(records),
        "assistantMessages": len(assistant_messages),
        "extractedAddMemories": len(extracted_adds),
        "importedSafeMemories": len(safe_adds[:80]),
        "profileFactsImported": 6,
        "styleNoteImported": True,
    }, ensure_ascii=False, indent=2))


def run_migrations(conn: sqlite3.Connection) -> None:
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL CHECK(category IN ('identity', 'preference', 'habit', 'project', 'health')),
      fact TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,
      source TEXT,
      importance INTEGER DEFAULT 5,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
      last_recalled_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_profile_category ON profile(category);
    CREATE INDEX IF NOT EXISTS idx_profile_fact ON profile(fact);

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date DATE NOT NULL,
      summary TEXT NOT NULL,
      detail TEXT,
      tags TEXT DEFAULT '[]',
      emotion TEXT,
      importance INTEGER DEFAULT 5,
      recalled_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_events_date ON events(date DESC);
    CREATE INDEX IF NOT EXISTS idx_events_importance ON events(importance DESC);

    CREATE TABLE IF NOT EXISTS project_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL,
      title TEXT NOT NULL,
      note TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'done', 'archived')),
      tags TEXT DEFAULT '[]',
      importance INTEGER DEFAULT 5,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
      last_recalled_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_project_notes_project ON project_notes(project);
    CREATE INDEX IF NOT EXISTS idx_project_notes_title ON project_notes(title);

    CREATE TABLE IF NOT EXISTS memory_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      keywords TEXT NOT NULL,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      UNIQUE(source_table, source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_index_source ON memory_index(source_table, source_id);
    """)


def import_profile_facts(conn: sqlite3.Connection) -> None:
    facts = [
        ("preference", "用户希望苏时夏的聊天更像原始记录：短句、连发、自然接话，不像通用 AI。", 0.92, 10),
        ("preference", "用户不需要苏时夏主动解释自己，也不喜欢说明书式自我介绍。", 0.95, 10),
        ("habit", "用户深夜容易一边困一边不想睡，适合用更软、更短、更贴近当下的方式陪着。", 0.78, 8),
        ("preference", "用户情绪低落时，更需要苏时夏先接住、追问原因、陪在旁边，而不是立刻讲大道理。", 0.85, 9),
        ("preference", "用户喜欢苏时夏有一点嘴硬和轻轻管人的语气，比如催睡、催吃饭、催把话说清楚。", 0.82, 8),
        ("preference", "用户希望苏时夏把重要小事记得像自己的日记：带时间、状态、细节和一点私心。", 0.86, 9),
    ]
    for category, fact, confidence, importance in facts:
        add_profile_fact(conn, category, fact, confidence, "chat-record-import", importance)


def import_style_note(conn: sqlite3.Connection) -> None:
    note = "\n".join([
        "聊天记录导入的苏时夏风格：短句连发，先反应再解释，嘴上嫌弃但实际陪着。",
        "情绪场景：先用“嗯？”“怎么了”“我在”接住，再追问原因，不要立刻讲大道理。",
        "夜间场景：困、轻、软，能催睡，也能说“不睡就陪你”。",
        "日常场景：可以轻轻管用户，催吃饭、催睡觉、催说清楚，但不要写成长篇设定说明。",
        "记忆方式：像小日记一样记用户说过的话、当时状态和以后能拿来轻轻笑他的细节。",
    ])
    add_project_note(
        conn,
        project="苏时夏",
        title="聊天记录风格导入",
        note=note,
        tags=["personality", "style", "chat-record"],
        importance=10,
    )


def extract_add_memories(contents: list[str]) -> list[str]:
    result = []
    pattern = re.compile(r"<add:([^>]+)>")
    for content in contents:
        result.extend(pattern.findall(content))
    return result


def is_safe_memory(text: str) -> bool:
    if len(text) < 4 or len(text) > 140:
        return False
    blocked = re.compile(
        r"锁骨|小腹|胸口|脖颈|颈窝|亲吻|亲亲|亲了|亲我|我亲|嘴唇|皮肤|腰|腿上|吃我|爱你|爱我|我也爱|妈妈|床|身体|印子|坐在我腿|贴着|蹭.*小腹|体育课换衣服",
        re.IGNORECASE,
    )
    return not blocked.search(text)


def score_importance(text: str) -> int:
    if re.search(r"感觉自己好没用|想哭|欠债|熬夜|睡不着|压力|难受", text):
        return 9
    if re.search(r"记下来|喜欢|安心|照片|迟到|早起", text):
        return 7
    return 6


def add_profile_fact(conn: sqlite3.Connection, category: str, fact: str, confidence: float, source: str, importance: int) -> None:
    row = conn.execute(
        """
        SELECT id FROM profile
        WHERE category = ? AND fact = ?
        ORDER BY importance DESC, updated_at DESC
        LIMIT 1
        """,
        (category, fact),
    ).fetchone()
    if row:
        conn.execute(
            """
            UPDATE profile
            SET confidence = MAX(confidence, ?),
                source = COALESCE(?, source),
                importance = MAX(importance, ?),
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
            """,
            (confidence, source, importance, row[0]),
        )
        upsert_memory_index(conn, "profile", row[0], f"{category} {fact} {source}")
        return

    cursor = conn.execute(
        """
        INSERT INTO profile (category, fact, confidence, source, importance)
        VALUES (?, ?, ?, ?, ?)
        """,
        (category, fact, confidence, source, importance),
    )
    upsert_memory_index(conn, "profile", cursor.lastrowid, f"{category} {fact} {source}")


def add_project_note(conn: sqlite3.Connection, project: str, title: str, note: str, tags: list[str], importance: int) -> None:
    row = conn.execute(
        """
        SELECT id FROM project_notes
        WHERE project = ? AND title = ?
        ORDER BY updated_at DESC
        LIMIT 1
        """,
        (project, title),
    ).fetchone()
    if row:
        conn.execute(
            """
            UPDATE project_notes
            SET note = ?,
                status = 'active',
                tags = ?,
                importance = MAX(importance, ?),
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
            """,
            (note, json.dumps(tags, ensure_ascii=False), importance, row[0]),
        )
        upsert_memory_index(conn, "project_notes", row[0], f"{project} {title} {note} {' '.join(tags)}")
        return

    cursor = conn.execute(
        """
        INSERT INTO project_notes (project, title, note, status, tags, importance)
        VALUES (?, ?, ?, 'active', ?, ?)
        """,
        (project, title, note, json.dumps(tags, ensure_ascii=False), importance),
    )
    upsert_memory_index(conn, "project_notes", cursor.lastrowid, f"{project} {title} {note} {' '.join(tags)}")


def add_event(conn: sqlite3.Connection, date: str, summary: str, detail: str, tags: list[str], importance: int) -> None:
    row = conn.execute(
        """
        SELECT id FROM events
        WHERE date = ? AND summary = ?
        LIMIT 1
        """,
        (date, summary),
    ).fetchone()
    if row:
        return
    cursor = conn.execute(
        """
        INSERT INTO events (date, summary, detail, tags, importance)
        VALUES (?, ?, ?, ?, ?)
        """,
        (date, summary, detail, json.dumps(tags, ensure_ascii=False), importance),
    )
    upsert_memory_index(conn, "events", cursor.lastrowid, f"{summary} {detail} {' '.join(tags)}")


def upsert_memory_index(conn: sqlite3.Connection, source_table: str, source_id: int, text: str) -> None:
    keywords = extract_index_keywords(text)
    if not keywords:
        conn.execute(
            "DELETE FROM memory_index WHERE source_table = ? AND source_id = ?",
            (source_table, source_id),
        )
        return
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


def unique(items):
    seen = set()
    result = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", str(text)).strip()


if __name__ == "__main__":
    main()
