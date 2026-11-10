/* ============================================================================
 * NEON SURVIVORS - Vampire Survivors style HTML5 Canvas Game + SQLite Auth/API
 * ========================================================================== */

const WEAPON_CATALOG = {
  wand: {
    id: "wand",
    name: "Магический Жезл",
    icon: "🪄",
    desc: "Выпускает самонаводящиеся неоновые заряды в ближайших врагов.",
    starter: true,
    maxLevel: 8,
  },
  blades: {
    id: "blades",
    name: "Орбитальные Клинки",
    icon: "💠",
    desc: "Вращающиеся вокруг героя энергетические лезвия, кромсающие толпу.",
    starter: true,
    maxLevel: 8,
  },
  slash: {
    id: "slash",
    name: "Клинок Пустоты",
    icon: "⚔️",
    desc: "Мощные дуговые взмахи перед героем с отбрасыванием врагов.",
    starter: true,
    maxLevel: 8,
  },
  lightning: {
    id: "lightning",
    name: "Цепная Молния",
    icon: "⚡",
    desc: "Бьёт разрядом с небес, перескакивая между несколькими целями.",
    starter: true,
    maxLevel: 8,
  },
  aura: {
    id: "aura",
    name: "Аура Искажения",
    icon: "🔮",
    desc: "Пульсирующее поле вокруг героя: наносит урон и замедляет врагов.",
    starter: false,
    maxLevel: 8,
  },
};

const PASSIVE_CATALOG = {
  might: {
    id: "might",
    name: "Ядро Мощи",
    icon: "🔥",
    desc: "+15% ко всему урону оружия за каждый уровень.",
    maxLevel: 5,
  },
  haste: {
    id: "haste",
    name: "Хроно-ускоритель",
    icon: "⏱️",
    desc: "+12% к скорости атаки всего оружия за уровень.",
    maxLevel: 5,
  },
  vitality: {
    id: "vitality",
    name: "Нано-Броня",
    icon: "🛡️",
    desc: "+25 к Макс. HP и регенерация +0.6 HP/сек за уровень.",
    maxLevel: 5,
  },
  agility: {
    id: "agility",
    name: "Турбо-привод",
    icon: "👟",
    desc: "+10% к скорости передвижения за уровень.",
    maxLevel: 5,
  },
  tractor: {
    id: "tractor",
    name: "Грави-магнит",
    icon: "🧲",
    desc: "+30% к радиусу притяжения кристаллов опыта и золота.",
    maxLevel: 5,
  },
};

function safeGetStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

function safeSetStorage(key, val) {
  try {
    if (val === null) localStorage.removeItem(key);
    else localStorage.setItem(key, val);
  } catch (_) {}
}

// ============================================================================
// ПРОЦЕДУРНЫЙ ЗВУКОВОЙ СИНТЕЗАТОР (Web Audio API)
// ============================================================================
class SoundFX {
  constructor() {
    this.ctx = null;
    this.muted = safeGetStorage("ns_muted") === "1";
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    safeSetStorage("ns_muted", this.muted ? "1" : "0");
    return this.muted;
  }

  tone(freq, type, duration, vol = 0.08, slideTo = null) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), now + duration);
    }
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  shoot() {
    this.tone(520, "triangle", 0.08, 0.05, 220);
  }
  slash() {
    this.tone(180, "sawtooth", 0.12, 0.06, 70);
  }
  zap() {
    this.tone(880, "square", 0.1, 0.04, 190);
  }
  gem() {
    this.tone(680 + Math.random() * 240, "sine", 0.07, 0.045, 980);
  }
  coin() {
    this.tone(980, "sine", 0.11, 0.06, 1320);
  }
  hurt() {
    this.tone(130, "sawtooth", 0.14, 0.08, 55);
  }
  levelUp() {
    if (this.muted) return;
    [440, 554, 659, 880].forEach((f, idx) => {
      setTimeout(() => this.tone(f, "triangle", 0.18, 0.08), idx * 75);
    });
  }
}

const sfx = new SoundFX();

// ============================================================================
// СОСТОЯНИЕ АВТОРИЗАЦИИ И ПРОФИЛЯ
// ============================================================================
const appState = {
  token: safeGetStorage("ns_token") || "",
  user: null,
  authMode: "login",
  selectedStarter: "wand",
  leaderboard: { top_runs: [], best_players: [] },
};

const LOCAL_UPGRADE_CONFIG = {
  max_hp: { max_level: 10, base_cost: 30, cost_mult: 1.5, name: "Живучесть (+20 HP)" },
  damage: { max_level: 10, base_cost: 40, cost_mult: 1.6, name: "Мощь (+10% урона)" },
  move_speed: { max_level: 8, base_cost: 35, cost_mult: 1.5, name: "Скорость (+6% бега)" },
  magnet: { max_level: 8, base_cost: 25, cost_mult: 1.45, name: "Магнит (+20% радиуса сбора)" },
  greed: { max_level: 8, base_cost: 45, cost_mult: 1.6, name: "Алчность (+15% золота)" },
};

let sqlJsDb = null;

async function getBrowserSqlite() {
  if (sqlJsDb) return sqlJsDb;
  if (typeof window.initSqlJs === "function") {
    try {
      const SQL = await window.initSqlJs({
        locateFile: (file) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}`,
      });
      const savedB64 = safeGetStorage("ns_sqlite_b64");
      if (savedB64) {
        const bin = Uint8Array.from(atob(savedB64), (c) => c.charCodeAt(0));
        sqlJsDb = new SQL.Database(bin);
      } else {
        sqlJsDb = new SQL.Database();
      }
      sqlJsDb.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          gold INTEGER NOT NULL DEFAULT 0,
          upgrades_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL
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
          created_at TEXT NOT NULL DEFAULT ''
        );
      `);
      saveBrowserSqlite();
      return sqlJsDb;
    } catch (e) {
      console.warn("sql.js fallback error:", e);
    }
  }
  return null;
}

function saveBrowserSqlite() {
  if (!sqlJsDb) return;
  try {
    const data = sqlJsDb.export();
    let binary = "";
    for (let i = 0; i < data.byteLength; i++) {
      binary += String.fromCharCode(data[i]);
    }
    safeSetStorage("ns_sqlite_b64", btoa(binary));
  } catch (_) {}
}

function queryRows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function buildBrowserUserProfile(db, userRow) {
  const defaultUpgrades = { max_hp: 0, move_speed: 0, damage: 0, magnet: 0, greed: 0 };
  let parsed = {};
  try {
    parsed = JSON.parse(userRow.upgrades_json || "{}");
  } catch (_) {}
  const upgrades = { ...defaultUpgrades, ...parsed };

  const stRows = queryRows(
    db,
    `SELECT COUNT(*) AS total_runs, COALESCE(MAX(score),0) AS best_score,
            COALESCE(MAX(survival_time),0) AS best_time, COALESCE(MAX(kills),0) AS best_kills,
            COALESCE(SUM(kills),0) AS total_kills
     FROM runs WHERE user_id = ?`,
    [userRow.id]
  );
  const recentRuns = queryRows(
    db,
    `SELECT id, weapon, score, survival_time, kills, level_reached, gold_earned, created_at
     FROM runs WHERE user_id = ? ORDER BY id DESC LIMIT 10`,
    [userRow.id]
  );
  return {
    id: userRow.id,
    username: userRow.username,
    gold: userRow.gold,
    upgrades,
    upgrade_Config: LOCAL_UPGRADE_CONFIG,
    stats: stRows[0] || { total_runs: 0, best_score: 0, best_time: 0, best_kills: 0, total_kills: 0 },
    recent_runs: recentRuns,
  };
}

