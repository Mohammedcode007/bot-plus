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
  rollBribeResult,
  getBribeCooldownSeconds,
} from '../services/bribeGame.service.js';

const bribeCooldownMap = new Map();

function parseBribeCommand(text) {
  const command = normalizeCommand(text);

  if (
    command === 'رشوة' ||
    command === 'رشوه'
  ) {
    return {
      isCommand: true,
    };
  }

  return {
    isCommand: false,
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

async function checkBribeCooldown(roomMessage) {
  const key = getCooldownKey(roomMessage);

  if (!key) {
    return {
      allowed: false,
      remainingMs: 0,
      reason: 'missing_user',
    };
  }

  const cooldownSeconds = await getBribeCooldownSeconds();
  const cooldownMs = cooldownSeconds * 1000;

  const now = Date.now();
  const lastTime = bribeCooldownMap.get(key) || 0;
  const elapsed = now - lastTime;

  if (elapsed < cooldownMs) {
    return {
      allowed: false,
      remainingMs: cooldownMs - elapsed,
      reason: 'cooldown',
    };
  }

  bribeCooldownMap.set(key, now);

  return {
    allowed: true,
    remainingMs: 0,
    reason: '',
  };
}

function introText(playerName) {
  return `💸 ${playerName} حاول يدفع رشوة...`;
}

function pointsText(points) {
  return `💰 نقاطك: ${points}`;
}

function cooldownText({
  playerName,
  remainingMs,
}) {
  return `⏱️ ${playerName} انتظر ${formatDuration(remainingMs)} قبل محاولة الرشوة مرة أخرى.`;
}

function identifyErrorText() {
  return '❌ لم أستطع تحديد اللاعب.';
}

function failedText(reason) {
  return `❌ فشل أمر الرشوة. السبب: ${reason}`;
}

function resultLine(result) {
  if (result.type === 'success') {
    return `✅ نجحت الرشوة\n${result.text}\n📈 +${result.percent}%`;
  }

  if (result.type === 'fail') {
    return `❌ خسرت الرشوة\n${result.text}\n📉 -${result.percent}%`;
  }

  if (result.type === 'arrested') {
    return `🚔 تم القبض عليك\n${result.text}\n📉 غرامة -${result.percent}%`;
  }

  return `😐 لا شيء حدث\n${result.text}`;
}

export async function handleBribeCommand({
  roomMessage,
  ws,
  targetRoomId,
  targetRoomName,
}) {
  const parsed = parseBribeCommand(roomMessage.text);

  if (!parsed.isCommand) {
    return false;
  }

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

  const cooldown = await checkBribeCooldown(roomMessage);

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

  const result = await rollBribeResult(currentPoints);

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
      introText(playerName),
      resultLine(result),
      pointsText(finalPoints),
    ].join('\n'),
    targetRoomName,
  );

  return true;
}