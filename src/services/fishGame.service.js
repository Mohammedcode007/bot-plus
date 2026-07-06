import fs from 'fs/promises';
import path from 'path';

const FISH_FILE = path.resolve('data/fish-game.json');

function clean(value) { return String(value || '').trim(); }

function defaultFishSettings() {
  return {
    enabled: true,
    cooldownSeconds: 300,
    minPoints: 10,
    maxPoints: 180,
    pointChance: 45,
    itemChance: 35,
    loseChance: 10,
    nothingChance: 10,
    loseMinPercent: 5,
    loseMaxPercent: 25,
    items: [
      "🐟 Fish",
      "🐠 Golden Fish",
      "🦈 Shark",
      "🐙 Octopus",
      "🧜 Mermaid",
      "🦪 Pearl",
      "🏴‍☠️ Treasure Chest"
],
    losePrizes: [
      "🦈 Angry Shark",
      "🌊 Big Wave",
      "🪝 Broken Hook"
],
    nothingPrize: "🪸 Seaweed",
  };
}

async function ensureFishFile() {
  try { await fs.mkdir(path.dirname(FISH_FILE), { recursive: true }); await fs.access(FISH_FILE); }
  catch { await fs.writeFile(FISH_FILE, JSON.stringify(defaultFishSettings(), null, 2), 'utf8'); }
}

export async function readFishSettings() {
  await ensureFishFile();
  try {
    const raw = await fs.readFile(FISH_FILE, 'utf8');
    const data = JSON.parse(raw || '{}');
    const defaults = defaultFishSettings();
    return data && typeof data === 'object' ? { ...defaults, ...data } : defaults;
  } catch { return defaultFishSettings(); }
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

export async function getFishCooldownSeconds() {
  const settings = await readFishSettings();
  return Number(settings.cooldownSeconds) || 300;
}

export async function rollFishResult(currentPoints) {
  const settings = await readFishSettings();
  if (settings.enabled !== true) return { ok: false, type: 'disabled', points: 0, prize: '', message: 'Fish game is disabled.' };
  const pointChance = Number(settings.pointChance) || 45;
  const itemChance = Number(settings.itemChance) || 35;
  const loseChance = Number(settings.loseChance) || 10;
  const nothingChance = Number(settings.nothingChance) || 10;
  const totalChance = Math.max(1, pointChance + itemChance + loseChance + nothingChance);
  const roll = Math.random() * totalChance;
  if (roll < pointChance) return { ok: true, type: 'points', points: randomInt(settings.minPoints, settings.maxPoints), prize: pickRandomItem(settings.items, '🐟 Fish') };
  if (roll < pointChance + itemChance) return { ok: true, type: 'item', points: 0, prize: pickRandomItem(settings.items, '🐟 Fish') };
  if (roll < pointChance + itemChance + loseChance) {
    const safePoints = Math.max(0, Number(currentPoints) || 0);
    const percent = randomInt(settings.loseMinPercent, settings.loseMaxPercent);
    const loss = Math.min(safePoints, Math.max(1, Math.floor((safePoints * percent) / 100)));
    return { ok: true, type: 'lose', points: -loss, percent, prize: pickRandomItem(settings.losePrizes, '💥 Bad Luck') };
  }
  return { ok: true, type: 'nothing', points: 0, prize: clean(settings.nothingPrize) || '🪸 Seaweed' };
}
