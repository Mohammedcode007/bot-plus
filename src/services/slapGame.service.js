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
    },

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

          /*
            مهم:
            حذفنا rooms و challengeSeconds من النظام الجديد.
            لكن لو الملف القديم يحتوي عليهم، لن يسببوا مشكلة.
          */
          activeChallenge:
            data.activeChallenge &&
            typeof data.activeChallenge === 'object'
              ? data.activeChallenge
              : null,

          stats:
            data.stats &&
            typeof data.stats === 'object' &&
            !Array.isArray(data.stats)
              ? data.stats
              : {},
        }
      : defaults;
  } catch {
    return defaultSlapStore();
  }
}

async function writeSlapStore(store) {
  const safeStore = {
    settings: {
      enabled: store?.settings?.enabled === true,
      prizePoints: Math.max(
        1,
        Number(store?.settings?.prizePoints) || 100,
      ),
    },

    activeChallenge:
      store?.activeChallenge &&
      typeof store.activeChallenge === 'object'
        ? store.activeChallenge
        : null,

    stats:
      store?.stats &&
      typeof store.stats === 'object' &&
      !Array.isArray(store.stats)
        ? store.stats
        : {},
  };

  await fs.mkdir(path.dirname(SLAP_GAME_FILE), {
    recursive: true,
  });

  await fs.writeFile(
    SLAP_GAME_FILE,
    JSON.stringify(safeStore, null, 2),
    'utf8',
  );
}

function makeChallengeId() {
  return `slap_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export async function getActiveSlapChallenge() {
  const store = await readSlapStore();

  return store.activeChallenge;
}

export async function createSlapChallenge({
  playerKey,
  username,
  userId,
  roomId,
  roomName,
}) {
  const store = await readSlapStore();

  if (store.settings.enabled !== true) {
    return {
      ok: false,
      reason: 'disabled',
      challenge: null,
      settings: store.settings,
    };
  }

  const cleanPlayerKey = clean(playerKey);

  if (!cleanPlayerKey) {
    return {
      ok: false,
      reason: 'missing_player',
      challenge: null,
      settings: store.settings,
    };
  }

  if (store.activeChallenge) {
    const starterKey = clean(store.activeChallenge?.starter?.playerKey);

    if (
      starterKey &&
      normalizeKey(starterKey) === normalizeKey(cleanPlayerKey)
    ) {
      return {
        ok: false,
        reason: 'starter_already_waiting',
        challenge: store.activeChallenge,
        settings: store.settings,
      };
    }

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
      playerKey: cleanPlayerKey,
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

function ensurePlayerStats(
  store,
  {
    playerKey,
    username,
    userId,
  },
) {
  const key = clean(playerKey);

  if (!key) {
    return null;
  }

  if (!store.stats || typeof store.stats !== 'object') {
    store.stats = {};
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

  store.stats[key].username =
    clean(username) || clean(store.stats[key].username);

  store.stats[key].userId =
    clean(userId) || clean(store.stats[key].userId);

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
  const store = await readSlapStore();

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
      challenge,
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

  const starter = {
    playerKey: starterKey,
    username: clean(challenge.starter?.username),
    userId: clean(challenge.starter?.userId),
    roomId: clean(challenge.starter?.roomId),
    roomName: clean(challenge.starter?.roomName),
  };

  const joiner = {
    playerKey: joinerKey,
    username: clean(username),
    userId: clean(userId),
    roomId: clean(roomId),
    roomName: clean(roomName),
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
    winnerStats.wins = Number(winnerStats.wins || 0) + 1;
    winnerStats.played = Number(winnerStats.played || 0) + 1;
    winnerStats.pointsWon = Number(winnerStats.pointsWon || 0) + prizePoints;
    winnerStats.updatedAt = new Date().toISOString();
  }

  if (loserStats) {
    loserStats.losses = Number(loserStats.losses || 0) + 1;
    loserStats.played = Number(loserStats.played || 0) + 1;
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

  /*
    مهم:
    بعد دخول اللاعب الثاني وتحديد الفائز،
    يتم إغلاق التحدي حتى يستطيع أي لاعب بدء تحدي جديد.
  */
  store.activeChallenge = null;

  await writeSlapStore(store);

  return {
    ok: true,
    reason: '',
    result,
    settings: store.settings,
  };
}

export async function cancelSlapChallenge() {
  const store = await readSlapStore();

  store.activeChallenge = null;

  await writeSlapStore(store);

  return {
    ok: true,
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