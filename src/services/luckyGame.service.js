import fs from 'fs/promises';
import path from 'path';

const LUCKY_FILE = path.resolve('data/lucky-game.json');

function clean(value) {
  return String(value || '').trim();
}

function defaultLuckySettings() {
  return {
    enabled: true,
    cooldownSeconds: 300,

    winChance: 30,
    loseChance: 60,
    nothingChance: 10,

    minPercent: 5,
    maxPercent: 25,
    minChangePoints: 1,

    winPrizes: [
      '🍀 Good Luck',
      '💚 Lucky Clover',
      '🌟 Lucky Star',
      '💎 Lucky Diamond',
      '👑 Lucky Crown',
    ],

    losePrizes: [
      '💔 Bad Luck',
      '🌧️ Dark Cloud',
      '🕳️ Black Hole',
      '🧨 Bad Bomb',
      '🥀 Broken Rose',
    ],

    nothingPrizes: [
      '😐 Nothing Happened',
      '🍃 Empty Wind',
      '🪶 Light Feather',
    ],
  };
}

async function ensureLuckyFile() {
  try {
    await fs.mkdir(path.dirname(LUCKY_FILE), {
      recursive: true,
    });

    await fs.access(LUCKY_FILE);
  } catch {
    await fs.writeFile(
      LUCKY_FILE,
      JSON.stringify(defaultLuckySettings(), null, 2),
      'utf8',
    );
  }
}

export async function readLuckySettings() {
  await ensureLuckyFile();

  try {
    const raw = await fs.readFile(LUCKY_FILE, 'utf8');
    const data = JSON.parse(raw || '{}');
    const defaults = defaultLuckySettings();

    return data && typeof data === 'object'
      ? {
        ...defaults,
        ...data,
      }
      : defaults;
  } catch {
    return defaultLuckySettings();
  }
}

function randomInt(min, max) {
  const cleanMin = Number(min);
  const cleanMax = Number(max);

  const safeMin = Number.isFinite(cleanMin) ? cleanMin : 5;
  const safeMax = Number.isFinite(cleanMax) ? cleanMax : 25;

  const from = Math.min(safeMin, safeMax);
  const to = Math.max(safeMin, safeMax);

  return Math.floor(Math.random() * (to - from + 1)) + from;
}

function pickRandomItem(list, fallback) {
  const items = Array.isArray(list)
    ? list.map(clean).filter(Boolean)
    : [];

  if (items.length === 0) {
    return fallback;
  }

  const index = Math.floor(Math.random() * items.length);

  return items[index];
}

export async function getLuckyCooldownSeconds() {
  const settings = await readLuckySettings();

  return Number(settings.cooldownSeconds) || 300;
}

export async function rollLuckyResult(currentPoints) {
  const settings = await readLuckySettings();

  if (settings.enabled !== true) {
    return {
      ok: false,
      type: 'disabled',
      points: 0,
      percent: 0,
      prize: '',
      message: 'Lucky game is disabled.',
    };
  }

  const safePoints = Math.max(
    0,
    Number(currentPoints) || 0,
  );

  const winChance = Number(settings.winChance) || 30;
  const loseChance = Number(settings.loseChance) || 60;
  const nothingChance = Number(settings.nothingChance) || 10;

  const totalChance = Math.max(
    1,
    winChance + loseChance + nothingChance,
  );

  const roll = Math.random() * totalChance;

  const percent = randomInt(
    Number(settings.minPercent) || 5,
    Number(settings.maxPercent) || 25,
  );

  const minChangePoints = Math.max(
    1,
    Number(settings.minChangePoints) || 1,
  );

  const calculatedPoints = Math.max(
    minChangePoints,
    Math.floor((safePoints * percent) / 100),
  );

  /*
    60% خسارة.
  */
  if (roll < loseChance) {
    const lossPoints = Math.min(
      safePoints,
      calculatedPoints,
    );

    return {
      ok: true,
      type: 'lose',
      points: -lossPoints,
      percent,
      prize: pickRandomItem(
        settings.losePrizes,
        '💔 Bad Luck',
      ),
    };
  }

  /*
    30% مكسب.
  */
  if (roll < loseChance + winChance) {
    return {
      ok: true,
      type: 'win',
      points: calculatedPoints,
      percent,
      prize: pickRandomItem(
        settings.winPrizes,
        '🍀 Good Luck',
      ),
    };
  }

  /*
    10% لا شيء.
  */
  return {
    ok: true,
    type: 'nothing',
    points: 0,
    percent: 0,
    prize: pickRandomItem(
      settings.nothingPrizes,
      '😐 Nothing Happened',
    ),
  };
}