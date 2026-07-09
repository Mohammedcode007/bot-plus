import fs from 'fs/promises';
import path from 'path';

const BRIBE_FILE = path.resolve('data/bribe-game.json');

function clean(value) {
  return String(value || '').trim();
}

function defaultBribeSettings() {
  return {
    enabled: true,
    cooldownSeconds: 300,

    successChance: 35,
    failChance: 35,
    arrestedChance: 20,
    nothingChance: 10,

    minPercent: 5,
    maxPercent: 20,
    minChangePoints: 1,

    arrestExtraPercent: 10,

    successTexts: [
      '💸 الرشوة عدّت بسلام',
      '🤝 الموظف ابتسم وقال: عدي يا باشا',
      '🤑 العملية تمت بنجاح تحت الترابيزة',
      '📄 الورق خلص بسرعة مشبوهة',
      '🚪 الباب اتفتح بدون أسئلة'
    ],

    failTexts: [
      '😒 الرشوة اترفضت',
      '🙄 الموظف قالك: مش أنا النوع ده',
      '💔 الفلوس راحت ومفيش خدمة',
      '🧾 اتقالك: ناقصك ختم من الدور السابع',
      '😑 حاولت ترشي الشخص الغلط'
    ],

    arrestedTexts: [
      '🚔 تم القبض عليك متلبسًا',
      '👮 الكمين كان مستنيك',
      '🚨 الرشوة طلعت فخ محترم',
      '⛓️ اتقفشت والفلوس اتصادرت',
      '📸 الكاميرات جابتك بالصوت والصورة'
    ],

    nothingTexts: [
      '😐 محدش فهم أنت عايز إيه',
      '🍃 الرشوة طارت في الهوا',
      '🕵️ الموظف اختفى فجأة',
      '🤷 الموضوع اتقفل بدون نتيجة',
      '🪙 الفلوس وقعت منك ومحدش شافها'
    ],
  };
}

async function ensureBribeFile() {
  try {
    await fs.mkdir(path.dirname(BRIBE_FILE), {
      recursive: true,
    });

    await fs.access(BRIBE_FILE);
  } catch {
    await fs.writeFile(
      BRIBE_FILE,
      JSON.stringify(defaultBribeSettings(), null, 2),
      'utf8',
    );
  }
}

export async function readBribeSettings() {
  await ensureBribeFile();

  try {
    const raw = await fs.readFile(BRIBE_FILE, 'utf8');
    const data = JSON.parse(raw || '{}');
    const defaults = defaultBribeSettings();

    return data && typeof data === 'object'
      ? {
        ...defaults,
        ...data,
      }
      : defaults;
  } catch {
    return defaultBribeSettings();
  }
}

function randomInt(min, max) {
  const cleanMin = Number(min);
  const cleanMax = Number(max);

  const safeMin = Number.isFinite(cleanMin) ? cleanMin : 5;
  const safeMax = Number.isFinite(cleanMax) ? cleanMax : 20;

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

export async function getBribeCooldownSeconds() {
  const settings = await readBribeSettings();

  return Number(settings.cooldownSeconds) || 300;
}

export async function rollBribeResult(currentPoints) {
  const settings = await readBribeSettings();

  if (settings.enabled !== true) {
    return {
      ok: false,
      type: 'disabled',
      points: 0,
      percent: 0,
      text: '',
      message: 'Bribe game is disabled.',
    };
  }

  const safePoints = Math.max(
    0,
    Number(currentPoints) || 0,
  );

  const successChance = Number(settings.successChance) || 35;
  const failChance = Number(settings.failChance) || 35;
  const arrestedChance = Number(settings.arrestedChance) || 20;
  const nothingChance = Number(settings.nothingChance) || 10;

  const totalChance = Math.max(
    1,
    successChance + failChance + arrestedChance + nothingChance,
  );

  const roll = Math.random() * totalChance;

  const percent = randomInt(
    Number(settings.minPercent) || 5,
    Number(settings.maxPercent) || 20,
  );

  const minChangePoints = Math.max(
    1,
    Number(settings.minChangePoints) || 1,
  );

  const calculatedPoints = Math.max(
    minChangePoints,
    Math.floor((safePoints * percent) / 100),
  );

  if (roll < successChance) {
    return {
      ok: true,
      type: 'success',
      points: calculatedPoints,
      percent,
      text: pickRandomItem(
        settings.successTexts,
        '💸 الرشوة عدّت بسلام',
      ),
    };
  }

  if (roll < successChance + failChance) {
    const lossPoints = Math.min(
      safePoints,
      calculatedPoints,
    );

    return {
      ok: true,
      type: 'fail',
      points: -lossPoints,
      percent,
      text: pickRandomItem(
        settings.failTexts,
        '😒 الرشوة اترفضت',
      ),
    };
  }

  if (roll < successChance + failChance + arrestedChance) {
    const extraPercent = Math.max(
      0,
      Number(settings.arrestExtraPercent) || 10,
    );

    const arrestPercent = percent + extraPercent;

    const arrestPoints = Math.max(
      minChangePoints,
      Math.floor((safePoints * arrestPercent) / 100),
    );

    const lossPoints = Math.min(
      safePoints,
      arrestPoints,
    );

    return {
      ok: true,
      type: 'arrested',
      points: -lossPoints,
      percent: arrestPercent,
      text: pickRandomItem(
        settings.arrestedTexts,
        '🚔 تم القبض عليك متلبسًا',
      ),
    };
  }

  return {
    ok: true,
    type: 'nothing',
    points: 0,
    percent: 0,
    text: pickRandomItem(
      settings.nothingTexts,
      '😐 محدش فهم أنت عايز إيه',
    ),
  };
}