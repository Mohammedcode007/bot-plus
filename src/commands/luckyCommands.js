import {
  clean,
  normalizeCommand,
  normalizeName,
} from '../utils/text.js';

import {
  addUserPoints,
  getUserAccess,
} from '../services/acl.service.js';

import {
  rollLuckyResult,
  getLuckyCooldownSeconds,
} from '../services/luckyGame.service.js';

const luckyCooldownMap = new Map();

function parseLuckyCommand(text) {
  const command = normalizeCommand(text);

  if (command === 'lucky') {
    return {
      isCommand: true,
      lang: 'en',
    };
  }

  if (command === 'حظ') {
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

async function checkLuckyCooldown(roomMessage) {
  const key = getCooldownKey(roomMessage);

  if (!key) {
    return {
      allowed: false,
      remainingMs: 0,
      reason: 'missing_user',
    };
  }

  const cooldownSeconds = await getLuckyCooldownSeconds();
  const cooldownMs = cooldownSeconds * 1000;

  const now = Date.now();
  const lastTime = luckyCooldownMap.get(key) || 0;
  const elapsed = now - lastTime;

  if (elapsed < cooldownMs) {
    return {
      allowed: false,
      remainingMs: cooldownMs - elapsed,
      reason: 'cooldown',
    };
  }

  luckyCooldownMap.set(key, now);

  return {
    allowed: true,
    remainingMs: 0,
    reason: '',
  };
}

function luckyIntro({
  playerName,
  lang,
}) {
  if (lang === 'ar') {
    return `🍀 ${playerName} جرّب حظه!`;
  }

  return `🍀 ${playerName} tried lucky!`;
}

function gotText({
  prize,
  lang,
}) {
  if (lang === 'ar') {
    return `حصلت على ${prize}`;
  }

  return `you got ${prize}`;
}

function pointsText({
  points,
  lang,
}) {
  if (lang === 'ar') {
    return `💰 نقاطك: ${points}`;
  }

  return `💰 your points: ${points}`;
}

function cooldownText({
  playerName,
  remainingMs,
  lang,
}) {
  if (lang === 'ar') {
    return `⏱️ ${playerName} انتظر ${formatDuration(remainingMs, 'ar')} قبل تجربة حظك مرة أخرى.`;
  }

  return `⏱️ ${playerName}, wait ${formatDuration(remainingMs, 'en')} before trying your luck again.`;
}

function identifyErrorText(lang) {
  if (lang === 'ar') {
    return '❌ لم أستطع تحديد اللاعب.';
  }

  return '❌ Could not identify player.';
}

function failedText({
  reason,
  lang,
}) {
  if (lang === 'ar') {
    return `❌ فشل أمر الحظ. السبب: ${reason}`;
  }

  return `❌ Lucky failed. Reason: ${reason}`;
}

export async function handleLuckyCommand({
  roomMessage,
  ws,
  targetRoomId,
  targetRoomName,
}) {
  const parsed = parseLuckyCommand(roomMessage.text);

  if (!parsed.isCommand) {
    return false;
  }

  const lang = parsed.lang;

  const playerKey = getPlayerKey(roomMessage);
  const username = clean(roomMessage.fromUsername);
  const userId = clean(roomMessage.fromUserId);
  const playerName = username || userId || 'User';

  if (!playerKey) {
    ws.sendRoomMessage(
      targetRoomId,
      identifyErrorText(lang),
      targetRoomName,
    );

    return true;
  }

  const cooldown = await checkLuckyCooldown(roomMessage);

  if (!cooldown.allowed) {
    if (cooldown.reason === 'cooldown') {
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

    ws.sendRoomMessage(
      targetRoomId,
      identifyErrorText(lang),
      targetRoomName,
    );

    return true;
  }

  const beforeAccess = await getUserAccess(playerKey);
  const currentPoints = Number(beforeAccess.points) || 0;

  const result = await rollLuckyResult(currentPoints);

  if (!result.ok) {
    ws.sendRoomMessage(
      targetRoomId,
      failedText({
        reason: result.message || result.type,
        lang,
      }),
      targetRoomName,
    );

    return true;
  }

  if (result.points !== 0) {
    await addUserPoints(
      playerKey,
      result.points,
    );
  }

  const afterAccess = await getUserAccess(playerKey);
  const finalPoints = Number(afterAccess.points) || 0;

  if (result.type === 'win') {
    ws.sendRoomMessage(
      targetRoomId,
      [
        luckyIntro({
          playerName,
          lang,
        }),
        gotText({
          prize: result.prize,
          lang,
        }),
        `📈 +${result.percent}%`,
        pointsText({
          points: finalPoints,
          lang,
        }),
      ].join('\n'),
      targetRoomName,
    );

    return true;
  }

  if (result.type === 'lose') {
    ws.sendRoomMessage(
      targetRoomId,
      [
        luckyIntro({
          playerName,
          lang,
        }),
        gotText({
          prize: result.prize,
          lang,
        }),
        `📉 -${result.percent}%`,
        pointsText({
          points: finalPoints,
          lang,
        }),
      ].join('\n'),
      targetRoomName,
    );

    return true;
  }

  ws.sendRoomMessage(
    targetRoomId,
    [
      luckyIntro({
        playerName,
        lang,
      }),
      gotText({
        prize: result.prize,
        lang,
      }),
      pointsText({
        points: finalPoints,
        lang,
      }),
    ].join('\n'),
    targetRoomName,
  );

  return true;
}