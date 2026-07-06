import fs from 'fs/promises';
import path from 'path';

const INVESTMENT_FILE = path.resolve('data/investment-game.json');

function clean(value) {
  return String(value || '').trim();
}

function defaultInvestmentSettings() {
  return {
    enabled: true,
    cooldownSeconds: 300,

    winChance: 40,
    loseChance: 60,

    minInvestPoints: 10,
    maxInvestPoints: 1000000,

    minWinPercent: 20,
    maxWinPercent: 100,

    minLosePercent: 20,
    maxLosePercent: 100,

    winPrizes: [
      '📈 Successful Investment',
      '💹 Market Win',
      '🏦 Bank Profit',
      '💎 Smart Deal',
      '🚀 Big Growth',
    ],

    losePrizes: [
      '📉 Failed Investment',
      '💸 Market Loss',
      '🏚️ Bad Deal',
      '🔥 Risk Failed',
      '🕳️ Money Trap',
    ],
  };
}

async function ensureInvestmentFile() {
  try {
    await fs.mkdir(path.dirname(INVESTMENT_FILE), {
      recursive: true,
    });

    await fs.access(INVESTMENT_FILE);
  } catch {
    await fs.writeFile(
      INVESTMENT_FILE,
      JSON.stringify(defaultInvestmentSettings(), null, 2),
      'utf8',
    );
  }
}

export async function readInvestmentSettings() {
  await ensureInvestmentFile();

  try {
    const raw = await fs.readFile(INVESTMENT_FILE, 'utf8');
    const data = JSON.parse(raw || '{}');
    const defaults = defaultInvestmentSettings();

    return data && typeof data === 'object'
      ? {
        ...defaults,
        ...data,
      }
      : defaults;
  } catch {
    return defaultInvestmentSettings();
  }
}

function randomInt(min, max) {
  const cleanMin = Number(min);
  const cleanMax = Number(max);

  const safeMin = Number.isFinite(cleanMin) ? cleanMin : 1;
  const safeMax = Number.isFinite(cleanMax) ? cleanMax : 100;

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

export async function getInvestmentCooldownSeconds() {
  const settings = await readInvestmentSettings();

  return Number(settings.cooldownSeconds) || 300;
}

export async function rollInvestmentResult({
  currentPoints,
  investPoints,
}) {
  const settings = await readInvestmentSettings();

  if (settings.enabled !== true) {
    return {
      ok: false,
      type: 'disabled',
      points: 0,
      percent: 0,
      prize: '',
      message: 'Investment game is disabled.',
    };
  }

  const safeCurrentPoints = Math.max(
    0,
    Number(currentPoints) || 0,
  );

  const safeInvestPoints = Math.max(
    0,
    Number(investPoints) || 0,
  );

  const minInvestPoints = Math.max(
    1,
    Number(settings.minInvestPoints) || 10,
  );

  const maxInvestPoints = Math.max(
    minInvestPoints,
    Number(settings.maxInvestPoints) || 1000000,
  );

  if (safeInvestPoints < minInvestPoints) {
    return {
      ok: false,
      type: 'min_invest',
      points: 0,
      percent: 0,
      prize: '',
      message: `Minimum investment is ${minInvestPoints} points.`,
    };
  }

  if (safeInvestPoints > maxInvestPoints) {
    return {
      ok: false,
      type: 'max_invest',
      points: 0,
      percent: 0,
      prize: '',
      message: `Maximum investment is ${maxInvestPoints} points.`,
    };
  }

  if (safeInvestPoints > safeCurrentPoints) {
    return {
      ok: false,
      type: 'not_enough_points',
      points: 0,
      percent: 0,
      prize: '',
      message: 'Not enough points.',
    };
  }

  const winChance = Number(settings.winChance) || 40;
  const loseChance = Number(settings.loseChance) || 60;

  const totalChance = Math.max(
    1,
    winChance + loseChance,
  );

  const roll = Math.random() * totalChance;

  /*
    الخسارة أولًا حتى تكون نسبتها واضحة.
    default:
    60% lose
    40% win
  */
  if (roll < loseChance) {
    const percent = randomInt(
      Number(settings.minLosePercent) || 20,
      Number(settings.maxLosePercent) || 100,
    );

    const lossPoints = Math.max(
      1,
      Math.floor((safeInvestPoints * percent) / 100),
    );

    return {
      ok: true,
      type: 'lose',
      points: -Math.min(safeCurrentPoints, lossPoints),
      percent,
      prize: pickRandomItem(
        settings.losePrizes,
        '📉 Failed Investment',
      ),
    };
  }

  const percent = randomInt(
    Number(settings.minWinPercent) || 20,
    Number(settings.maxWinPercent) || 100,
  );

  const winPoints = Math.max(
    1,
    Math.floor((safeInvestPoints * percent) / 100),
  );

  return {
    ok: true,
    type: 'win',
    points: winPoints,
    percent,
    prize: pickRandomItem(
      settings.winPrizes,
      '📈 Successful Investment',
    ),
  };
}