import fs from 'fs/promises';
import path from 'path';

const SLAP_GAME_FILE = path.resolve('data/slap-game.json');

function clean(value) {
  return String(value || '').trim();
}

function normalizeKey(value) {
  return clean(value).toLowerCase();
}

function defaultSlapStore() {
  return {
    settings: {
      enabled: true,
      prizePoints: 100,
      challengeSeconds: 60,
    },

    rooms: [],

    activeChallenge: null,

    stats: {},
  };
}

async function ensureSlapFile() {
  try {
    await fs.mkdir(path.dirname(SLAP_GAME_FILE), {
      recursive: true,
    });

    await fs.access(SLAP_GAME_FILE);
  } catch {
    await fs.writeFile(
      SLAP_GAME_FILE,
      JSON.stringify(defaultSlapStore(), null, 2),
      'utf8',
    );
  }
}

export async function readSlapStore() {
  await ensureSlapFile();

  try {
    const raw = await fs.readFile(SLAP_GAME_FILE, 'utf8');
    const data = JSON.parse(raw || '{}');
    const defaults = defaultSlapStore();

    return data && typeof data === 'object'
      ? {
        ...defaults,
        ...data,
        settings: {
          ...defaults.settings,
          ...(data.settings || {}),
        },
        rooms: Array.isArray(data.rooms)
          ? data.rooms
          : [],
        stats: data.stats && typeof data.stats === 'object'
          ? data.stats
          : {},
      }
      : defaults;
  } catch {
    return defaultSlapStore();
  }
}

async function writeSlapStore(store) {
  await fs.mkdir(path.dirname(SLAP_GAME_FILE), {
    recursive: true,
  });

  await fs.writeFile(
    SLAP_GAME_FILE,
    JSON.stringify(store, null, 2),
    'utf8',
  );
}