function handlePureLocalDbApi(path, method, body) {
  const raw = safeGetStorage("ns_pure_db");
  const store = raw ? JSON.parse(raw) : { users: [], sessions: {}, runs: [] };
  const save = () => safeSetStorage("ns_pure_db", JSON.stringify(store));
  const defaultUpgrades = { max_hp: 0, move_speed: 0, damage: 0, magnet: 0, greed: 0 };

  const buildProfile = (u) => {
    const myRuns = store.runs.filter((r) => r.user_id === u.id).slice().reverse();
    return {
      id: u.id,
      username: u.username,
      gold: u.gold || 0,
      upgrades: { ...defaultUpgrades, ...(u.upgrades || {}) },
      upgrade_Config: LOCAL_UPGRADE_CONFIG,
      stats: {
        total_runs: myRuns.length,
        best_score: myRuns.reduce((m, r) => Math.max(m, r.score), 0),
        best_time: myRuns.reduce((m, r) => Math.max(m, r.survival_time), 0),
        best_kills: myRuns.reduce((m, r) => Math.max(m, r.kills), 0),
        total_kills: myRuns.reduce((s, r) => s + r.kills, 0),
      },
      recent_runs: myRuns.slice(0, 10),
    };
  };

  const getAuthUser = () => {
    const uid = store.sessions[appState.token];
    return store.users.find((x) => x.id === uid) || null;
  };

  if (path === "/api/me") {
    const u = getAuthUser();
    if (!u) throw new Error("Не авторизован");
    return { user: buildProfile(u) };
  }
  if (path === "/api/leaderboard") {
    const topRuns = store.runs
      .slice()
      .sort((a, b) => b.score - a.score || b.survival_time - a.survival_time)
      .slice(0, 15);
    return { top_runs: topRuns, best_players: [] };
  }
  if (path === "/api/register") {
    const username = String((body && body.username) || "").trim();
    const password = String((body && body.password) || "");
    if (username.length < 3) throw new Error("Логин должен быть от 3 символов");
    if (password.length < 4) throw new Error("Пароль должен быть от 4 символов");
    if (store.users.some((x) => x.username.toLowerCase() === username.toLowerCase())) {
      throw new Error("Пользователь уже существует");
    }
    const u = { id: store.users.length + 1, username, password, gold: 0, upgrades: { ...defaultUpgrades } };
    store.users.push(u);
    const token = "tok_" + Math.random().toString(36).slice(2);
    store.sessions[token] = u.id;
    save();
    return { token, user: buildProfile(u) };
  }
  if (path === "/api/login") {
    const username = String((body && body.username) || "").trim();
    const password = String((body && body.password) || "");
    const u = store.users.find((x) => x.username.toLowerCase() === username.toLowerCase() && x.password === password);
    if (!u) throw new Error("Неверный логин или пароль");
    const token = "tok_" + Math.random().toString(36).slice(2);
    store.sessions[token] = u.id;
    save();
    return { token, user: buildProfile(u) };
  }
  if (path === "/api/logout") {
    delete store.sessions[appState.token];
    save();
    return { ok: true };
  }
  if (path === "/api/upgrade") {
    const u = getAuthUser();
    if (!u) throw new Error("Не авторизован");
    const key = body && body.upgrade;
    const cfg = LOCAL_UPGRADE_CONFIG[key];
    const lvl = (u.upgrades && u.upgrades[key]) || 0;
    const cost = Math.round(cfg.base_cost * Math.pow(cfg.cost_mult, lvl));
    if (u.gold < cost) throw new Error("Недостаточно золота");
    u.gold -= cost;
    u.upgrades = u.upgrades || {};
    u.upgrades[key] = lvl + 1;
    save();
    return { user: buildProfile(u) };
  }
  if (path === "/api/runs") {
    const u = getAuthUser();
    if (!u) throw new Error("Не авторизован");
    const survival_time = Math.max(0, Number((body && body.survival_time) || 0));
    const kills = Math.max(0, Number((body && body.kills) || 0));
    const level_reached = Math.max(1, Number((body && body.level_reached) || 1));
    const gold_earned = Math.max(0, Number((body && body.gold_earned) || 0));
    const score = kills * 10 + survival_time * 5 + level_reached * 50 + gold_earned * 2;
    store.runs.push({
      id: store.runs.length + 1,
      user_id: u.id,
      username: u.username,
      weapon: String((body && body.weapon) || "wand"),
      score,
      survival_time,
      kills,
      level_reached,
      gold_earned,
    });
    u.gold = (u.gold || 0) + gold_earned;
    save();
    return { score, user: buildProfile(u) };
  }
  throw new Error("Маршрут не найден");
}

async function handleBrowserSqliteApi(path, method, body) {
  const db = await getBrowserSqlite();
  if (!db) {
    return handlePureLocalDbApi(path, method, body);
  }

  const getAuthUser = () => {
    if (!appState.token) return null;
    const rows = queryRows(
      db,
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
      [appState.token]
    );
    return rows[0] || null;
  };

  if (path === "/api/me" && method === "GET") {
    const u = getAuthUser();
    if (!u) throw new Error("Не авторизован");
    return { user: buildBrowserUserProfile(db, u) };
  }

  if (path === "/api/leaderboard" && method === "GET") {
    const topRuns = queryRows(
      db,
      `SELECT id, username, weapon, score, survival_time, kills, level_reached, gold_earned
       FROM runs ORDER BY score DESC, survival_time DESC LIMIT 15`
    );
    return { top_runs: topRuns, best_players: [] };
  }

  if (path === "/api/register" && method === "POST") {
    const username = String((body && body.username) || "").trim();
    const password = String((body && body.password) || "");
    if (username.length < 3 || username.length > 20) {
      throw new Error("Логин должен быть от 3 до 20 символов");
    }
    if (password.length < 4) {
      throw new Error("Пароль должен быть не менее 4 символов");
    }
    const existing = queryRows(db, `SELECT id FROM users WHERE username = ?`, [username]);
    if (existing.length > 0) {
      throw new Error("Пользователь с таким логином уже существует");
    }
    db.run(`INSERT INTO users (username, password_hash, gold, upgrades_json) VALUES (?, ?, 0, '{}')`, [
      username,
      btoa(unescape(encodeURIComponent(password))),
    ]);
    const userRow = queryRows(db, `SELECT * FROM users WHERE username = ?`, [username])[0];
    const token = "tok_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    db.run(`INSERT INTO sessions (token, user_id) VALUES (?, ?)`, [token, userRow.id]);
    saveBrowserSqlite();
    return { token, user: buildBrowserUserProfile(db, userRow) };
  }

  if (path === "/api/login" && method === "POST") {
    const username = String((body && body.username) || "").trim();
    const password = String((body && body.password) || "");
    const rows = queryRows(db, `SELECT * FROM users WHERE username = ?`, [username]);
    const userRow = rows[0];
    const pwHash = btoa(unescape(encodeURIComponent(password)));
    if (!userRow || userRow.password_hash !== pwHash) {
      throw new Error("Неверный логин или пароль");
    }
    const token = "tok_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    db.run(`INSERT INTO sessions (token, user_id) VALUES (?, ?)`, [token, userRow.id]);
    saveBrowserSqlite();
    return { token, user: buildBrowserUserProfile(db, userRow) };
  }

  if (path === "/api/logout" && method === "POST") {
    if (appState.token) {
      db.run(`DELETE FROM sessions WHERE token = ?`, [appState.token]);
      saveBrowserSqlite();
    }
    return { ok: true };
  }

  if (path === "/api/upgrade" && method === "POST") {
    const u = getAuthUser();
    if (!u) throw new Error("Не авторизован");
    const key = body && body.upgrade;
    const cfg = LOCAL_UPGRADE_CONFIG[key];
    if (!cfg) throw new Error("Неизвестное улучшение");
    const profile = buildBrowserUserProfile(db, u);
    const curLvl = profile.upgrades[key] || 0;
    if (curLvl >= cfg.max_level) throw new Error("Максимальный уровень уже достигнут");
    const cost = Math.round(cfg.base_cost * Math.pow(cfg.cost_mult, curLvl));
    if (u.gold < cost) throw new Error(`Недостаточно золота (нужно ${cost})`);
    profile.upgrades[key] = curLvl + 1;
    db.run(`UPDATE users SET gold = ?, upgrades_json = ? WHERE id = ?`, [
      u.gold - cost,
      JSON.stringify(profile.upgrades),
      u.id,
    ]);
    saveBrowserSqlite();
    const updated = queryRows(db, `SELECT * FROM users WHERE id = ?`, [u.id])[0];
    return { user: buildBrowserUserProfile(db, updated) };
  }

  if (path === "/api/runs" && method === "POST") {
    const u = getAuthUser();
    if (!u) throw new Error("Не авторизован");
    const weapon = String((body && body.weapon) || "wand");
    const survival_time = Math.max(0, Number((body && body.survival_time) || 0));
    const kills = Math.max(0, Number((body && body.kills) || 0));
    const level_reached = Math.max(1, Number((body && body.level_reached) || 1));
    const gold_earned = Math.max(0, Number((body && body.gold_earned) || 0));
    const score = kills * 10 + survival_time * 5 + level_reached * 50 + gold_earned * 2;
    db.run(
      `INSERT INTO runs (user_id, username, weapon, score, survival_time, kills, level_reached, gold_earned, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [u.id, u.username, weapon, score, survival_time, kills, level_reached, gold_earned, new Date().toISOString()]
    );
    db.run(`UPDATE users SET gold = gold + ? WHERE id = ?`, [gold_earned, u.id]);
    saveBrowserSqlite();
    const updated = queryRows(db, `SELECT * FROM users WHERE id = ?`, [u.id])[0];
    return { score, user: buildBrowserUserProfile(db, updated) };
  }

  throw new Error("Маршрут не найден");
}

async function apiRequest(path, method = "GET", body = null) {
  if (window.location.hostname.endsWith("github.io")) {
    return handleBrowserSqliteApi(path, method, body);
  }
  const headers = { "Content-Type": "application/json" };
  if (appState.token) {
    headers["Authorization"] = `Bearer ${appState.token}`;
  }
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  let res;
  try {
    res = await fetch(path, opts);
  } catch (_) {
    return handleBrowserSqliteApi(path, method, body);
  }
  if (res.status === 404 || res.status === 405) {
    return handleBrowserSqliteApi(path, method, body);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Ошибка запроса (${res.status})`);
  }
  return data;
}

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

// ============================================================================
// УПРАВЛЕНИЕ ЭКРАНАМИ И МЕНЮ
// ============================================================================
const authScreen = document.getElementById("authScreen");
const menuScreen = document.getElementById("menuScreen");
const hudEl = document.getElementById("hud");
const levelUpModal = document.getElementById("levelUpModal");
const pauseModal = document.getElementById("pauseModal");
const gameOverModal = document.getElementById("gameOverModal");

function updateSoundButtons() {
  const icon = sfx.muted ? "🔇" : "🔊";
  document.getElementById("btnMuteHud").textContent = icon;
  document.getElementById("btnMuteMenu").textContent = `${icon} Звук`;
}

function showScreen(name) {
  authScreen.classList.toggle("hidden", name !== "auth");
  menuScreen.classList.toggle("hidden", name !== "menu");
  hudEl.classList.toggle("hidden", name !== "game");
}

function renderStarterWeapons() {
  const grid = document.getElementById("starterWeaponsGrid");
  grid.innerHTML = "";
  Object.values(WEAPON_CATALOG)
    .filter((w) => w.starter)
    .forEach((w) => {
      const card = document.createElement("div");
      card.className = `starter-card ${appState.selectedStarter === w.id ? "selected" : ""}`;
      card.innerHTML = `
        <div class="starter-card-head"><span>${w.icon}</span> <span>${w.name}</span></div>
        <div class="starter-card-desc">${w.desc}</div>
      `;
      card.addEventListener("click", () => {
        appState.selectedStarter = w.id;
        renderStarterWeapons();
      });
      grid.appendChild(card);
    });
}

function calcUpgradeCost(cfg, level) {
  return Math.round(cfg.base_cost * Math.pow(cfg.cost_mult, level));
}

