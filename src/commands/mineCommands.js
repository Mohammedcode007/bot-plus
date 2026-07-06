import {
  clean,
  normalizeCommand,
  normalizeName,
} from '../utils/text.js';

import {
  getUserPoints,
  changeUserPoints,
} from '../services/gamePoints.service.js';

import {
  rollMineResult,
  getMineCooldownSeconds,
} from '../services/mineGame.service.js';

const mineCooldownMap = new Map();

function parseMineCommand(text) {
  const command = normalizeCommand(text);

  if (command === 'mine') {
    return {
      isCommand: true,
      lang: 'en',
    };
  }

  if (command === 'تعدين') {
    return {
      isCommand: true,
      lang: 'ar',
    };
  }

  return {
    isCommand: false,
    lang: 'en',
  };
}

function getPlayerKey(roomMessage) {
  return clean(roomMessage.fromUsername) ||
    clean(roomMessage.fromUserId) ||
    '';
}

function getCooldownKey(roomMessage) {
  return clean(roomMessage.fromUserId) ||
    normalizeName(roomMessage.fromUsername);
}

function formatDuration(ms, lang = 'en') {
  const totalSeconds = Math.max(
    0,
    Math.ceil(ms / 1000),
  );

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (lang === 'ar') {
    if (minutes <= 0) {
      return `${seconds} ثانية`;
    }

    return `${minutes} دقيقة و ${seconds} ثانية`;
  }

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

async function checkCooldown(roomMessage) {
  const key = getCooldownKey(roomMessage);

  if (!key) {
    return {
      allowed: false,
      remainingMs: 0,
      reason: 'missing_user',
    };
  }

  const cooldownMs = (await getMineCooldownSeconds()) * 1000;

  const now = Date.now();
  const lastTime = mineCooldownMap.get(key) || 0;
  const elapsed = now - lastTime;

  if (elapsed < cooldownMs) {
    return {
      allowed: false,
      remainingMs: cooldownMs - elapsed,
      reason: 'cooldown',
    };
  }

  mineCooldownMap.set(key, now);

  return {
    allowed: true,
    remainingMs: 0,
    reason: '',
  };
}

function cooldownText({
  playerName,
  remainingMs,
  lang,
}) {
  if (lang === 'ar') {
    return `⏱️ ${playerName} انتظر ${formatDuration(remainingMs, 'ar')} قبل التعدين مرة أخرى.`;
  }

  return `⏱️ ${playerName}, wait ${formatDuration(remainingMs, 'en')} before mining again.`;
}

export async function handleMineCommand({
  roomMessage,
  ws,
  targetRoomId,
  targetRoomName,
}) {
  const parsed = parseMineCommand(roomMessage.text);

  if (!parsed.isCommand) {
    return false;
  }

  const lang = parsed.lang;

  const playerKey = getPlayerKey(roomMessage);
  const playerName = clean(roomMessage.fromUsername) ||
    clean(roomMessage.fromUserId) ||
    'User';

  if (!playerKey) {
    ws.sendRoomMessage(
      targetRoomId,
      lang === 'ar'
        ? '❌ لم أستطع تحديد اللاعب.'
        : '❌ Could not identify player.',
      targetRoomName,
    );

    return true;
  }

  const cooldown = await checkCooldown(roomMessage);

  if (!cooldown.allowed) {
    ws.sendRoomMessage(
      targetRoomId,
      cooldownText({
        playerName,
        remainingMs: cooldown.remainingMs,
        lang,
      }),
      targetRoomName,
    );

    return true;
  }

  const currentPoints = await getUserPoints(playerKey);
  const result = await rollMineResult(currentPoints);

  if (!result.ok) {
    ws.sendRoomMessage(
      targetRoomId,
      lang === 'ar'
        ? `❌ فشل التعدين. السبب: ${result.message || result.type}`
        : `❌ Mining failed. Reason: ${result.message || result.type}`,
      targetRoomName,
    );

    return true;
  }

  if (result.points !== 0) {
    await changeUserPoints(
      playerKey,
      result.points,
    );
  }

  const finalPoints = await getUserPoints(playerKey);

  if (lang === 'ar') {
    ws.sendRoomMessage(
      targetRoomId,
      [
        `⛏️ ${playerName} بدأ التعدين!`,
        `وجدت ${result.prize}`,
        `💰 نقاطك: ${finalPoints}`,
      ].join('\n'),
      targetRoomName,
    );

    return true;
  }

  ws.sendRoomMessage(
    targetRoomId,
    [
      `⛏️ ${playerName} started mining!`,
      `you found ${result.prize}`,
      `💰 your points: ${finalPoints}`,
    ].join('\n'),
    targetRoomName,
  );

  return true;
}