export async function registerSlapRoom({
  roomId,
  roomName,
}) {
  const store = await readSlapStore();

  const cleanRoomId = clean(roomId);
  const cleanRoomName = clean(roomName);

  if (!cleanRoomId && !cleanRoomName) {
    return store.rooms;
  }

  const roomKey = cleanRoomId || cleanRoomName;
  const normalizedRoomKey = normalizeKey(roomKey);

  const exists = store.rooms.some((room) => {
    const oldKey = clean(room.roomId) || clean(room.roomName);

    return normalizeKey(oldKey) === normalizedRoomKey;
  });

  if (!exists) {
    store.rooms.push({
      roomId: cleanRoomId,
      roomName: cleanRoomName,
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } else {
    store.rooms = store.rooms.map((room) => {
      const oldKey = clean(room.roomId) || clean(room.roomName);

      if (normalizeKey(oldKey) !== normalizedRoomKey) {
        return room;
      }

      return {
        ...room,
        roomId: clean(room.roomId) || cleanRoomId,
        roomName: cleanRoomName || clean(room.roomName),
        updatedAt: new Date().toISOString(),
      };
    });
  }

  await writeSlapStore(store);

  return store.rooms;
}

export async function getKnownSlapRooms() {
  const store = await readSlapStore();

  return Array.isArray(store.rooms)
    ? store.rooms.filter((room) => {
      return clean(room.roomId) || clean(room.roomName);
    })
    : [];
}

function makeChallengeId() {
  return `slap_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function isChallengeExpired({
  challenge,
  settings,
}) {
  if (!challenge || challenge.status !== 'waiting') {
    return true;
  }

  const startedAt = Date.parse(challenge.startedAt || '');

  if (!Number.isFinite(startedAt)) {
    return true;
  }

  const challengeSeconds = Math.max(
    10,
    Number(settings.challengeSeconds) || 60,
  );

  return Date.now() - startedAt > challengeSeconds * 1000;
}

async function clearExpiredChallenge(store) {
  if (
    store.activeChallenge &&
    isChallengeExpired({
      challenge: store.activeChallenge,
      settings: store.settings,
    })
  ) {
    store.activeChallenge = null;

    await writeSlapStore(store);
  }

  return store;
}

export async function getActiveSlapChallenge() {
  let store = await readSlapStore();

  store = await clearExpiredChallenge(store);

  return store.activeChallenge;
}

export async function createSlapChallenge({
  playerKey,
  username,
  userId,
  roomId,
  roomName,
}) {
  let store = await readSlapStore();

  store = await clearExpiredChallenge(store);

  if (store.settings.enabled !== true) {
    return {
      ok: false,
      reason: 'disabled',
      challenge: null,
      settings: store.settings,
    };
  }

  if (store.activeChallenge) {
    return {
      ok: false,
      reason: 'already_active',
      challenge: store.activeChallenge,
      settings: store.settings,
    };
  }

  const challenge = {
    id: makeChallengeId(),
    status: 'waiting',

    starter: {
      playerKey: clean(playerKey),
      username: clean(username),
      userId: clean(userId),
      roomId: clean(roomId),
      roomName: clean(roomName),
    },

    startedAt: new Date().toISOString(),
  };

  store.activeChallenge = challenge;

  await writeSlapStore(store);

  return {
    ok: true,
    reason: '',
    challenge,
    settings: store.settings,
  };
}

function ensurePlayerStats(store, {
  playerKey,
  username,
  userId,
}) {
  const key = clean(playerKey);

  if (!key) {
    return null;
  }

  if (!store.stats[key]) {
    store.stats[key] = {
      playerKey: key,
      username: clean(username),
      userId: clean(userId),

      wins: 0,
      losses: 0,
      played: 0,
      pointsWon: 0,

      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  store.stats[key].username = clean(username) || clean(store.stats[key].username);
  store.stats[key].userId = clean(userId) || clean(store.stats[key].userId);
  store.stats[key].updatedAt = new Date().toISOString();

  return store.stats[key];
}

export async function joinAndResolveSlapChallenge({
  playerKey,
  username,
  userId,
  roomId,
  roomName,
}) {
  let store = await readSlapStore();

  store = await clearExpiredChallenge(store);

  if (store.settings.enabled !== true) {
    return {
      ok: false,
      reason: 'disabled',
      result: null,
      settings: store.settings,
    };
  }

  const challenge = store.activeChallenge;

  if (!challenge || challenge.status !== 'waiting') {
    return {
      ok: false,
      reason: 'no_active_challenge',
      result: null,
      settings: store.settings,
    };
  }

  const starterKey = clean(challenge.starter?.playerKey);
  const joinerKey = clean(playerKey);

  if (!starterKey || !joinerKey) {
    return {
      ok: false,
      reason: 'missing_player',
      result: null,
      settings: store.settings,
    };
  }

  if (normalizeKey(starterKey) === normalizeKey(joinerKey)) {
    return {
      ok: false,
      reason: 'same_player',
      result: null,
      challenge,
      settings: store.settings,
    };
  }

  const joiner = {
    playerKey: joinerKey,
    username: clean(username),
    userId: clean(userId),
    roomId: clean(roomId),
    roomName: clean(roomName),
  };

  const starter = {
    playerKey: starterKey,
    username: clean(challenge.starter.username),
    userId: clean(challenge.starter.userId),
    roomId: clean(challenge.starter.roomId),
    roomName: clean(challenge.starter.roomName),
  };

  const starterWins = Math.random() < 0.5;

  const winner = starterWins ? starter : joiner;
  const loser = starterWins ? joiner : starter;

  const prizePoints = Math.max(
    1,
    Number(store.settings.prizePoints) || 100,
  );

  const winnerStats = ensurePlayerStats(store, winner);
  const loserStats = ensurePlayerStats(store, loser);

  if (winnerStats) {
    winnerStats.wins += 1;
    winnerStats.played += 1;
    winnerStats.pointsWon += prizePoints;
    winnerStats.updatedAt = new Date().toISOString();
  }

  if (loserStats) {
    loserStats.losses += 1;
    loserStats.played += 1;
    loserStats.updatedAt = new Date().toISOString();
  }

  const result = {
    challengeId: challenge.id,
    starter,
    joiner,
    winner,
    loser,
    prizePoints,
    finishedAt: new Date().toISOString(),
  };

  store.activeChallenge = null;

  await writeSlapStore(store);

  return {
    ok: true,
    reason: '',
    result,
    settings: store.settings,
  };
}

export async function getSlapTopPlayers(limit = 10) {
  const store = await readSlapStore();

  const items = Object.values(store.stats || {})
    .filter((item) => {
      return item && Number(item.wins) > 0;
    })
    .sort((a, b) => {
      const winsDiff = Number(b.wins || 0) - Number(a.wins || 0);

      if (winsDiff !== 0) {
        return winsDiff;
      }

      const pointsDiff = Number(b.pointsWon || 0) - Number(a.pointsWon || 0);

      if (pointsDiff !== 0) {
        return pointsDiff;
      }

      return Number(b.played || 0) - Number(a.played || 0);
    })
    .slice(0, limit);

  return items;
}

export async function getSlapSettings() {
  const store = await readSlapStore();

  return store.settings;
}