function renderShop() {
  const list = document.getElementById("shopList");
  list.innerHTML = "";
  if (!appState.user) return;
  const upgrades = appState.user.upgrades || {};
  const configs = appState.user.upgrade_Config || {};

  Object.keys(configs).forEach((key) => {
    const cfg = configs[key];
    const lvl = upgrades[key] || 0;
    const isMax = lvl >= cfg.max_level;
    const cost = calcUpgradeCost(cfg, lvl);
    const canAfford = appState.user.gold >= cost && !isMax;

    let pipsHtml = "";
    for (let i = 0; i < cfg.max_level; i++) {
      pipsHtml += `<span class="pip ${i < lvl ? "filled" : ""}"></span>`;
    }

    const row = document.createElement("div");
    row.className = "shop-item";
    row.innerHTML = `
      <div class="shop-info">
        <div class="shop-title">${cfg.name} <small style="color:#94a3b8">(Ур. ${lvl}/${cfg.max_level})</small></div>
        <div class="shop-pips">${pipsHtml}</div>
      </div>
      <button class="shop-buy-btn" ${canAfford ? "" : "disabled"}>
        ${isMax ? "МАКС" : `🪙 ${cost}`}
      </button>
    `;
    const btn = row.querySelector("button");
    if (!isMax) {
      btn.addEventListener("click", async () => {
        try {
          const res = await apiRequest("/api/upgrade", "POST", { upgrade: key });
          appState.user = res.user;
          sfx.coin();
          renderMenuProfile();
        } catch (err) {
          alert(err.message);
        }
      });
    }
    list.appendChild(row);
  });
}

