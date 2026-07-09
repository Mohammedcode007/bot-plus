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
  findFunGameByCommand,
  getFunGamesCooldownSeconds,
  rollFunGameResult,
} from '../services/funGames.service.js';

const funGamesCooldownMap = new Map();

function getPlayerKey(roomMessage) {
  return clean(roomMessage.fromUsername) ||
    clean(roomMessage.fromUserId) ||
    '';
}

function getCooldownKey(roomMessage) {
  return clean(roomMessage.fromUserId) ||
    normalizeName(roomMessage.fromUsername);
}

function formatDuration(ms) {
  const totalSeconds = Math.max(
    0,
    Math.ceil(ms / 1000),
  );

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds} ثانية`;
  }

  return `${minutes} دقيقة و ${seconds} ثانية`;
}

async function checkFunGameCooldown(roomMessage) {
  const key = getCooldownKey(roomMessage);

  if (!key) {
    return {
      allowed: false,
      remainingMs: 0,
      reason: 'missing_user',
    };
  }

  const cooldownSeconds = await getFunGamesCooldownSeconds();
  const cooldownMs = cooldownSeconds * 1000;

  const now = Date.now();
  const lastTime = funGamesCooldownMap.get(key) || 0;
  const elapsed = now - lastTime;

  if (elapsed < cooldownMs) {
    return {
      allowed: false,
      remainingMs: cooldownMs - elapsed,
      reason: 'cooldown',
    };
  }

  funGamesCooldownMap.set(key, now);

  return {
    allowed: true,
    remainingMs: 0,
    reason: '',
  };
}

function introText({
  playerName,
  game,
}) {
  const title = clean(game.title) || '🎮 لعبة';
  const intro = clean(game.intro) || 'بدأ المحاولة...';

  return `${title}\n${playerName} ${intro}`;
}

function pointsText(points) {
  return `💰 نقاطك: ${points}`;
}

function cooldownText({
  playerName,
  remainingMs,
}) {
  return `⏱️ ${playerName} انتظر ${formatDuration(remainingMs)} قبل اللعب مرة أخرى.`;
}

function identifyErrorText() {
  return '❌ لم أستطع تحديد اللاعب.';
}

function failedText(reason) {
  return `❌ فشل تنفيذ اللعبة. السبب: ${reason}`;
}

function resultText(result) {
  if (result.type === 'success') {
    return [
      result.text,
      `📈 +${result.percent}%`,
    ].join('\n');
  }

  if (result.type === 'fail') {
    return [
      result.text,
      `📉 -${result.percent}%`,
    ].join('\n');
  }

  if (result.type === 'disaster') {
    return [
      result.text,
      `🚨 غرامة -${result.percent}%`,
    ].join('\n');
  }

  return result.text;
}

export async function handleFunGamesCommand({
  roomMessage,
  ws,
  targetRoomId,
  targetRoomName,
}) {
  const command = normalizeCommand(roomMessage.text);

  const found = await findFunGameByCommand(command);

  if (!found.ok) {
    if (found.reason === 'disabled') {
      return false;
    }

    return false;
  }

  const game = found.game;

  const playerKey = getPlayerKey(roomMessage);
  const username = clean(roomMessage.fromUsername);
  const userId = clean(roomMessage.fromUserId);
  const playerName = username || userId || 'User';

  if (!playerKey) {
    ws.sendRoomMessage(
      targetRoomId,
      identifyErrorText(),
      targetRoomName,
    );

    return true;
  }

  const cooldown = await checkFunGameCooldown(roomMessage);

  if (!cooldown.allowed) {
    if (cooldown.reason === 'cooldown') {
      ws.sendRoomMessage(
        targetRoomId,
        cooldownText({
          playerName,
          remainingMs: cooldown.remainingMs,
        }),
        targetRoomName,
      );

      return true;
    }

    ws.sendRoomMessage(
      targetRoomId,
      identifyErrorText(),
      targetRoomName,
    );

    return true;
  }

  const beforeAccess = await getUserAccess(playerKey);
  const currentPoints = Number(beforeAccess.points) || 0;

  const result = await rollFunGameResult({
    game,
    currentPoints,
  });

  if (!result.ok) {
    ws.sendRoomMessage(
      targetRoomId,
      failedText(result.message || result.type),
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

  ws.sendRoomMessage(
    targetRoomId,
    [
      introText({
        playerName,
        game,
      }),
      resultText(result),
      pointsText(finalPoints),
    ].join('\n'),
    targetRoomName,
  );

  return true;
}