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
  rollSpinPrize,
  getSpinCooldownSeconds,
} from '../services/gamePrizes.service.js';

const spinCooldownMap = new Map();

function isSpinCommand(text) {
  return normalizeCommand(text) === '.s';
}

function isPointsCommand(text) {
  return normalizeCommand(text) === '.cc';
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

function formatDuration(ms) {
  const totalSeconds = Math.max(
    0,
    Math.ceil(ms / 1000),
  );

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

async function checkSpinCooldown(roomMessage) {
  const key = getCooldownKey(roomMessage);

  if (!key) {
    return {
      allowed: false,
      remainingMs: 0,
      reason: 'missing_user',
    };
  }

  const cooldownSeconds = await getSpinCooldownSeconds();
  const cooldownMs = cooldownSeconds * 1000;

  const now = Date.now();
  const lastTime = spinCooldownMap.get(key) || 0;
  const elapsed = now - lastTime;

  if (elapsed < cooldownMs) {
    return {
      allowed: false,
      remainingMs: cooldownMs - elapsed,
      reason: 'cooldown',
    };
  }

  spinCooldownMap.set(key, now);

  return {
    allowed: true,
    remainingMs: 0,
    reason: '',
  };
}

async function handlePointsCommand({
  roomMessage,
  ws,
  targetRoomId,
  targetRoomName,
}) {
  const playerKey = getPlayerKey(roomMessage);
  const username = clean(roomMessage.fromUsername);
  const userId = clean(roomMessage.fromUserId);
  const playerName = username || userId || 'User';

  if (!playerKey) {
    ws.sendRoomMessage(
      targetRoomId,
      '❌ Could not identify player.',
      targetRoomName,
    );

    return true;
  }

  const access = await getUserAccess(playerKey);

  ws.sendRoomMessage(
    targetRoomId,
    `💰 ${playerName} your points: ${access.points || 0}`,
    targetRoomName,
  );

  return true;
}

export async function handleGameCommand({
  roomMessage,
  ws,
  targetRoomId,
  targetRoomName,
}) {
  if (isPointsCommand(roomMessage.text)) {
    return await handlePointsCommand({
      roomMessage,
      ws,
      targetRoomId,
      targetRoomName,
    });
  }

  if (!isSpinCommand(roomMessage.text)) {
    return false;
  }

  const playerKey = getPlayerKey(roomMessage);
  const username = clean(roomMessage.fromUsername);
  const userId = clean(roomMessage.fromUserId);
  const playerName = username || userId || 'User';

  if (!playerKey) {
    ws.sendRoomMessage(
      targetRoomId,
      '❌ Could not identify player.',
      targetRoomName,
    );

    return true;
  }

  const cooldown = await checkSpinCooldown(roomMessage);

  if (!cooldown.allowed) {
    if (cooldown.reason === 'cooldown') {
      ws.sendRoomMessage(
        targetRoomId,
        `⏱️ ${playerName}, wait ${formatDuration(cooldown.remainingMs)} before spinning again.`,
        targetRoomName,
      );

      return true;
    }

    ws.sendRoomMessage(
      targetRoomId,
      '❌ Could not identify player.',
      targetRoomName,
    );

    return true;
  }

  const prize = await rollSpinPrize();

  if (!prize.ok) {
    ws.sendRoomMessage(
      targetRoomId,
      `❌ Spin failed. Reason: ${prize.message || prize.type}`,
      targetRoomName,
    );

    return true;
  }

  if (prize.type === 'points' || prize.type === 'grand') {
    await addUserPoints(
      playerKey,
      prize.points,
    );
  }

  const access = await getUserAccess(playerKey);

  ws.sendRoomMessage(
    targetRoomId,
    [
      `🎰 ${playerName} spun the wheel! you got ${prize.prize || '😅 Nothing'}`,
      `💰 your points: ${access.points || 0}`,
    ].join('\n'),
    targetRoomName,
  );

  return true;
}