import fs from 'fs/promises';
import path from 'path';

const BOX_FILE = path.resolve('data/box-game.json');

function clean(value) { return String(value || '').trim(); }

function defaultBoxSettings() {
  return {
    enabled: true,
    cooldownSeconds: 300,
    minPoints: 10,
    maxPoints: 250,
    pointChance: 55,
    itemChance: 30,
    loseChance: 10,
    nothingChance: 5,
    loseMinPercent: 5,
    loseMaxPercent: 25,
    items: [
      "📦 Golden Box",
      "💎 Diamond Box",
      "🐉 Dragon Box",
      "👑 Royal Box",
      "🚀 Rocket Box",
      "🏝️ Island Box",
      "🛡️ Shield Box",
      "🔮 Magic Box"
],
    losePrizes: [
      "💣 Bomb Box",
      "🕳️ Empty Trap",
      "🔥 Burned Box"
],
    nothingPrize: "📭 Empty Box",
  };
}

async function ensureBoxFile() {
  try { await fs.mkdir(path.dirname(BOX_FILE), { recursive: true }); await fs.access(BOX_FILE); }
  catch { await fs.writeFile(BOX_FILE, JSON.stringify(defaultBoxSettings(), null, 2), 'utf8'); }
}

export async function readBoxSettings() {
  await ensureBoxFile();
  try {
    const raw = await fs.readFile(BOX_FILE, 'utf8');
    const data = JSON.parse(raw || '{}');
    const defaults = defaultBoxSettings();
    return data && typeof data === 'object' ? { ...defaults, ...data } : defaults;
  } catch { return defaultBoxSettings(); }
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

export async function getBoxCooldownSeconds() {
  const settings = await readBoxSettings();
  return Number(settings.cooldownSeconds) || 300;
}

export async function rollBoxResult(currentPoints) {
  const settings = await readBoxSettings();
  if (settings.enabled !== true) return { ok: false, type: 'disabled', points: 0, prize: '', message: 'Box game is disabled.' };
  const pointChance = Number(settings.pointChance) || 55;
  const itemChance = Number(settings.itemChance) || 30;
  const loseChance = Number(settings.loseChance) || 10;
  const nothingChance = Number(settings.nothingChance) || 5;
  const totalChance = Math.max(1, pointChance + itemChance + loseChance + nothingChance);
  const roll = Math.random() * totalChance;
  if (roll < pointChance) return { ok: true, type: 'points', points: randomInt(settings.minPoints, settings.maxPoints), prize: pickRandomItem(settings.items, '📦 Golden Box') };
  if (roll < pointChance + itemChance) return { ok: true, type: 'item', points: 0, prize: pickRandomItem(settings.items, '📦 Golden Box') };
  if (roll < pointChance + itemChance + loseChance) {
    const safePoints = Math.max(0, Number(currentPoints) || 0);
    const percent = randomInt(settings.loseMinPercent, settings.loseMaxPercent);
    const loss = Math.min(safePoints, Math.max(1, Math.floor((safePoints * percent) / 100)));
    return { ok: true, type: 'lose', points: -loss, percent, prize: pickRandomItem(settings.losePrizes, '💥 Bad Luck') };
  }
  return { ok: true, type: 'nothing', points: 0, prize: clean(settings.nothingPrize) || '📭 Empty Box' };
}
