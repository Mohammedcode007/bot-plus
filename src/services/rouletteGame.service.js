import fs from 'fs/promises';
import path from 'path';

const ROULETTE_GAME_FILE = path.resolve('data/roulette-game.json');

// ============================================================
// إعدادات سهلة التعديل
// ============================================================
export const ROULETTE_MAX_PLAYERS = 6;
export const ROULETTE_JOIN_DURATION_MS = 60 * 1000;
export const ROULETTE_PLAYER_COOLDOWN_MS = 15 * 60 * 1000;
// ============================================================

function clean(value) {
  return String(value || '').trim();
}

function normalizeKey(value) {
  return clean(value).toLowerCase();
}

function defaultStore() {
  return {
    settings: {
      enabled: true,
      maxPlayers: ROULETTE_MAX_PLAYERS,
      joinDurationMs: ROULETTE_JOIN_DURATION_MS,
      playerCooldownMs: ROULETTE_PLAYER_COOLDOWN_MS,
    },
    activeRound: null,
    cooldowns: {},
    stats: {},
  };
}

async function ensureFile() {
  try {
    await fs.mkdir(path.dirname(ROULETTE_GAME_FILE), { recursive: true });
    await fs.access(ROULETTE_GAME_FILE);
  } catch {
    await fs.writeFile(
      ROULETTE_GAME_FILE,
      JSON.stringify(defaultStore(), null, 2),
      'utf8',
    );
  }
}

export async function readRouletteStore() {
  await ensureFile();

  try {
    const raw = await fs.readFile(ROULETTE_GAME_FILE, 'utf8');
    const data = JSON.parse(raw || '{}');
    const defaults = defaultStore();

    return {
      ...defaults,
      ...(data && typeof data === 'object' ? data : {}),
      settings: {
        ...defaults.settings,
        ...(data?.settings || {}),
      },
      activeRound:
        data?.activeRound && typeof data.activeRound === 'object'
          ? data.activeRound
          : null,
      cooldowns:
        data?.cooldowns && typeof data.cooldowns === 'object'
          ? data.cooldowns
          : {},
      stats:
        data?.stats && typeof data.stats === 'object'
          ? data.stats
          : {},
    };
  } catch (error) {
    console.log('⚠️ [ROULETTE_STORE_READ_FAILED]', error?.message || error);
    return defaultStore();
  }
}