function renderLeaderboardAndHistory() {
  const lbBox = document.getElementById("leaderboardContainer");
  const histBox = document.getElementById("historyContainer");
  const myName = appState.user ? appState.user.username.toLowerCase() : "";

  const runs = appState.leaderboard.top_runs || [];
  if (runs.length === 0) {
    lbBox.innerHTML = `<p style="color:#94a3b8;font-size:0.88rem;padding:12px 0;">Пока нет записанных забегов. Стань первым в таблице лидеров!</p>`;
  } else {
    lbBox.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Игрок</th>
            <th>Очки</th>
            <th>Время</th>
            <th>💀</th>
          </tr>
        </thead>
        <tbody>
          ${runs
            .map(
              (r, idx) => `
            <tr class="${r.username.toLowerCase() === myName ? "me-row" : ""}">
              <td>${idx + 1}</td>
              <td><b>${escapeHtml(r.username)}</b></td>
              <td style="color:#00f2fe;font-weight:700">${r.score}</td>
              <td>${formatTime(r.survival_time)}</td>
              <td>${r.kills}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  const myRuns = (appState.user && appState.user.recent_runs) || [];
  if (myRuns.length === 0) {
    histBox.innerHTML = `<p style="color:#94a3b8;font-size:0.88rem;padding:12px 0;">У вас пока нет завершённых забегов.</p>`;
  } else {
    histBox.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Очки</th>
            <th>Время</th>
            <th>Ур.</th>
            <th>💀</th>
            <th>🪙</th>
          </tr>
        </thead>
        <tbody>
          ${myRuns
            .map(
              (r) => `
            <tr>
              <td style="color:#00f2fe;font-weight:700">${r.score}</td>
              <td>${formatTime(r.survival_time)}</td>
              <td>${r.level_reached}</td>
              <td>${r.kills}</td>
              <td style="color:#ffd166">+${r.gold_earned}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    `;
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m]));
}

async function refreshLeaderboard() {
  try {
    appState.leaderboard = await apiRequest("/api/leaderboard");
    renderLeaderboardAndHistory();
  } catch (e) {
    console.error(e);
  }
}

function renderMenuProfile() {
  if (!appState.user) return;
  document.getElementById("menuUsername").textContent = appState.user.username;
  document.getElementById("menuGold").textContent = appState.user.gold;
  const st = appState.user.stats || {};
  document.getElementById("statBestScore").textContent = st.best_score || 0;
  document.getElementById("statBestTime").textContent = formatTime(st.best_time || 0);
  document.getElementById("statTotalKills").textContent = st.total_kills || 0;
  document.getElementById("statTotalRuns").textContent = st.total_runs || 0;

  renderStarterWeapons();
  renderShop();
  renderLeaderboardAndHistory();
}

// ============================================================================
// ИГРОВОЙ ДВИЖОК (CANVAS 2D)
// ============================================================================
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

const input = {
  keys: {},
  mouseDown: false,
  mouseX: 0,
  mouseY: 0,
};

window.addEventListener("keydown", (e) => {
  input.keys[e.code] = true;
  if ((e.code === "Escape" || e.code === "KeyP") && game.running && !game.over && !game.choosingUpgrade) {
    togglePause();
  }
});

window.addEventListener("keyup", (e) => {
  input.keys[e.code] = false;
});

canvas.addEventListener("mousedown", (e) => {
  if (e.button === 0) {
    input.mouseDown = true;
    input.mouseX = e.clientX;
    input.mouseY = e.clientY;
  }
});

window.addEventListener("mousemove", (e) => {
  input.mouseX = e.clientX;
  input.mouseY = e.clientY;
});

window.addEventListener("mouseup", () => {
  input.mouseDown = false;
});

canvas.addEventListener(
  "touchstart",
  (e) => {
    if (e.touches.length > 0) {
      input.mouseDown = true;
      input.mouseX = e.touches[0].clientX;
      input.mouseY = e.touches[0].clientY;
    }
  },
  { passive: true }
);

canvas.addEventListener(
  "touchmove",
  (e) => {
    if (e.touches.length > 0) {
      input.mouseX = e.touches[0].clientX;
      input.mouseY = e.touches[0].clientY;
    }
  },
  { passive: true }
);

window.addEventListener("touchend", () => {
  input.mouseDown = false;
});

// Глобальный объект текущей игровой сессии
const game = {
  running: false,
  paused: false,
  choosingUpgrade: false,
  over: false,
  time: 0,
  kills: 0,
  gold: 0,
  score: 0,
  starterWeapon: "wand",
  shakeTime: 0,
  shakeMag: 0,
  spawnTimer: 0,
  bossTimer: 60,
  activeBoss: null,
  player: null,
  enemies: [],
  projectiles: [],
  enemyProjectiles: [],
  gems: [],
  particles: [],
  floatingTexts: [],
  slashes: [],
  lightningArcs: [],
  props: [],
};

function createPlayer(starterWeapon) {
  const meta = (appState.user && appState.user.upgrades) || {};
  const bonusHp = (meta.max_hp || 0) * 20;
  const baseMaxHp = 100 + bonusHp;

  return {
    x: 0,
    y: 0,
    radius: 16,
    hp: baseMaxHp,
    maxHp: baseMaxHp,
    regen: 0.15,
    baseSpeed: 215 * (1 + (meta.move_speed || 0) * 0.06),
    metaDamageMult: 1 + (meta.damage || 0) * 0.1,
    metaMagnetMult: 1 + (meta.magnet || 0) * 0.2,
    metaGreedMult: 1 + (meta.greed || 0) * 0.15,
    facingX: 1,
    facingY: 0,
    invulnTimer: 0,
    level: 1,
    xp: 0,
    xpToNext: 10,
    weapons: { [starterWeapon]: 1 },
    passives: {},
    cooldowns: {
      wand: 0,
      slash: 0,
      lightning: 0,
      aura: 0,
    },
    bladeAngle: 0,
    auraPulse: 0,
  };
}

function getPlayerStats(p) {
  const mightLvl = p.passives.might || 0;
  const hasteLvl = p.passives.haste || 0;
  const agilityLvl = p.passives.agility || 0;
  const tractorLvl = p.passives.tractor || 0;
  const vitalityLvl = p.passives.vitality || 0;

  return {
    damageMult: p.metaDamageMult * (1 + mightLvl * 0.15),
    cooldownMult: Math.pow(0.89, hasteLvl),
    moveSpeed: p.baseSpeed * (1 + agilityLvl * 0.1),
    pickupRadius: 85 * p.metaMagnetMult * (1 + tractorLvl * 0.3),
    regenRate: p.regen + vitalityLvl * 0.6,
  };
}

function startNewRun() {
  sfx.init();
  game.running = true;
  game.paused = false;
  game.choosingUpgrade = false;
  game.over = false;
  game.time = 0;
  game.kills = 0;
  game.gold = 0;
  game.score = 0;
  game.starterWeapon = appState.selectedStarter || "wand";
  game.shakeTime = 0;
  game.spawnTimer = 0.5;
  game.bossTimer = 45; // Первый босс на 00:45
  game.activeBoss = null;

  game.player = createPlayer(game.starterWeapon);
  game.enemies = [];
  game.projectiles = [];
  game.enemyProjectiles = [];
  game.gems = [];
  game.particles = [];
  game.floatingTexts = [];
  game.slashes = [];
  game.lightningArcs = [];

  // Декоративные энергетические пилоны на арене
  game.props = [];
  for (let i = 0; i < 60; i++) {
    game.props.push({
      x: (Math.random() - 0.5) * 4000,
      y: (Math.random() - 0.5) * 4000,
      size: 14 + Math.random() * 18,
      hue: Math.random() < 0.5 ? 190 : 280,
    });
  }

  levelUpModal.classList.add("hidden");
  pauseModal.classList.add("hidden");
  gameOverModal.classList.add("hidden");
  showScreen("game");
  updateHud();
}

function togglePause() {
  if (!game.running || game.over || game.choosingUpgrade) return;
  game.paused = !game.paused;
  pauseModal.classList.toggle("hidden", !game.paused);
}

// ============================================================================
// СПАВН ВРАГОВ И БОССОВ
// ============================================================================
function spawnEnemyAroundPlayer(type, customAngle = null, customDist = null) {
  const p = game.player;
  const angle = customAngle !== null ? customAngle : Math.random() * Math.PI * 2;
  const diag = Math.hypot(canvas.width, canvas.height) * 0.55;
  const dist = customDist !== null ? customDist : Math.max(460, diag + 60 + Math.random() * 120);
  const x = p.x + Math.cos(angle) * dist;
  const y = p.y + Math.sin(angle) * dist;

  const tScale = 1 + game.time / 55; // Рост сложности со временем

  const templates = {
    swarmer: {
      type: "swarmer",
      radius: 11,
      hp: Math.round(14 * tScale),
      speed: 145 + Math.min(60, game.time * 0.25),
      damage: Math.round(7 * Math.pow(tScale, 0.5)),
      xp: 2,
      color: "#d946ef",
      shape: "diamond",
    },
    ghoul: {
      type: "ghoul",
      radius: 15,
      hp: Math.round(28 * tScale),
      speed: 105 + Math.min(45, game.time * 0.2),
      damage: Math.round(11 * Math.pow(tScale, 0.55)),
      xp: 3,
      color: "#ef4444",
      shape: "circle",
    },
    brute: {
      type: "brute",
      radius: 23,
      hp: Math.round(90 * tScale),
      speed: 74 + Math.min(30, game.time * 0.12),
      damage: Math.round(18 * Math.pow(tScale, 0.6)),
      xp: 10,
      color: "#f97316",
      shape: "hex",
    },
    phantom: {
      type: "phantom",
      radius: 15,
      hp: Math.round(38 * tScale),
      speed: 92,
      damage: Math.round(12 * Math.pow(tScale, 0.55)),
      xp: 6,
      color: "#38bdf8",
      shape: "triangle",
      shootTimer: 2.2 + Math.random(),
    },
    boss: {
      type: "boss",
      name: game.time < 90 ? "АРХОНТ ПУСТОТЫ" : "ТИТАН РОЯ",
      radius: 36,
      hp: Math.round(620 * Math.pow(tScale, 1.15)),
      speed: 88,
      damage: Math.round(26 * Math.pow(tScale, 0.6)),
      xp: 65,
      color: "#ff2a85",
      shape: "boss",
      isBoss: true,
      shootTimer: 1.8,
    },
  };

  const tpl = templates[type] || templates.ghoul;
  const enemy = {
    x,
    y,
    vx: 0,
    vy: 0,
    maxHp: tpl.hp,
    hp: tpl.hp,
    radius: tpl.radius,
    speed: tpl.speed,
    damage: tpl.damage,
    xp: tpl.xp,
    color: tpl.color,
    shape: tpl.shape,
    type: tpl.type,
    name: tpl.name || "",
    isBoss: !!tpl.isBoss,
    shootTimer: tpl.shootTimer || 0,
    hitFlash: 0,
    slowTimer: 0,
    bladeHitCd: 0,
  };

  game.enemies.push(enemy);
  if (enemy.isBoss) {
    game.activeBoss = enemy;
    addFloatingText(p.x, p.y - 60, `⚠ БОСС: ${enemy.name}!`, "#ff2a85", 22);
    game.shakeTime = 0.35;
    game.shakeMag = 7;
  }
}

function updateWaveDirector(dt) {
  game.spawnTimer -= dt;
  const waveNum = Math.floor(game.time / 30) + 1;

  if (game.spawnTimer <= 0) {
    // Частота и размер группы растут со временем
    const interval = Math.max(0.28, 1.35 - game.time * 0.005);
    game.spawnTimer = interval;

    const count = 1 + Math.floor(game.time / 38);
    for (let i = 0; i < count; i++) {
      const r = Math.random();
      let type = "ghoul";
      if (r < 0.38) type = "swarmer";
      else if (game.time > 20 && r > 0.78) type = "brute";
      else if (game.time > 35 && r > 0.64 && r <= 0.78) type = "phantom";
      spawnEnemyAroundPlayer(type);
    }

    // Периодическое кольцо роевиков
    if (Math.random() < 0.06 && game.enemies.length < 180) {
      const ringCount = 10 + Math.min(14, waveNum * 2);
      for (let j = 0; j < ringCount; j++) {
        const a = (Math.PI * 2 * j) / ringCount;
        spawnEnemyAroundPlayer("swarmer", a, 520);
      }
    }
  }

  game.bossTimer -= dt;
  if (game.bossTimer <= 0) {
    game.bossTimer = 60;
    spawnEnemyAroundPlayer("boss");
  }
}

// ============================================================================
// ОРУЖИЕ И БОЕВАЯ СИСТЕМА
// ============================================================================
function findNearestEnemy(x, y, maxDist = 900, excludeSet = null) {
  let best = null;
  let bestDistSq = maxDist * maxDist;
  for (const e of game.enemies) {
    if (excludeSet && excludeSet.has(e)) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDistSq) {
      bestDistSq = d2;
      best = e;
    }
  }
  return best;
}

function updateWeapons(dt) {
  const p = game.player;
  const stats = getPlayerStats(p);

  // 1. МАГИЧЕСКИЙ ЖЕЗЛ (wand)
  if (p.weapons.wand) {
    const lvl = p.weapons.wand;
    p.cooldowns.wand -= dt;
    if (p.cooldowns.wand <= 0) {
      const baseCd = Math.max(0.28, 0.88 - lvl * 0.065) * stats.cooldownMult;
      p.cooldowns.wand = baseCd;

      const count = 1 + Math.floor(lvl / 2);
      const dmg = Math.round((18 + lvl * 8) * stats.damageMult);
      const pierce = 1 + Math.floor(lvl / 3);

      const used = new Set();
      let fired = false;
      for (let i = 0; i < count; i++) {
        let target = findNearestEnemy(p.x, p.y, 750, used);
        if (!target) target = findNearestEnemy(p.x, p.y, 750);
        if (!target) break;
        used.add(target);

        const baseAngle = Math.atan2(target.y - p.y, target.x - p.x);
        const spread = count > 1 && used.size === 1 ? (i - (count - 1) / 2) * 0.14 : 0;
        const angle = baseAngle + spread;
        game.projectiles.push({
          x: p.x,
          y: p.y,
          vx: Math.cos(angle) * 520,
          vy: Math.sin(angle) * 520,
          radius: 6,
          damage: dmg,
          pierce,
          life: 1.5,
          color: "#00f2fe",
          hitSet: new Set(),
        });
        fired = true;
      }
      if (fired) sfx.shoot();
    }
  }

  // 2. ОРБИТАЛЬНЫЕ КЛИНКИ (blades)
  if (p.weapons.blades) {
    const lvl = p.weapons.blades;
    const count = Math.min(7, 1 + lvl);
    const rotSpeed = (2.7 + lvl * 0.25) / stats.cooldownMult;
    const orbitRadius = 72 + lvl * 6;
    const bladeRadius = 13 + lvl * 1.2;
    const dmg = Math.round((14 + lvl * 6) * stats.damageMult);

    p.bladeAngle += rotSpeed * dt;

    for (let i = 0; i < count; i++) {
      const a = p.bladeAngle + (Math.PI * 2 * i) / count;
      const bx = p.x + Math.cos(a) * orbitRadius;
      const by = p.y + Math.sin(a) * orbitRadius;

      for (const e of game.enemies) {
        if (e.bladeHitCd > 0) continue;
        const dist = Math.hypot(e.x - bx, e.y - by);
        if (dist < e.radius + bladeRadius) {
          damageEnemy(e, dmg, bx, by, 90);
          e.bladeHitCd = 0.22;
        }
      }
    }
  }

  // 3. КЛИНОК ПУСТОТЫ (slash)
  if (p.weapons.slash) {
    const lvl = p.weapons.slash;
    p.cooldowns.slash -= dt;
    if (p.cooldowns.slash <= 0) {
      p.cooldowns.slash = Math.max(0.45, 1.25 - lvl * 0.08) * stats.cooldownMult;
      const dmg = Math.round((28 + lvl * 12) * stats.damageMult);
      const range = 115 + lvl * 12;
      const baseAngle = Math.atan2(p.facingY, p.facingX);
      const directions = lvl >= 3 ? [baseAngle, baseAngle + Math.PI] : [baseAngle];

      directions.forEach((dirAngle) => {
        game.slashes.push({
          x: p.x,
          y: p.y,
          angle: dirAngle,
          range,
          life: 0.2,
          maxLife: 0.2,
        });

        for (const e of game.enemies) {
          const dx = e.x - p.x;
          const dy = e.y - p.y;
          const dist = Math.hypot(dx, dy);
          if (dist <= range + e.radius) {
            const angleToEnemy = Math.atan2(dy, dx);
            const diff = Math.abs(Math.atan2(Math.sin(angleToEnemy - dirAngle), Math.cos(angleToEnemy - dirAngle)));
            if (diff <= 1.05) {
              damageEnemy(e, dmg, p.x, p.y, 240);
            }
          }
        }
      });
      sfx.slash();
    }
  }

  // 4. ЦЕПНАЯ МОЛНИЯ (lightning)
  if (p.weapons.lightning) {
    const lvl = p.weapons.lightning;
    p.cooldowns.lightning -= dt;
    if (p.cooldowns.lightning <= 0 && game.enemies.length > 0) {
      p.cooldowns.lightning = Math.max(0.55, 1.65 - lvl * 0.11) * stats.cooldownMult;
      const chains = 2 + Math.floor(lvl * 0.8);
      const dmg = Math.round((24 + lvl * 11) * stats.damageMult);

      const hitSet = new Set();
      let currX = p.x;
      let currY = p.y;
      const points = [{ x: p.x, y: p.y }];

      for (let c = 0; c < chains; c++) {
        const target = findNearestEnemy(currX, currY, c === 0 ? 460 : 260, hitSet);
        if (!target) break;
        hitSet.add(target);
        points.push({ x: target.x, y: target.y });
        damageEnemy(target, dmg, currX, currY, 60);
        currX = target.x;
        currY = target.y;
      }

      if (points.length > 1) {
        game.lightningArcs.push({ points, life: 0.18, maxLife: 0.18 });
        sfx.zap();
      }
    }
  }

  // 5. АУРА ИСКАЖЕНИЯ (aura)
  if (p.weapons.aura) {
    const lvl = p.weapons.aura;
    const auraRadius = 88 + lvl * 14;
    p.auraPulse += dt * 4;
    p.cooldowns.aura -= dt;
    if (p.cooldowns.aura <= 0) {
      p.cooldowns.aura = Math.max(0.25, 0.52 - lvl * 0.025) * stats.cooldownMult;
      const dmg = Math.round((9 + lvl * 4.5) * stats.damageMult);
      for (const e of game.enemies) {
        const dist = Math.hypot(e.x - p.x, e.y - p.y);
        if (dist <= auraRadius + e.radius) {
          damageEnemy(e, dmg, p.x, p.y, 35);
          e.slowTimer = 0.6;
        }
      }
    }
  }
}

function damageEnemy(enemy, amount, srcX, srcY, knockback = 80) {
  const isCrit = Math.random() < 0.12;
  const finalDmg = isCrit ? Math.round(amount * 1.6) : amount;
  enemy.hp -= finalDmg;
  enemy.hitFlash = 0.1;

  const angle = Math.atan2(enemy.y - srcY, enemy.x - srcX);
  const kbFactor = enemy.isBoss ? 0.15 : 1;
  enemy.x += Math.cos(angle) * knockback * 0.08 * kbFactor;
  enemy.y += Math.sin(angle) * knockback * 0.08 * kbFactor;

  addFloatingText(
    enemy.x + (Math.random() - 0.5) * 14,
    enemy.y - enemy.radius - 6,
    isCrit ? `${finalDmg}!` : `${finalDmg}`,
    isCrit ? "#ffd166" : "#ffffff",
    isCrit ? 16 : 13
  );
}

function spawnParticles(x, y, color, count = 8) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 40 + Math.random() * 160;
    game.particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      size: 2.5 + Math.random() * 3.5,
      color,
      life: 0.25 + Math.random() * 0.25,
      maxLife: 0.5,
    });
  }
}

function addFloatingText(x, y, text, color = "#fff", size = 14) {
  if (game.floatingTexts.length > 60) game.floatingTexts.shift();
  game.floatingTexts.push({
    x,
    y,
    text,
    color,
    size,
    life: 0.55,
    maxLife: 0.55,
  });
}

function handleEnemyDeath(e) {
  game.kills++;
  spawnParticles(e.x, e.y, e.color, e.isBoss ? 28 : 9);

  // Дроп кристалла опыта
  game.gems.push({
    x: e.x,
    y: e.y,
    kind: "xp",
    value: e.xp,
    magnetized: false,
  });

  // Шанс дропа монеты, аптечки или вакуум-магнита
  const roll = Math.random();
  if (e.isBoss) {
    const bossGold = Math.round(25 * game.player.metaGreedMult);
    game.gold += bossGold;
    addFloatingText(e.x, e.y - 20, `+${bossGold} 🪙 БОСС ПОВЕРЖЕН!`, "#ffd166", 18);
    game.gems.push({ x: e.x + 18, y: e.y, kind: "heal", value: 50, magnetized: false });
    game.gems.push({ x: e.x - 18, y: e.y, kind: "vacuum", value: 1, magnetized: false });
    if (game.activeBoss === e) game.activeBoss = null;
  } else if (roll < 0.14) {
    game.gems.push({
      x: e.x + 6,
      y: e.y + 6,
      kind: "gold",
      value: Math.max(1, Math.round((1 + Math.floor(game.time / 45)) * game.player.metaGreedMult)),
      magnetized: false,
    });
  } else if (roll > 0.988) {
    game.gems.push({ x: e.x, y: e.y, kind: "heal", value: 30, magnetized: false });
  } else if (roll > 0.982 && roll <= 0.988) {
    game.gems.push({ x: e.x, y: e.y, kind: "vacuum", value: 1, magnetized: false });
  }
}

// ============================================================================
// ПРОКАЧКА УРОВНЯ ВО ВРЕМЯ ЗАБЕГА + ВИКТОРИНА «ПРОВЕРКА НА УМНИ»
// ============================================================================
const QUIZ_QUESTIONS = [
  {
    q: "Какой SQL-оператор используется для выборки данных из таблицы?",
    a: "SELECT",
    w: ["INSERT", "UPDATE", "FETCH"],
  },
  {
    q: "Как расшифровывается СУБД?",
    a: "Система управления базами данных",
    w: ["Сервер удалённых баз данных", "Сеть универсальных блоков данных", "Служба упаковки больших данных"],
  },
  {
    q: "Что делает ограничение PRIMARY KEY в таблице SQLite?",
    a: "Уникально идентифицирует каждую запись в таблице",
    w: ["Шифрует пароли пользователей", "Сортирует таблицу по алфавиту", "Разрешает хранить только текст"],
  },
  {
    q: "Где SQLite хранит всю базу данных?",
    a: "В одном обычном файле на диске (или в памяти)",
    w: ["Только на облачном сервере Microsoft", "В реестре Windows", "В отдельных папках для каждой строки"],
  },
  {
    q: "Какая команда SQL добавляет новую строку в таблицу?",
    a: "INSERT INTO",
    w: ["ADD ROW", "APPEND TO", "CREATE ROW"],
  },
  {
    q: "Какая команда SQL удаляет строки из таблицы по условию?",
    a: "DELETE FROM",
    w: ["REMOVE", "DROP COLUMN", "ERASE"],
  },
  {
    q: "Какое ключевое слово SQL используется для фильтрации строк по условию?",
    a: "WHERE",
    w: ["FILTER", "WHEN", "SEARCH"],
  },
  {
    q: "Какой оператор SQL объединяет строки из двух таблиц по связующему полю?",
    a: "JOIN",
    w: ["MERGE", "LINK", "COMBINE"],
  },
  {
    q: "Чему равно 2 в 10-й степени (2¹⁰)?",
    a: "1024",
    w: ["512", "2048", "1000"],
  },
  {
    q: "Сколько бит в одном байте?",
    a: "8",
    w: ["16", "4", "10"],
  },
  {
    q: "Какой HTTP-код означает «Страница не найдена»?",
    a: "404",
    w: ["500", "200", "403"],
  },
  {
    q: "Какой HTTP-метод обычно используется для отправки данных формы (авторизации)?",
    a: "POST",
    w: ["GET", "HEAD", "OPTIONS"],
  },
  {
    q: "Какая сложность бинарного поиска в отсортированном массиве из N элементов?",
    a: "O(log N)",
    w: ["O(N²)", "O(N)", "O(1)"],
  },
  {
    q: "Какой тип данных в Python является неизменяемым (immutable)?",
    a: "tuple (кортеж)",
    w: ["list (список)", "dict (словарь)", "set (множество)"],
  },
  {
    q: "Какая функция SQL возвращает количество строк?",
    a: "COUNT(*)",
    w: ["SUM(*)", "TOTAL()", "LENGTH()"],
  },
  {
    q: "Какое ключевое слово SQL сортирует результаты по убыванию?",
    a: "ORDER BY ... DESC",
    w: ["SORT BY ... DOWN", "GROUP BY ... LOW", "ALIGN ... REVERSE"],
  },
  {
    q: "Что означает буква A в принципе ACID для транзакций БД?",
    a: "Atomicity (Атомарность)",
    w: ["Authorization (Авторизация)", "Availability (Доступность)", "Automation (Автоматизация)"],
  },
  {
    q: "Какой тег HTML5 используется для рисования 2D/3D графики через JS?",
    a: "<canvas>",
    w: ["<paint>", "<render>", "<screen>"],
  },
  {
    q: "Чему равен квадратный корень из 144?",
    a: "12",
    w: ["14", "11", "16"],
  },
  {
    q: "Какой протокол работает поверх TCP и шифрует веб-трафик с помощью TLS?",
    a: "HTTPS",
    w: ["FTP", "UDP", "ARP"],
  },
  {
    q: "Как называется внешний ключ для связи таблиц в реляционной БД?",
    a: "FOREIGN KEY",
    w: ["OUTER KEY", "REMOTE KEY", "SECOND KEY"],
  },
  {
    q: "Что выведет выражение Python: len('SQLite')?",
    a: "6",
    w: ["5", "7", "0"],
  },
  {
    q: "Какая структура данных работает по принципу LIFO (последним пришёл — первым ушёл)?",
    a: "Стек (Stack)",
    w: ["Очередь (Queue)", "Хеш-таблица", "Дерево"],
  },
  {
    q: "Чему равно 7 × 8?",
    a: "56",
    w: ["54", "48", "64"],
  },
];

let usedQuizIndices = new Set();

function pickQuizQuestion() {
  if (usedQuizIndices.size >= QUIZ_QUESTIONS.length) {
    usedQuizIndices.clear();
  }
  const available = [];
  for (let i = 0; i < QUIZ_QUESTIONS.length; i++) {
    if (!usedQuizIndices.has(i)) available.push(i);
  }
  const idx = available[Math.floor(Math.random() * available.length)];
  usedQuizIndices.add(idx);
  const item = QUIZ_QUESTIONS[idx];

  const options = [
    { text: item.a, correct: true },
    ...item.w.map((txt) => ({ text: txt, correct: false })),
  ];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { question: item.q, options };
}

function gainXp(amount) {
  const p = game.player;
  p.xp += amount;
  sfx.gem();
  if (p.xp >= p.xpToNext && !game.choosingUpgrade) {
    p.xp -= p.xpToNext;
    p.level++;
    p.xpToNext = Math.round(10 + p.level * 8 + Math.pow(p.level, 1.35));
    openLevelUpModal();
  }
}

function buildUpgradePool() {
  const p = game.player;
  const pool = [];

  Object.values(WEAPON_CATALOG).forEach((w) => {
    const cur = p.weapons[w.id] || 0;
    if (cur < w.maxLevel) {
      pool.push({
        kind: "weapon",
        id: w.id,
        name: w.name,
        icon: w.icon,
        desc: w.desc,
        nextLevel: cur + 1,
        isNew: cur === 0,
      });
    }
  });

  Object.values(PASSIVE_CATALOG).forEach((pas) => {
    const cur = p.passives[pas.id] || 0;
    if (cur < pas.maxLevel) {
      pool.push({
        kind: "passive",
        id: pas.id,
        name: pas.name,
        icon: pas.icon,
        desc: pas.desc,
        nextLevel: cur + 1,
        isNew: cur === 0,
      });
    }
  });

  // Перемешиваем пул и берем 3
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const choices = pool.slice(0, 3);
  if (choices.length === 0) {
    choices.push({
      kind: "bonus_heal",
      id: "heal",
      name: "Ремонтный Нано-Пакет",
      icon: "❤️",
      desc: "Восстанавливает 50 HP и даёт +15 золота.",
      nextLevel: 1,
      isNew: false,
    });
  }
  return choices;
}

function renderUpgradeCards() {
  const titleEl = document.getElementById("levelUpTitle");
  titleEl.innerHTML = `<span style="color:#06d6a0">✔ ВЕРНО! Выберите улучшение:</span>`;

  const choices = buildUpgradePool();
  const container = document.getElementById("upgradeChoices");
  container.style.gridTemplateColumns = "";
  container.innerHTML = "";

  choices.forEach((ch) => {
    const card = document.createElement("div");
    card.className = "choice-card";
    const badgeText = ch.kind === "bonus_heal" ? "БОНУС" : ch.isNew ? "НОВОЕ!" : `УРОВЕНЬ ${ch.nextLevel}`;
    card.innerHTML = `
      <div class="choice-icon">${ch.icon}</div>
      <div class="choice-tag ${ch.isNew ? "new" : ""}">${badgeText}</div>
      <div class="choice-title">${ch.name}</div>
      <div class="choice-desc">${ch.desc}</div>
    `;
    card.addEventListener("click", () => {
      applyUpgradeChoice(ch);
    });
    container.appendChild(card);
  });
}

function openLevelUpModal() {
  game.choosingUpgrade = true;
  sfx.levelUp();

  const quiz = pickQuizQuestion();
  const titleEl = document.getElementById("levelUpTitle");
  titleEl.innerHTML = `
    <div style="font-size:0.85rem;color:#ffd166;margin-bottom:6px;letter-spacing:0.5px;">
      🧠 ВОПРОС НА ПРОКАЧКУ (Ошибка = пропуск улучшения!)
    </div>
    <div style="font-size:1.18rem;line-height:1.35;color:#eef2ff;">${escapeHtml(quiz.question)}</div>
  `;

  const container = document.getElementById("upgradeChoices");
  container.style.gridTemplateColumns = "1fr 1fr";
  container.innerHTML = "";

  let answered = false;

  quiz.options.forEach((opt, idx) => {
    const card = document.createElement("div");
    card.className = "choice-card";
    card.style.padding = "16px 14px";
    card.style.justifyContent = "center";
    const letter = ["A", "B", "C", "D"][idx];
    card.innerHTML = `
      <div class="choice-tag">${letter}</div>
      <div class="choice-title" style="font-size:1rem;">${escapeHtml(opt.text)}</div>
    `;

    card.addEventListener("click", () => {
      if (answered) return;
      answered = true;

      if (opt.correct) {
        sfx.levelUp();
        renderUpgradeCards();
      } else {
        sfx.hurt();
        card.style.borderColor = "#ef4444";
        card.style.background = "rgba(239, 68, 68, 0.25)";
        titleEl.innerHTML = `<span style="color:#ef4444">✖ НЕВЕРНО! Улучшение уровня пропущено!</span>`;
        if (game.player) {
          addFloatingText(game.player.x, game.player.y - 36, "✖ НЕВЕРНО! СКИП УЛУЧШЕНИЯ!", "#ef4444", 17);
        }
        setTimeout(() => {
          levelUpModal.classList.add("hidden");
          container.style.gridTemplateColumns = "";
          game.choosingUpgrade = false;
          updateHud();
        }, 850);
      }
    });

    container.appendChild(card);
  });

  levelUpModal.classList.remove("hidden");
}

function applyUpgradeChoice(ch) {
  const p = game.player;
  if (ch.kind === "weapon") {
    p.weapons[ch.id] = (p.weapons[ch.id] || 0) + 1;
  } else if (ch.kind === "passive") {
    p.passives[ch.id] = (p.passives[ch.id] || 0) + 1;
    if (ch.id === "vitality") {
      p.maxHp += 25;
      p.hp = Math.min(p.maxHp, p.hp + 25);
    }
  } else if (ch.kind === "bonus_heal") {
    p.hp = Math.min(p.maxHp, p.hp + 50);
    game.gold += 15;
  }

  levelUpModal.classList.add("hidden");
  game.choosingUpgrade = false;
  updateHud();
}

// ============================================================================
// ОБНОВЛЕНИЕ ФИЗИКИ И СОСТОЯНИЯ ИГРЫ
// ============================================================================
function updateGame(dt) {
  if (!game.running || game.paused || game.choosingUpgrade || game.over) return;

  game.time += dt;
  const p = game.player;
  const stats = getPlayerStats(p);

  // Регенерация HP
  if (p.hp < p.maxHp) {
    p.hp = Math.min(p.maxHp, p.hp + stats.regenRate * dt);
  }
  if (p.invulnTimer > 0) p.invulnTimer -= dt;
  if (game.shakeTime > 0) game.shakeTime -= dt;

  // Движение игрока (WASD / стрелки или мышь)
  let mx = 0;
  let my = 0;
  if (input.keys["KeyW"] || input.keys["ArrowUp"]) my -= 1;
  if (input.keys["KeyS"] || input.keys["ArrowDown"]) my += 1;
  if (input.keys["KeyA"] || input.keys["ArrowLeft"]) mx -= 1;
  if (input.keys["KeyD"] || input.keys["ArrowRight"]) mx += 1;

  if (mx === 0 && my === 0 && input.mouseDown) {
    const dx = input.mouseX - canvas.width / 2;
    const dy = input.mouseY - canvas.height / 2;
    const dist = Math.hypot(dx, dy);
    if (dist > 12) {
      mx = dx / dist;
      my = dy / dist;
    }
  } else if (mx !== 0 || my !== 0) {
    const len = Math.hypot(mx, my);
    mx /= len;
    my /= len;
  }

  if (mx !== 0 || my !== 0) {
    p.x += mx * stats.moveSpeed * dt;
    p.y += my * stats.moveSpeed * dt;
    p.facingX = mx;
    p.facingY = my;
  }

  // Спавн волн и работа оружия
  updateWaveDirector(dt);
  updateWeapons(dt);

  // Обновление снарядов игрока
  for (let i = game.projectiles.length - 1; i >= 0; i--) {
    const pr = game.projectiles[i];
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
    pr.life -= dt;

    for (const e of game.enemies) {
      if (pr.hitSet.has(e)) continue;
      const dist = Math.hypot(e.x - pr.x, e.y - pr.y);
      if (dist <= e.radius + pr.radius) {
        pr.hitSet.add(e);
        damageEnemy(e, pr.damage, pr.x, pr.y, 110);
        pr.pierce--;
        if (pr.pierce <= 0) {
          pr.life = 0;
          break;
        }
      }
    }

    if (pr.life <= 0) {
      game.projectiles.splice(i, 1);
    }
  }

  // Снаряды врагов (фантомов и боссов)
  for (let i = game.enemyProjectiles.length - 1; i >= 0; i--) {
    const ep = game.enemyProjectiles[i];
    ep.x += ep.vx * dt;
    ep.y += ep.vy * dt;
    ep.life -= dt;

    if (Math.hypot(ep.x - p.x, ep.y - p.y) <= ep.radius + p.radius) {
      damagePlayer(ep.damage);
      ep.life = 0;
    }
    if (ep.life <= 0) game.enemyProjectiles.splice(i, 1);
  }

  // Движение врагов, стрельба и столкновения
  for (let i = game.enemies.length - 1; i >= 0; i--) {
    const e = game.enemies[i];
    if (e.hp <= 0) {
      handleEnemyDeath(e);
      game.enemies.splice(i, 1);
      continue;
    }

    if (e.hitFlash > 0) e.hitFlash -= dt;
    if (e.slowTimer > 0) e.slowTimer -= dt;
    if (e.bladeHitCd > 0) e.bladeHitCd -= dt;

    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;

    // Если враг отстал слишком далеко, переносим его ближе по курсу
    if (dist > 1500 && !e.isBoss) {
      const a = Math.random() * Math.PI * 2;
      e.x = p.x + Math.cos(a) * 620;
      e.y = p.y + Math.sin(a) * 620;
      continue;
    }

    const spd = e.speed * (e.slowTimer > 0 ? 0.55 : 1);
    e.x += (dx / dist) * spd * dt;
    e.y += (dy / dist) * spd * dt;

    // Выстрелы фантомов и боссов
    if (e.type === "phantom" || e.isBoss) {
      e.shootTimer -= dt;
      if (e.shootTimer <= 0 && dist < 560) {
        e.shootTimer = e.isBoss ? 1.7 : 2.8;
        const baseA = Math.atan2(dy, dx);
        const shots = e.isBoss ? 3 : 1;
        for (let s = 0; s < shots; s++) {
          const a = baseA + (shots > 1 ? (s - 1) * 0.25 : 0);
          game.enemyProjectiles.push({
            x: e.x,
            y: e.y,
            vx: Math.cos(a) * 230,
            vy: Math.sin(a) * 230,
            radius: e.isBoss ? 8 : 6,
            damage: Math.round(e.damage * 0.75),
            life: 3.2,
          });
        }
      }
    }

    // Контактный урон по герою
    if (dist < e.radius + p.radius) {
      damagePlayer(e.damage);
    }
  }

  // Мягкое расталкивание врагов между собой
  for (let i = 0; i < game.enemies.length; i++) {
    const a = game.enemies[i];
    for (let j = i + 1; j < Math.min(i + 12, game.enemies.length); j++) {
      const b = game.enemies[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const minD = a.radius + b.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 > 0 && d2 < minD * minD) {
        const d = Math.sqrt(d2);
        const push = (minD - d) * 0.35;
        const nx = dx / d;
        const ny = dy / d;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
      }
    }
  }

  // Сбор кристаллов опыта, золота и бонусов
  for (let i = game.gems.length - 1; i >= 0; i--) {
    const g = game.gems[i];
    const dx = p.x - g.x;
    const dy = p.y - g.y;
    const dist = Math.hypot(dx, dy);

    if (dist <= stats.pickupRadius) {
      g.magnetized = true;
    }

    if (g.magnetized) {
      const pullSpeed = 460;
      g.x += (dx / (dist || 1)) * pullSpeed * dt;
      g.y += (dy / (dist || 1)) * pullSpeed * dt;
    }

    if (dist <= p.radius + 12) {
      if (g.kind === "xp") {
        gainXp(g.value);
      } else if (g.kind === "gold") {
        game.gold += g.value;
        sfx.coin();
        addFloatingText(p.x, p.y - 24, `+${g.value} 🪙`, "#ffd166", 15);
      } else if (g.kind === "heal") {
        p.hp = Math.min(p.maxHp, p.hp + g.value);
        sfx.coin();
        addFloatingText(p.x, p.y - 24, `+${g.value} HP`, "#06d6a0", 15);
      } else if (g.kind === "vacuum") {
        sfx.levelUp();
        addFloatingText(p.x, p.y - 28, "МАГНИТ АКТИВИРОВАН!", "#00f2fe", 17);
        game.gems.forEach((other) => {
          if (other.kind === "xp" || other.kind === "gold") other.magnetized = true;
        });
      }
      game.gems.splice(i, 1);
    }
  }

  // Эффекты (частицы, дуги взмахов, молнии, всплывающий урон)
  for (let i = game.particles.length - 1; i >= 0; i--) {
    const pt = game.particles[i];
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.life -= dt;
    if (pt.life <= 0) game.particles.splice(i, 1);
  }

  for (let i = game.slashes.length - 1; i >= 0; i--) {
    game.slashes[i].life -= dt;
    if (game.slashes[i].life <= 0) game.slashes.splice(i, 1);
  }

  for (let i = game.lightningArcs.length - 1; i >= 0; i--) {
    game.lightningArcs[i].life -= dt;
    if (game.lightningArcs[i].life <= 0) game.lightningArcs.splice(i, 1);
  }

  for (let i = game.floatingTexts.length - 1; i >= 0; i--) {
    const ft = game.floatingTexts[i];
    ft.y -= 28 * dt;
    ft.life -= dt;
    if (ft.life <= 0) game.floatingTexts.splice(i, 1);
  }

  game.score =
    game.kills * 10 +
    Math.floor(game.time) * 5 +
    p.level * 50 +
    game.gold * 2;

  updateHud();
}

function damagePlayer(amount) {
  const p = game.player;
  if (p.invulnTimer > 0 || game.over) return;
  p.hp -= amount;
  p.invulnTimer = 0.42;
  game.shakeTime = 0.2;
  game.shakeMag = 6;
  sfx.hurt();
  spawnParticles(p.x, p.y, "#ef4444", 10);

  if (p.hp <= 0) {
    p.hp = 0;
    finishRun("ВЫ ПАЛИ В БОЮ");
  }
}

async function finishRun(titleText = "ЗАБЕГ ЗАВЕРШЁН") {
  if (game.over) return;
  game.over = true;
  game.running = false;
  pauseModal.classList.add("hidden");
  levelUpModal.classList.add("hidden");

  const p = game.player;
  const survivalSec = Math.floor(game.time);

  document.getElementById("gameOverTitle").textContent = titleText;
  document.getElementById("sumTime").textContent = formatTime(survivalSec);
  document.getElementById("sumKills").textContent = game.kills;
  document.getElementById("sumLevel").textContent = p.level;
  document.getElementById("sumGold").textContent = `+${game.gold} 🪙`;
  document.getElementById("sumScore").textContent = game.score;
  document.getElementById("saveStatusText").textContent = "Сохранение результата в базу SQLite...";

  gameOverModal.classList.remove("hidden");

  try {
    const res = await apiRequest("/api/runs", "POST", {
      weapon: game.starterWeapon,
      survival_time: survivalSec,
      kills: game.kills,
      level_reached: p.level,
      gold_earned: game.gold,
    });
    appState.user = res.user;
    document.getElementById("sumScore").textContent = res.score;
    document.getElementById("saveStatusText").textContent = "✔ Результат и золото сохранены в SQLite!";
    await refreshLeaderboard();
    renderMenuProfile();
  } catch (err) {
    document.getElementById("saveStatusText").textContent = `Ошибка сохранения: ${err.message}`;
  }
}

// ============================================================================
// ОТРИСОВКА КАДРА НА CANVAS
// ============================================================================
function renderGame() {
  ctx.fillStyle = "#070812";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!game.player) return;
  const p = game.player;

  let shakeX = 0;
  let shakeY = 0;
  if (game.shakeTime > 0) {
    shakeX = (Math.random() - 0.5) * game.shakeMag * 2;
    shakeY = (Math.random() - 0.5) * game.shakeMag * 2;
  }

  const camX = canvas.width / 2 - p.x + shakeX;
  const camY = canvas.height / 2 - p.y + shakeY;

  ctx.save();
  ctx.translate(camX, camY);

  // 1. Бесконечная неоновая сетка арены
  const gridSize = 80;
  const startX = Math.floor((p.x - canvas.width / 2) / gridSize) * gridSize;
  const endX = p.x + canvas.width / 2 + gridSize;
  const startY = Math.floor((p.y - canvas.height / 2) / gridSize) * gridSize;
  const endY = p.y + canvas.height / 2 + gridSize;

  ctx.strokeStyle = "rgba(79, 172, 254, 0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let gx = startX; gx <= endX; gx += gridSize) {
    ctx.moveTo(gx, startY);
    ctx.lineTo(gx, endY);
  }
  for (let gy = startY; gy <= endY; gy += gridSize) {
    ctx.moveTo(startX, gy);
    ctx.lineTo(endX, gy);
  }
  ctx.stroke();

  // Декоративные пилоны на карте
  for (const pr of game.props) {
    if (Math.abs(pr.x - p.x) > canvas.width || Math.abs(pr.y - p.y) > canvas.height) continue;
    ctx.fillStyle = `hsla(${pr.hue}, 80%, 50%, 0.08)`;
    ctx.strokeStyle = `hsla(${pr.hue}, 90%, 60%, 0.22)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(pr.x, pr.y, pr.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // 2. Аура Искажения
  if (p.weapons.aura) {
    const lvl = p.weapons.aura;
    const auraR = 88 + lvl * 14 + Math.sin(p.auraPulse) * 4;
    const grad = ctx.createRadialGradient(p.x, p.y, 10, p.x, p.y, auraR);
    grad.addColorStop(0, "rgba(181, 55, 242, 0.03)");
    grad.addColorStop(0.75, "rgba(181, 55, 242, 0.14)");
    grad.addColorStop(1, "rgba(0, 242, 254, 0.32)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, auraR, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Кристаллы опыта, монеты и бонусы
  for (const g of game.gems) {
    if (g.kind === "xp") {
      ctx.fillStyle = g.value >= 25 ? "#ff2a85" : g.value >= 5 ? "#06d6a0" : "#00f2fe";
      ctx.beginPath();
      ctx.moveTo(g.x, g.y - 6);
      ctx.lineTo(g.x + 5, g.y);
      ctx.lineTo(g.x, g.y + 6);
      ctx.lineTo(g.x - 5, g.y);
      ctx.closePath();
      ctx.fill();
    } else if (g.kind === "gold") {
      ctx.fillStyle = "#ffd166";
      ctx.beginPath();
      ctx.arc(g.x, g.y, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else if (g.kind === "heal") {
      ctx.fillStyle = "#06d6a0";
      ctx.fillRect(g.x - 7, g.y - 2.5, 14, 5);
      ctx.fillRect(g.x - 2.5, g.y - 7, 5, 14);
    } else if (g.kind === "vacuum") {
      ctx.strokeStyle = "#00f2fe";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(g.x, g.y, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // 4. Враги
  for (const e of game.enemies) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = e.hitFlash > 0 ? "#ffffff" : e.color;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = e.isBoss ? 3 : 1.5;

    ctx.beginPath();
    if (e.shape === "diamond") {
      ctx.moveTo(0, -e.radius);
      ctx.lineTo(e.radius, 0);
      ctx.lineTo(0, e.radius);
      ctx.lineTo(-e.radius, 0);
      ctx.closePath();
    } else if (e.shape === "hex" || e.shape === "boss") {
      const sides = e.isBoss ? 8 : 6;
      for (let s = 0; s < sides; s++) {
        const a = (Math.PI * 2 * s) / sides;
        const px = Math.cos(a) * e.radius;
        const py = Math.sin(a) * e.radius;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    } else if (e.shape === "triangle") {
      ctx.moveTo(0, -e.radius);
      ctx.lineTo(e.radius, e.radius);
      ctx.lineTo(-e.radius, e.radius);
      ctx.closePath();
    } else {
      ctx.arc(0, 0, e.radius, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();

    // Полоска HP у раненых врагов
    if (e.hp < e.maxHp && !e.isBoss) {
      const w = e.radius * 1.8;
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(-w / 2, -e.radius - 9, w, 4);
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(-w / 2, -e.radius - 9, w * (e.hp / e.maxHp), 4);
    }
    ctx.restore();
  }

  // 5. Орбитальные клинки
  if (p.weapons.blades) {
    const lvl = p.weapons.blades;
    const count = Math.min(7, 1 + lvl);
    const orbitRadius = 72 + lvl * 6;
    const bladeRadius = 11 + lvl * 1.1;

    for (let i = 0; i < count; i++) {
      const a = p.bladeAngle + (Math.PI * 2 * i) / count;
      const bx = p.x + Math.cos(a) * orbitRadius;
      const by = p.y + Math.sin(a) * orbitRadius;

      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(a * 2);
      ctx.fillStyle = "#00f2fe";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -bladeRadius);
      ctx.lineTo(bladeRadius * 0.65, 0);
      ctx.lineTo(0, bladeRadius);
      ctx.lineTo(-bladeRadius * 0.65, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  // 6. Дуги Клинка Пустоты
  for (const sl of game.slashes) {
    const alpha = sl.life / sl.maxLife;
    ctx.save();
    ctx.translate(sl.x, sl.y);
    ctx.strokeStyle = `rgba(181, 55, 242, ${alpha})`;
    ctx.lineWidth = 16 * alpha;
    ctx.beginPath();
    ctx.arc(0, 0, sl.range * 0.78, sl.angle - 0.85, sl.angle + 0.85);
    ctx.stroke();
    ctx.restore();
  }

  // 7. Дуги Цепной Молнии
  for (const arc of game.lightningArcs) {
    const alpha = arc.life / arc.maxLife;
    ctx.strokeStyle = `rgba(255, 209, 102, ${alpha})`;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    arc.points.forEach((pt, idx) => {
      if (idx === 0) ctx.moveTo(pt.x, pt.y);
      else {
        const midX = (arc.points[idx - 1].x + pt.x) / 2 + (Math.random() - 0.5) * 18;
        const midY = (arc.points[idx - 1].y + pt.y) / 2 + (Math.random() - 0.5) * 18;
        ctx.lineTo(midX, midY);
        ctx.lineTo(pt.x, pt.y);
      }
    });
    ctx.stroke();
  }

  // 8. Снаряды игрока и врагов
  for (const pr of game.projectiles) {
    ctx.fillStyle = pr.color;
    ctx.beginPath();
    ctx.arc(pr.x, pr.y, pr.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const ep of game.enemyProjectiles) {
    ctx.fillStyle = "#ff2a85";
    ctx.beginPath();
    ctx.arc(ep.x, ep.y, ep.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // 9. Игрок (Герой)
  ctx.save();
  ctx.translate(p.x, p.y);
  const glowGrad = ctx.createRadialGradient(0, 0, 4, 0, 0, p.radius * 2.1);
  glowGrad.addColorStop(0, "rgba(0, 242, 254, 0.55)");
  glowGrad.addColorStop(1, "rgba(0, 242, 254, 0)");
  ctx.fillStyle = glowGrad;
  ctx.beginPath();
  ctx.arc(0, 0, p.radius * 2.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = p.invulnTimer > 0 && Math.floor(p.invulnTimer * 20) % 2 === 0 ? "#ffffff" : "#00f2fe";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Визор по направлению взгляда
  ctx.fillStyle = "#070812";
  ctx.beginPath();
  ctx.arc(p.facingX * 6, p.facingY * 6, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 10. Частицы и всплывающие цифры урона
  for (const pt of game.particles) {
    ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
  }
  ctx.globalAlpha = 1;

  for (const ft of game.floatingTexts) {
    ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
    ctx.font = `900 ${ft.size}px system-ui, sans-serif`;
    ctx.fillStyle = ft.color;
    ctx.textAlign = "center";
    ctx.fillText(ft.text, ft.x, ft.y);
  }
  ctx.globalAlpha = 1;

  ctx.restore();
}

function updateHud() {
  const p = game.player;
  if (!p) return;

  const xpPct = Math.min(100, (p.xp / p.xpToNext) * 100);
  document.getElementById("xpBarFill").style.width = `${xpPct}%`;
  document.getElementById("xpLevelText").textContent = `УР. ${p.level}`;

  const hpPct = Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100));
  document.getElementById("hudHpFill").style.width = `${hpPct}%`;
  document.getElementById("hudHpText").textContent = `${Math.ceil(p.hp)} / ${p.maxHp} HP`;

  document.getElementById("hudTimer").textContent = formatTime(game.time);
  document.getElementById("waveBanner").textContent = `Волна ${Math.floor(game.time / 30) + 1}`;
  document.getElementById("hudKills").textContent = game.kills;
  document.getElementById("hudGold").textContent = game.gold;
  document.getElementById("hudScore").textContent = game.score;

  // Босс-бар
  const bossWrap = document.getElementById("bossBarWrap");
  if (game.activeBoss && game.activeBoss.hp > 0) {
    bossWrap.classList.remove("hidden");
    document.getElementById("bossNameText").textContent = game.activeBoss.name;
    document.getElementById("bossHpFill").style.width = `${Math.max(0, (game.activeBoss.hp / game.activeBoss.maxHp) * 100)}%`;
  } else {
    bossWrap.classList.add("hidden");
  }

  // Инвентарь активного оружия и пассивок
  const invBar = document.getElementById("inventoryBar");
  let html = "";
  Object.keys(p.weapons).forEach((wId) => {
    const w = WEAPON_CATALOG[wId];
    if (w) {
      html += `<div class="inv-slot" title="${w.name}">${w.icon} <span class="inv-lvl">Ур.${p.weapons[wId]}</span></div>`;
    }
  });
  Object.keys(p.passives).forEach((pId) => {
    const pas = PASSIVE_CATALOG[pId];
    if (pas) {
      html += `<div class="inv-slot passive" title="${pas.name}">${pas.icon} <span class="inv-lvl">Ур.${p.passives[pId]}</span></div>`;
    }
  });
  invBar.innerHTML = html;
}

// Главный игровой цикл
let lastFrameTime = performance.now();
function mainLoop(now) {
  const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  updateGame(dt);
  renderGame();
  requestAnimationFrame(mainLoop);
}
requestAnimationFrame(mainLoop);

// ============================================================================
// ИНИЦИАЛИЗАЦИЯ СОБЫТИЙ ИНТЕРФЕЙСА
// ============================================================================
function initEvents() {
  updateSoundButtons();

  const tabLogin = document.getElementById("tabLogin");
  const tabRegister = document.getElementById("tabRegister");
  const submitBtn = document.getElementById("authSubmitBtn");
  const errBox = document.getElementById("authError");

  function setAuthMode(mode) {
    appState.authMode = mode;
    tabLogin.classList.toggle("active", mode === "login");
    tabRegister.classList.toggle("active", mode === "register");
    submitBtn.textContent = mode === "login" ? "Войти в игру" : "Создать аккаунт";
    errBox.classList.add("hidden");
  }

  tabLogin.addEventListener("click", () => setAuthMode("login"));
  tabRegister.addEventListener("click", () => setAuthMode("register"));

  document.getElementById("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.classList.add("hidden");
    const username = document.getElementById("authUsername").value.trim();
    const password = document.getElementById("authPassword").value;
    const endpoint = appState.authMode === "login" ? "/api/login" : "/api/register";

    try {
      const res = await apiRequest(endpoint, "POST", { username, password });
      appState.token = res.token;
      safeSetStorage("ns_token", res.token);
      appState.user = res.user;
      await refreshLeaderboard();
      renderMenuProfile();
      showScreen("menu");
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove("hidden");
    }
  });

  document.getElementById("btnLogout").addEventListener("click", async () => {
    try {
      await apiRequest("/api/logout", "POST");
    } catch (_) {}
    appState.token = "";
    appState.user = null;
    safeSetStorage("ns_token", null);
    showScreen("auth");
  });

  document.getElementById("btnStartRun").addEventListener("click", startNewRun);
  document.getElementById("btnPlayAgain").addEventListener("click", startNewRun);
  document.getElementById("btnBackToMenu").addEventListener("click", () => {
    gameOverModal.classList.add("hidden");
    renderMenuProfile();
    showScreen("menu");
  });

  document.getElementById("btnPauseHud").addEventListener("click", togglePause);
  document.getElementById("btnResumeGame").addEventListener("click", togglePause);
  document.getElementById("btnEndRunEarly").addEventListener("click", () => {
    finishRun("ЗАБЕГ ЗАВЕРШЁН ДОСРОЧНО");
  });

  const handleMute = () => {
    sfx.toggleMute();
    updateSoundButtons();
  };
  document.getElementById("btnMuteHud").addEventListener("click", handleMute);
  document.getElementById("btnMuteMenu").addEventListener("click", handleMute);

  // Переключение вкладок Лидерборд / История
  const subLb = document.getElementById("subtabLeaderboard");
  const subHist = document.getElementById("subtabHistory");
  const lbContainer = document.getElementById("leaderboardContainer");
  const histContainer = document.getElementById("historyContainer");

  subLb.addEventListener("click", () => {
    subLb.classList.add("active");
    subHist.classList.remove("active");
    lbContainer.classList.remove("hidden");
    histContainer.classList.add("hidden");
  });

  subHist.addEventListener("click", () => {
    subHist.classList.add("active");
    subLb.classList.remove("active");
    histContainer.classList.remove("hidden");
    lbContainer.classList.add("hidden");
  });
}

async function bootstrap() {
  initEvents();
  if (appState.token) {
    try {
      const res = await apiRequest("/api/me");
      appState.user = res.user;
      await refreshLeaderboard();
      renderMenuProfile();
      showScreen("menu");
      return;
    } catch (_) {
      safeSetStorage("ns_token", null);
      appState.token = "";
    }
  }
  showScreen("auth");
}

bootstrap();
