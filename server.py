#!/usr/bin/env python3
"""
Neon Survivors - Vampire Survivors style web game backend.
Uses Python standard library (http.server + sqlite3 + hashlib + secrets)
for zero external dependencies.
"""

import atexit
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import subprocess
import sys
import threading
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = (
    os.path.join(BASE_DIR, "static")
    if os.path.isfile(os.path.join(BASE_DIR, "static", "index.html"))
    else BASE_DIR
)
DB_PATH = os.path.join(BASE_DIR, "game.db")

DEFAULT_UPGRADES = {
    "max_hp": 0,
    "move_speed": 0,
    "damage": 0,
    "magnet": 0,
    "greed": 0,
}

UPGRADE_CONFIG = {
    "max_hp": {"max_level": 10, "base_cost": 30, "cost_mult": 1.5, "name": "Живучесть (+20 HP)"},
    "damage": {"max_level": 10, "base_cost": 40, "cost_mult": 1.6, "name": "Мощь (+10% урона)"},
    "move_speed": {"max_level": 8, "base_cost": 35, "cost_mult": 1.5, "name": "Скорость (+6% бега)"},
    "magnet": {"max_level": 8, "base_cost": 25, "cost_mult": 1.45, "name": "Магнит (+20% радиуса сбора)"},
    "greed": {"max_level": 8, "base_cost": 45, "cost_mult": 1.6, "name": "Алчность (+15% золота)"},
}
DUMP_PATH = os.path.join(BASE_DIR, "game_backup.sql")

_sync_lock = threading.Lock()
_sync_timer = None
_sync_status = {
    "status": "idle",
    "message": "Ожидание изменений",
    "time": datetime.now(timezone.utc).isoformat(),
}


def restore_from_dump_if_needed():
    """Восстанавливает базу данных из game_backup.sql, если game.db отсутствует или пуста."""
    if (not os.path.exists(DB_PATH) or os.path.getsize(DB_PATH) == 0) and os.path.exists(DUMP_PATH):
        try:
            print("[DB] Восстановление базы данных из game_backup.sql...", flush=True)
            with sqlite3.connect(DB_PATH) as conn:
                with open(DUMP_PATH, "r", encoding="utf-8") as f:
                    conn.executescript(f.read())
            print("[DB] База данных успешно восстановлена из резервной копии!", flush=True)
        except Exception as e:
            print(f"[DB] Ошибка восстановления из SQL-дампа: {e}", file=sys.stderr, flush=True)


def checkpoint_and_export():
    """Сбрасывает WAL в основной файл game.db и создаёт текстовый дамп SQL."""
    try:
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            with open(DUMP_PATH, "w", encoding="utf-8") as f:
                for line in conn.iterdump():
                    f.write(f"{line}\n")
    except Exception as e:
        print(f"[DB] Ошибка создания резервной копии SQL: {e}", file=sys.stderr, flush=True)


