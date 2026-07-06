import fs from 'fs/promises';
import path from 'path';

const PRIZES_FILE = path.resolve('data/game-prizes.json');

function clean(value) {
  return String(value || '').trim();
}

function defaultPrizes() {
  return {
    spin: {
      enabled: true,
      cooldownSeconds: 900,

      minPoints: 10,
      maxPoints: 100,

      pointChance: 70,
      itemChance: 20,
      grandChance: 5,
      nothingChance: 5,

      grandPoints: 1000,

      pointPrizes: [
        '🎁 Lucky Gift',
        '💎 Diamond Badge',
        '👑 Royal Crown',
        '🚀 Rocket Gift',
        '🪙 Coin Treasure',
        '🔥 Fire Chest',
        '⭐ Star Box',
        '🎟️ VIP Ticket',
      ],

      items: [
        '🐶 Pet Dog',
        '🐱 Pet Cat',
        '🦅 Golden Eagle',
        '🐎 Royal Horse',
        '🐉 Dragon',
        '🦄 Unicorn',
        '🚗 Sport Car',
        '🏰 Castle',
        '👑 Royal Crown',
        '💎 Diamond Badge',
        '🛡️ Legendary Shield',
        '🔮 Magic Crystal',
        '⚔️ Fantasy Sword',
        '🔫 Laser Gun',
        '🚀 Rocket',
        '🛥️ Luxury Yacht',
        '✈️ Private Jet',
        '🏝️ Private Island',
        '🎟️ VIP Ticket',
        '🌍 Trip to Dubai',
        '🌍 Trip to Turkey',
        '🌍 Trip to Maldives',
        '🌍 Trip to Morocco',
        '🌍 Trip to Egypt',
      ],
    },
  };
}

async function ensurePrizesFile() {
  try {
    await fs.mkdir(path.dirname(PRIZES_FILE), {
      recursive: true,
    });

    await fs.access(PRIZES_FILE);
  } catch {
    await fs.writeFile(
      PRIZES_FILE,
      JSON.stringify(defaultPrizes(), null, 2),
      'utf8',
    );
  }
}

export async function readGamePrizes() {
  await ensurePrizesFile();

  try {
    const raw = await fs.readFile(PRIZES_FILE, 'utf8');
    const data = JSON.parse(raw || '{}');

    const defaults = defaultPrizes();

    return data && typeof data === 'object'
      ? {
        ...defaults,
        ...data,
        spin: {
          ...defaults.spin,
          ...(data.spin || {}),
        },
      }
      : defaults;
  } catch {
    return defaultPrizes();
  }
}

function randomInt(min, max) {
  const cleanMin = Number(min);
  const cleanMax = Number(max);

  const safeMin = Number.isFinite(cleanMin) ? cleanMin : 10;
  const safeMax = Number.isFinite(cleanMax) ? cleanMax : 100;

  const from = Math.min(safeMin, safeMax);
  const to = Math.max(safeMin, safeMax);

  return Math.floor(Math.random() * (to - from + 1)) + from;
}

function pickRandomItem(list) {
  const items = Array.isArray(list)
    ? list.map(clean).filter(Boolean)
    : [];

  if (items.length === 0) {
    return '';
  }

  const index = Math.floor(Math.random() * items.length);

  return items[index];
}

export async function rollSpinPrize() {
  const prizes = await readGamePrizes();
  const spin = prizes.spin || defaultPrizes().spin;

  if (spin.enabled !== true) {
    return {
      ok: false,
      type: 'disabled',
      message: 'Spin game is disabled.',
    };
  }

  const pointChance = Number(spin.pointChance) || 70;
  const itemChance = Number(spin.itemChance) || 20;
  const grandChance = Number(spin.grandChance) || 5;
  const nothingChance = Number(spin.nothingChance) || 5;

  const totalChance = Math.max(
    1,
    pointChance + itemChance + grandChance + nothingChance,
  );

  const roll = Math.random() * totalChance;

  if (roll < pointChance) {
    const points = randomInt(
      spin.minPoints,
      spin.maxPoints,
    );

    const prizeName = pickRandomItem(spin.pointPrizes) || '🎁 Lucky Gift';

    return {
      ok: true,
      type: 'points',
      points,
      prize: prizeName,
      cooldownSeconds: Number(spin.cooldownSeconds) || 900,
    };
  }

  if (roll < pointChance + itemChance) {
    const item = pickRandomItem(spin.items) || '🎁 Mystery Prize';

    return {
      ok: true,
      type: 'item',
      points: 0,
      prize: item,
      cooldownSeconds: Number(spin.cooldownSeconds) || 900,
    };
  }

  if (roll < pointChance + itemChance + grandChance) {
    const grandPoints = Number(spin.grandPoints) || 1000;

    return {
      ok: true,
      type: 'grand',
      points: grandPoints,
      prize: '🏆 Grand Treasure Chest',
      cooldownSeconds: Number(spin.cooldownSeconds) || 900,
    };
  }

  return {
    ok: true,
    type: 'nothing',
    points: 0,
    prize: '😅 Nothing',
    cooldownSeconds: Number(spin.cooldownSeconds) || 900,
  };
}

export async function getSpinCooldownSeconds() {
  const prizes = await readGamePrizes();

  return Number(prizes.spin?.cooldownSeconds) || 900;
}