async function writeRouletteStore(store) {
  const safeStore = {
    settings: {
      enabled: store?.settings?.enabled !== false,
      maxPlayers: Math.max(2, Number(store?.settings?.maxPlayers) || ROULETTE_MAX_PLAYERS),
      joinDurationMs: Math.max(1000, Number(store?.settings?.joinDurationMs) || ROULETTE_JOIN_DURATION_MS),
      playerCooldownMs: Math.max(0, Number(store?.settings?.playerCooldownMs) || ROULETTE_PLAYER_COOLDOWN_MS),
    },
    activeRound:
      store?.activeRound && typeof store.activeRound === 'object'
        ? store.activeRound
        : null,
    cooldowns:
      store?.cooldowns && typeof store.cooldowns === 'object'
        ? store.cooldowns
        : {},
    stats:
      store?.stats && typeof store.stats === 'object'
        ? store.stats
        : {},
  };

  await fs.mkdir(path.dirname(ROULETTE_GAME_FILE), { recursive: true });
  const tempFile = `${ROULETTE_GAME_FILE}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(safeStore, null, 2), 'utf8');
  await fs.rename(tempFile, ROULETTE_GAME_FILE);
}

function makeRoundId() {
  return `roulette_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function makePlayer({ playerKey, username, userId, roomId, roomName }) {
  return {
    playerKey: clean(playerKey),
    username: clean(username),
    userId: clean(userId),
    roomId: clean(roomId),
    roomName: clean(roomName),
    joinedAt: new Date().toISOString(),
  };
}

function updatePlayerStats(store, player, won) {
  const key = normalizeKey(player?.playerKey);
  if (!key || player?.isComputer) return;

  store.stats ||= {};
  store.stats[key] ||= {
    playerKey: clean(player.playerKey),
    username: clean(player.username),
    userId: clean(player.userId),
    wins: 0,
    losses: 0,
    played: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const stats = store.stats[key];
  stats.username = clean(player.username) || clean(stats.username);
  stats.userId = clean(player.userId) || clean(stats.userId);
  stats.played = Number(stats.played || 0) + 1;

  if (won) stats.wins = Number(stats.wins || 0) + 1;
  else stats.losses = Number(stats.losses || 0) + 1;

  stats.updatedAt = new Date().toISOString();
}

export async function consumeRouletteCooldown({ playerKey, username, userId }) {
  const store = await readRouletteStore();
  const key = normalizeKey(playerKey);

  if (!key) {
    return { ok: false, reason: 'missing_player', waitMs: 0, waitSeconds: 0 };
  }

  const cooldownMs = Math.max(
    0,
    Number(store.settings.playerCooldownMs) || ROULETTE_PLAYER_COOLDOWN_MS,
  );

  const now = Date.now();
  const lastAt = Number(store.cooldowns?.[key]?.lastAt || 0);
  const elapsed = now - lastAt;

  if (lastAt > 0 && elapsed < cooldownMs) {
    const waitMs = cooldownMs - elapsed;
    return {
      ok: false,
      reason: 'cooldown',
      waitMs,
      waitSeconds: Math.ceil(waitMs / 1000),
      cooldownMs,
    };
  }

  store.cooldowns ||= {};
  store.cooldowns[key] = {
    playerKey: clean(playerKey),
    username: clean(username),
    userId: clean(userId),
    lastAt: now,
    lastAtIso: new Date(now).toISOString(),
  };

  await writeRouletteStore(store);
  return { ok: true, reason: '', waitMs: 0, waitSeconds: 0, cooldownMs };
}

export async function getActiveRouletteRound() {
  const store = await readRouletteStore();
  return store.activeRound;
}

export async function createRouletteRound(playerData) {
  const store = await readRouletteStore();

  if (store.settings.enabled !== true) {
    return { ok: false, reason: 'disabled', round: null, settings: store.settings };
  }

  if (store.activeRound?.status === 'waiting') {
    return { ok: false, reason: 'already_active', round: store.activeRound, settings: store.settings };
  }

  const now = Date.now();
  const round = {
    id: makeRoundId(),
    status: 'waiting',
    players: [makePlayer(playerData)],
    startedAt: new Date(now).toISOString(),
    closesAt: new Date(now + Number(store.settings.joinDurationMs)).toISOString(),
  };

  store.activeRound = round;
  await writeRouletteStore(store);

  return { ok: true, reason: '', round, settings: store.settings };
}

export async function joinRouletteRound(playerData) {
  const store = await readRouletteStore();
  const round = store.activeRound;

  if (!round || round.status !== 'waiting') {
    return { ok: false, reason: 'no_active_round', round: null, settings: store.settings };
  }

  const playerKey = normalizeKey(playerData.playerKey);
  const alreadyJoined = round.players.some(
    (player) => normalizeKey(player.playerKey) === playerKey,
  );

  if (alreadyJoined) {
    return { ok: false, reason: 'already_joined', round, settings: store.settings };
  }

  const maxPlayers = Math.max(2, Number(store.settings.maxPlayers) || ROULETTE_MAX_PLAYERS);

  if (round.players.length >= maxPlayers) {
    return { ok: false, reason: 'round_full', round, settings: store.settings };
  }

  round.players.push(makePlayer(playerData));
  store.activeRound = round;
  await writeRouletteStore(store);

  return {
    ok: true,
    reason: '',
    round,
    settings: store.settings,
    isFull: round.players.length >= maxPlayers,
  };
}

export async function resolveRouletteRound(expectedRoundId = '') {
  const store = await readRouletteStore();
  const round = store.activeRound;

  if (!round || round.status !== 'waiting') {
    return { ok: false, reason: 'no_active_round', result: null };
  }

  if (expectedRoundId && clean(round.id) !== clean(expectedRoundId)) {
    return { ok: false, reason: 'round_changed', result: null };
  }

  const humanPlayers = Array.isArray(round.players) ? [...round.players] : [];

  if (!humanPlayers.length) {
    store.activeRound = null;
    await writeRouletteStore(store);
    return { ok: false, reason: 'no_players', result: null };
  }

  const players = [...humanPlayers];

  if (players.length === 1) {
    players.push({
      playerKey: 'roulette-computer',
      username: 'الجهاز',
      userId: '',
      roomId: humanPlayers[0].roomId,
      roomName: humanPlayers[0].roomName,
      isComputer: true,
      joinedAt: new Date().toISOString(),
    });
  }

  const winnerIndex = Math.floor(Math.random() * players.length);
  const winner = players[winnerIndex];
  const losers = players.filter((_, index) => index !== winnerIndex);

  for (const player of players) {
    updatePlayerStats(store, player, player === winner);
  }

  const result = {
    roundId: round.id,
    players,
    humanPlayers,
    winner,
    losers,
    startedAt: round.startedAt,
    finishedAt: new Date().toISOString(),
    playedAgainstComputer: humanPlayers.length === 1,
  };

  store.activeRound = null;
  await writeRouletteStore(store);

  return { ok: true, reason: '', result };
}

export async function getRouletteTopPlayers(limit = 10) {
  const store = await readRouletteStore();
  return Object.values(store.stats || {})
    .sort((a, b) => {
      const winsDiff = Number(b.wins || 0) - Number(a.wins || 0);
      if (winsDiff !== 0) return winsDiff;
      return Number(a.losses || 0) - Number(b.losses || 0);
    })
    .slice(0, Math.max(1, Number(limit) || 10));
}