def perform_git_sync():
    """Синхронизирует game.db и game_backup.sql с репозиторием Git (Codespace / GitHub)."""
    global _sync_status
    checkpoint_and_export()

    try:
        res = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=BASE_DIR,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if res.returncode != 0:
            _sync_status = {
                "status": "not_git",
                "message": "Папка не является git-репозиторием",
                "time": datetime.now(timezone.utc).isoformat(),
            }
            return _sync_status
    except Exception as e:
        _sync_status = {
            "status": "error",
            "message": f"Git недоступен: {e}",
            "time": datetime.now(timezone.utc).isoformat(),
        }
        return _sync_status

    try:
        subprocess.run(
            ["git", "add", "game.db", "game_backup.sql"],
            cwd=BASE_DIR,
            check=True,
            capture_output=True,
            text=True,
            timeout=15,
        )

        diff = subprocess.run(
            ["git", "diff", "--cached", "--quiet"],
            cwd=BASE_DIR,
            capture_output=True,
            timeout=10,
        )
        if diff.returncode == 0:
            _sync_status = {
                "status": "synced",
                "message": "База данных актуальна, изменений нет",
                "time": datetime.now(timezone.utc).isoformat(),
            }
            return _sync_status

        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        commit_res = subprocess.run(
            ["git", "commit", "-m", f"Auto-sync database: {now_str} [skip ci]"],
            cwd=BASE_DIR,
            capture_output=True,
            text=True,
            timeout=15,
        )
        if commit_res.returncode != 0:
            _sync_status = {
                "status": "commit_error",
                "message": commit_res.stderr.strip() or "Ошибка коммита",
                "time": datetime.now(timezone.utc).isoformat(),
            }
            return _sync_status

        push_res = subprocess.run(
            ["git", "push"],
            cwd=BASE_DIR,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if push_res.returncode == 0:
            print(f"[GIT AUTO-SYNC] ✔ База данных успешно выгружена в репозиторий ({now_str})", flush=True)
            _sync_status = {
                "status": "synced",
                "message": f"✔ Успешно выгружено в репозиторий ({now_str})",
                "time": datetime.now(timezone.utc).isoformat(),
            }
        else:
            err = push_res.stderr.strip() or push_res.stdout.strip()
            print(f"[GIT AUTO-SYNC] Внимание: коммит создан, push отклонён: {err}", file=sys.stderr, flush=True)
            _sync_status = {
                "status": "push_pending",
                "message": f"Закоммичено локально. Ошибка push: {err[:50]}",
                "time": datetime.now(timezone.utc).isoformat(),
            }
    except Exception as e:
        print(f"[GIT AUTO-SYNC] Ошибка синхронизации: {e}", file=sys.stderr, flush=True)
        _sync_status = {
            "status": "error",
            "message": f"Ошибка: {e}",
            "time": datetime.now(timezone.utc).isoformat(),
        }
    return _sync_status


def schedule_git_sync(delay_seconds=4.0):
    """Отложенная синхронизация с Git (debounce), чтобы не спамить коммитами при частых запросах."""
    global _sync_timer
    with _sync_lock:
        if _sync_timer is not None:
            _sync_timer.cancel()
        _sync_timer = threading.Timer(delay_seconds, perform_git_sync)
        _sync_timer.daemon = True
        _sync_timer.start()


atexit.register(checkpoint_and_export)



def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                gold INTEGER NOT NULL DEFAULT 0,
                upgrades_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                weapon TEXT NOT NULL DEFAULT 'wand',
                score INTEGER NOT NULL DEFAULT 0,
                survival_time INTEGER NOT NULL DEFAULT 0,
                kills INTEGER NOT NULL DEFAULT 0,
                level_reached INTEGER NOT NULL DEFAULT 1,
                gold_earned INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_runs_score ON runs(score DESC, survival_time DESC);
            CREATE INDEX IF NOT EXISTS idx_runs_user ON runs(user_id, created_at DESC);
            """
        )


def hash_password(password: str, salt: str | None = None) -> str:
    if salt is None:
        salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return f"{salt}${dk.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt, _ = stored_hash.split("$", 1)
    except ValueError:
        return False
    expected = hash_password(password, salt)
    return hmac.compare_digest(expected, stored_hash)


def parse_upgrades(upgrades_json: str) -> dict:
    try:
        data = json.loads(upgrades_json) if upgrades_json else {}
    except json.JSONDecodeError:
        data = {}
    merged = dict(DEFAULT_UPGRADES)
    for k in DEFAULT_UPGRADES:
        if isinstance(data.get(k), int) and data[k] >= 0:
            merged[k] = data[k]
    return merged


def calc_upgrade_cost(key: str, current_level: int) -> int:
    cfg = UPGRADE_CONFIG[key]
    return int(round(cfg["base_cost"] * (cfg["cost_mult"] ** current_level)))


def build_user_profile(conn: sqlite3.Connection, user_row: sqlite3.Row) -> dict:
    upgrades = parse_upgrades(user_row["upgrades_json"])
    stats_row = conn.execute(
        """
        SELECT
            COUNT(*) AS total_runs,
            COALESCE(MAX(score), 0) AS best_score,
            COALESCE(MAX(survival_time), 0) AS best_time,
            COALESCE(MAX(kills), 0) AS best_kills,
            COALESCE(SUM(kills), 0) AS total_kills
        FROM runs
        WHERE user_id = ?
        """,
        (user_row["id"],),
    ).fetchone()

    recent_runs = conn.execute(
        """
        SELECT id, weapon, score, survival_time, kills, level_reached, gold_earned, created_at
        FROM runs
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 10
        """,
        (user_row["id"],),
    ).fetchall()

    return {
        "id": user_row["id"],
        "username": user_row["username"],
        "gold": user_row["gold"],
        "upgrades": upgrades,
        "upgrade_Config": UPGRADE_CONFIG,
        "stats": {
            "total_runs": stats_row["total_runs"],
            "best_score": stats_row["best_score"],
            "best_time": stats_row["best_time"],
            "best_kills": stats_row["best_kills"],
            "total_kills": stats_row["total_kills"],
        },
        "recent_runs": [dict(r) for r in recent_runs],
    }


class GameRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[API] {self.address_string()} - {fmt % args}\n")

    def send_json(self, data: dict, status: int = HTTPStatus.OK):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 65536:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return {}

    def get_current_user(self, conn: sqlite3.Connection):
        auth_header = self.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return None, None
        token = auth_header[7:].strip()
        if not token:
            return None, None
        row = conn.execute(
            """
            SELECT u.*
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token = ?
            """,
            (token,),
        ).fetchone()
        return row, token

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/me":
            with get_db() as conn:
                user, _ = self.get_current_user(conn)
                if not user:
                    return self.send_json({"error": "Не авторизован"}, HTTPStatus.UNAUTHORIZED)
                return self.send_json({"user": build_user_profile(conn, user)})

        if parsed.path == "/api/leaderboard":
            with get_db() as conn:
                top_runs = conn.execute(
                    """
                    SELECT
                        r.id,
                        r.username,
                        r.weapon,
                        r.score,
                        r.survival_time,
                        r.kills,
                        r.level_reached,
                        r.gold_earned,
                        r.created_at
                    FROM runs r
                    ORDER BY r.score DESC, r.survival_time DESC
                    LIMIT 25
                    """
                ).fetchall()

                best_per_player = conn.execute(
                    """
                    SELECT
                        username,
                        MAX(score) AS best_score,
                        MAX(survival_time) AS best_time,
                        MAX(kills) AS best_kills,
                        MAX(level_reached) AS max_level,
                        COUNT(*) AS runs_count
                    FROM runs
                    GROUP BY username
                    ORDER BY best_score DESC, best_time DESC
                    LIMIT 25
                    """
                ).fetchall()

                return self.send_json(
                    {
                        "top_runs": [dict(r) for r in top_runs],
                        "best_players": [dict(r) for r in best_per_player],
                    }
                )

        if parsed.path == "/api/sync-status":
            return self.send_json(_sync_status)
        if parsed.path == "/" or parsed.path == "":
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        body = self.read_json_body()
        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

        if parsed.path == "/api/sync-db":
            status = perform_git_sync()
            return self.send_json(status)
        if parsed.path == "/api/register":
            username = str(body.get("username", "")).strip()
            password = str(body.get("password", ""))

            if len(username) < 3 or len(username) > 20:
                return self.send_json(
                    {"error": "Логин должен быть от 3 до 20 символов"},
                    HTTPStatus.BAD_REQUEST,
                )
            if not all(c.isalnum() or c in "_-" for c in username):
                return self.send_json(
                    {"error": "Логин может содержать только буквы, цифры, _ и -"},
                    HTTPStatus.BAD_REQUEST,
                )
            if len(password) < 4:
                return self.send_json(
                    {"error": "Пароль должен быть не менее 4 символов"},
                    HTTPStatus.BAD_REQUEST,
                )

            pw_hash = hash_password(password)
            with get_db() as conn:
                existing = conn.execute(
                    "SELECT id FROM users WHERE username = ?", (username,)
                ).fetchone()
                if existing:
                    return self.send_json(
                        {"error": "Пользователь с таким логином уже существует"},
                        HTTPStatus.CONFLICT,
                    )

                cur = conn.execute(
                    """
                    INSERT INTO users (username, password_hash, gold, upgrades_json, created_at)
                    VALUES (?, ?, 0, ?, ?)
                    """,
                    (username, pw_hash, json.dumps(DEFAULT_UPGRADES), now_iso),
                )
                user_id = cur.lastrowid
                token = secrets.token_hex(24)
                conn.execute(
                    "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
                    (token, user_id, now_iso),
                )
                user_row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
                schedule_git_sync(3.0)
                return self.send_json(
                    {"token": token, "user": build_user_profile(conn, user_row)},
                    HTTPStatus.CREATED,
                )

        if parsed.path == "/api/login":
            username = str(body.get("username", "")).strip()
            password = str(body.get("password", ""))
            with get_db() as conn:
                user_row = conn.execute(
                    "SELECT * FROM users WHERE username = ?", (username,)
                ).fetchone()
                if not user_row or not verify_password(password, user_row["password_hash"]):
                    return self.send_json(
                        {"error": "Неверный логин или пароль"},
                        HTTPStatus.UNAUTHORIZED,
                    )
                token = secrets.token_hex(24)
                conn.execute(
                    "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
                    (token, user_row["id"], now_iso),
                )
                return self.send_json({"token": token, "user": build_user_profile(conn, user_row)})

        if parsed.path == "/api/logout":
            with get_db() as conn:
                _, token = self.get_current_user(conn)
                if token:
                    conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
            return self.send_json({"ok": True})

        if parsed.path == "/api/upgrade":
            upgrade_key = str(body.get("upgrade", "")).strip()
            if upgrade_key not in UPGRADE_CONFIG:
                return self.send_json({"error": "Неизвестное улучшение"}, HTTPStatus.BAD_REQUEST)

            with get_db() as conn:
                user_row, _ = self.get_current_user(conn)
                if not user_row:
                    return self.send_json({"error": "Не авторизован"}, HTTPStatus.UNAUTHORIZED)

                upgrades = parse_upgrades(user_row["upgrades_json"])
                current_lvl = upgrades.get(upgrade_key, 0)
                cfg = UPGRADE_CONFIG[upgrade_key]
                if current_lvl >= cfg["max_level"]:
                    return self.send_json(
                        {"error": "Достигнут максимальный уровень улучшения"},
                        HTTPStatus.BAD_REQUEST,
                    )

                cost = calc_upgrade_cost(upgrade_key, current_lvl)
                if user_row["gold"] < cost:
                    return self.send_json(
                        {"error": f"Недостаточно золота (нужно {cost})"},
                        HTTPStatus.BAD_REQUEST,
                    )

                new_gold = user_row["gold"] - cost
                upgrades[upgrade_key] = current_lvl + 1
                conn.execute(
                    "UPDATE users SET gold = ?, upgrades_json = ? WHERE id = ?",
                    (new_gold, json.dumps(upgrades), user_row["id"]),
                )
                updated_user = conn.execute(
                    "SELECT * FROM users WHERE id = ?", (user_row["id"],)
                ).fetchone()
                schedule_git_sync(3.0)
                return self.send_json({"user": build_user_profile(conn, updated_user)})

        if parsed.path == "/api/runs":
            with get_db() as conn:
                user_row, _ = self.get_current_user(conn)
                if not user_row:
                    return self.send_json({"error": "Не авторизован"}, HTTPStatus.UNAUTHORIZED)

                weapon = str(body.get("weapon", "wand"))[:20]
                survival_time = max(0, min(int(body.get("survival_time", 0)), 86400))
                kills = max(0, min(int(body.get("kills", 0)), 1_000_000))
                level_reached = max(1, min(int(body.get("level_reached", 1)), 999))
                gold_earned = max(0, min(int(body.get("gold_earned", 0)), 100_000))
                score = max(0, kills * 10 + survival_time * 5 + level_reached * 50 + gold_earned * 2)

                conn.execute(
                    """
                    INSERT INTO runs (
                        user_id, username, weapon, score, survival_time,
                        kills, level_reached, gold_earned, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        user_row["id"],
                        user_row["username"],
                        weapon,
                        score,
                        survival_time,
                        kills,
                        level_reached,
                        gold_earned,
                        now_iso,
                    ),
                )
                conn.execute(
                    "UPDATE users SET gold = gold + ? WHERE id = ?",
                    (gold_earned, user_row["id"]),
                )
                updated_user = conn.execute(
                    "SELECT * FROM users WHERE id = ?", (user_row["id"],)
                ).fetchone()
                schedule_git_sync(3.0)
                return self.send_json(
                    {
                        "score": score,
                        "user": build_user_profile(conn, updated_user),
                    },
                    HTTPStatus.CREATED,
                )

        return self.send_json({"error": "Маршрут не найден"}, HTTPStatus.NOT_FOUND)


def main():
    if "--backup" in sys.argv:
        checkpoint_and_export()
        print(f"✔ Резервная копия сохранена в {DUMP_PATH}")
        return
    if "--sync" in sys.argv:
        status = perform_git_sync()
        print(f"✔ Статус синхронизации: {status['message']}")
        return

    os.makedirs(STATIC_DIR, exist_ok=True)
    restore_from_dump_if_needed()
    init_db()
    checkpoint_and_export()

    port = int(os.environ.get("PORT", "8765"))
    ThreadingHTTPServer.allow_reuse_address = True
    server = ThreadingHTTPServer(("0.0.0.0", port), GameRequestHandler)
    print(f"Neon Survivors server running at http://localhost:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        checkpoint_and_export()
        server.server_close()


if __name__ == "__main__":
    main()
