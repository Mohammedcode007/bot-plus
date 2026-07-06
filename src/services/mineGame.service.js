import fs from 'fs/promises';
import path from 'path';

const MINE_FILE = path.resolve('data/mine-game.json');

function clean(value) { return String(value || '').trim(); }

function defaultMineSettings() {
  return {
    enabled: true,
    cooldownSeconds: 300,
    minPoints: 10,
    maxPoints: 200,
    pointChance: 50,
    itemChance: 30,
    loseChance: 15,
    nothingChance: 5,
    loseMinPercent: 5,
    loseMaxPercent: 25,
    items: [
      "💎 Diamond",
      "🪙 Gold",
      "🪨 Rare Stone",
      "🔮 Magic Ore",
      "👑 Ancient Crown",
      "🐉 Dragon Egg",
      "🔥 Lava Crystal"
],
    losePrizes: [
      "🧟 Cave Monster",
      "💥 Mine Explosion",
      "🕳️ Deep Hole"
],
    nothingPrize: "🪨 Stone",
  };
}

async function ensureMineFile() {
  try { await fs.mkdir(path.dirname(MINE_FILE), { recursive: true }); await fs.access(MINE_FILE); }
  catch { await fs.writeFile(MINE_FILE, JSON.stringify(defaultMineSettings(), null, 2), 'utf8'); }
}

export async function readMineSettings() {
  await ensureMineFile();
  try {
    const raw = await fs.readFile(MINE_FILE, 'utf8');
    const data = JSON.parse(raw || '{}');
    const defaults = defaultMineSettings();
    return data && typeof data === 'object' ? { ...defaults, ...data } : defaults;
  } catch { return defaultMineSettings(); }
}

function randomInt(min, max) {
  const from = Math.min(Number(min) || 0, Number(max) || 0);
  const to = Math.max(Number(min) || 0, Number(max) || 0);
  return Math.floor(Math.random() * (to - from + 1)) + from;
}

function pickRandomItem(list, fallback) {
  const items = Array.isArray(list) ? list.map(clean).filter(Boolean) : [];
  if (items.length === 0) return fallback;
  return items[Math.floor(Math.random() * items.length)];
}

export async function getMineCooldownSeconds() {
  const settings = await readMineSettings();
  return Number(settings.cooldownSeconds) || 300;
}

export async function rollMineResult(currentPoints) {
  const settings = await readMineSettings();
  if (settings.enabled !== true) return { ok: false, type: 'disabled', points: 0, prize: '', message: 'Mine game is disabled.' };
  const pointChance = Number(settings.pointChance) || 50;
  const itemChance = Number(settings.itemChance) || 30;
  const loseChance = Number(settings.loseChance) || 15;
  const nothingChance = Number(settings.nothingChance) || 5;
  const totalChance = Math.max(1, pointChance + itemChance + loseChance + nothingChance);
  const roll = Math.random() * totalChance;
  if (roll < pointChance) return { ok: true, type: 'points', points: randomInt(settings.minPoints, settings.maxPoints), prize: pickRandomItem(settings.items, '💎 Diamond') };
  if (roll < pointChance + itemChance) return { ok: true, type: 'item', points: 0, prize: pickRandomItem(settings.items, '💎 Diamond') };
  if (roll < pointChance + itemChance + loseChance) {
    const safePoints = Math.max(0, Number(currentPoints) || 0);
    const percent = randomInt(settings.loseMinPercent, settings.loseMaxPercent);
    const loss = Math.min(safePoints, Math.max(1, Math.floor((safePoints * percent) / 100)));
    return { ok: true, type: 'lose', points: -loss, percent, prize: pickRandomItem(settings.losePrizes, '💥 Bad Luck') };
  }
  return { ok: true, type: 'nothing', points: 0, prize: clean(settings.nothingPrize) || '🪨 Stone' };
}
