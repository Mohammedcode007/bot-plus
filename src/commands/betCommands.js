import {
  clean,
  normalizeCommand,
  normalizeName,
} from '../utils/text.js';

import {
  getUserPoints,
  changeUserPoints,
  readAclStoreForGames,
} from '../services/gamePoints.service.js';

import {
  rollBetResult,
  getBetCooldownSeconds,
} from '../services/betGame.service.js';

const betCooldownMap = new Map();

function parseBetCommand(text) {
  const raw = clean(text);

  /*
    English:
    bet@ahmed@100
    bet ahmed 100
    bet @ahmed 100
  */
  const enMatch = raw.match(/^bet\s*@?\s*([^@\s]+)\s*@?\s*(\d+)$/i);

  if (enMatch) {
    return {
      isCommand: true,
      lang: 'en',
      targetUsername: clean(enMatch[1]).replace(/^@/, ''),
      amount: Math.floor(Number(enMatch[2]) || 0),
    };
  }

  /*
    Arabic:
    رهان@ahmed@100
    رهان ahmed 100
    رهان @ahmed 100
  */
  const arMatch = raw.match(/^رهان\s*@?\s*([^@\s]+)\s*@?\s*(\d+)$/i);

  if (arMatch) {
    return {
      isCommand: true,
      lang: 'ar',
      targetUsername: clean(arMatch[1]).replace(/^@/, ''),
      amount: Math.floor(Number(arMatch[2]) || 0),
    };
  }

  const command = normalizeCommand(raw);

  if (command === 'bet') {
    return {
      isCommand: true,
      lang: 'en',
      targetUsername: '',
      amount: 0,
    };
  }

  if (command === 'رهان') {
    return {
      isCommand: true,
      lang: 'ar',
      targetUsername: '',
      amount: 0,
    };
  }

  return {
    isCommand: false,
    lang: 'en',
    targetUsername: '',
    amount: 0,
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

function sameName(a, b) {
  return normalizeName(a) === normalizeName(b);
}

async function findUserInAcl(username) {
  const target = normalizeName(username);

  if (!target) {
    return null;
  }

  const store = await readAclStoreForGames();

  const users = Array.isArray(store.users)
    ? store.users
    : [];

  return users.find((user) => {
    return normalizeName(user.username) === target;
  }) || null;
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

  const cooldownMs = (await getBetCooldownSeconds()) * 1000;

  const now = Date.now();
  const lastTime = betCooldownMap.get(key) || 0;
  const elapsed = now - lastTime;

  if (elapsed < cooldownMs) {
    return {
      allowed: false,
      remainingMs: cooldownMs - elapsed,
      reason: 'cooldown',
    };
  }

  betCooldownMap.set(key, now);

  return {
    allowed: true,
    remainingMs: 0,
    reason: '',
  };
}

function usageText(lang) {
  if (lang === 'ar') {
    return '❌ الاستخدام: رهان@username@200';
  }

  return '❌ Usage: bet@username@200';
}

function identifyErrorText(lang) {
  if (lang === 'ar') {
    return '❌ لم أستطع تحديد اللاعب.';
  }

  return '❌ Could not identify player.';
}

function userNotFoundText(username, lang) {
  if (lang === 'ar') {
    return `❌ المستخدم ${username} غير موجود في ملف النقاط.`;
  }

  return `❌ User ${username} does not exist in points file.`;
}

function cooldownText({
  playerName,
  remainingMs,
  lang,
}) {
  if (lang === 'ar') {
    return `⏱️ ${playerName} انتظر ${formatDuration(remainingMs, 'ar')} قبل رهان جديد.`;
  }

  return `⏱️ ${playerName}, wait ${formatDuration(remainingMs, 'en')} before betting again.`;
}

function failedText({
  reason,
  lang,
}) {
  if (lang === 'ar') {
    return `❌ فشل الرهان. السبب: ${reason}`;
  }

  return `❌ Bet failed. Reason: ${reason}`;
}

export async function handleBetCommand({
  roomMessage,
  ws,
  targetRoomId,
  targetRoomName,
}) {
  const parsed = parseBetCommand(roomMessage.text);

  if (!parsed.isCommand) {
    return false;
  }

  const lang = parsed.lang;

  const creatorUsername = getPlayerKey(roomMessage);
  const creatorName = clean(roomMessage.fromUsername) ||
    clean(roomMessage.fromUserId) ||
    'User';

  if (!creatorUsername) {
    ws.sendRoomMessage(
      targetRoomId,
      identifyErrorText(lang),
      targetRoomName,
    );

    return true;
  }

  if (!parsed.targetUsername || !parsed.amount || parsed.amount <= 0) {
    ws.sendRoomMessage(
      targetRoomId,
      usageText(lang),
      targetRoomName,
    );

    return true;
  }

  if (sameName(creatorUsername, parsed.targetUsername)) {
    ws.sendRoomMessage(
      targetRoomId,
      lang === 'ar'
        ? '❌ لا يمكنك الرهان ضد نفسك.'
        : '❌ You cannot bet against yourself.',
      targetRoomName,
    );

    return true;
  }

  /*
    المهم:
    لا تسمح بالرهان إذا المرسل أو الهدف غير موجودين في data/acl.json
    حتى لا يتم إنشاء مستخدم جديد تلقائيًا.
  */
  const creatorUser = await findUserInAcl(creatorUsername);

  if (!creatorUser) {
    ws.sendRoomMessage(
      targetRoomId,
      lang === 'ar'
        ? '❌ أنت غير موجود في ملف النقاط.'
        : '❌ You do not exist in points file.',
      targetRoomName,
    );

    return true;
  }

  const targetUser = await findUserInAcl(parsed.targetUsername);

  if (!targetUser) {
    ws.sendRoomMessage(
      targetRoomId,
      userNotFoundText(parsed.targetUsername, lang),
      targetRoomName,
    );

    return true;
  }

  const cooldown = await checkCooldown(roomMessage);

  if (!cooldown.allowed) {
    ws.sendRoomMessage(
      targetRoomId,
      cooldownText({
        playerName: creatorName,
        remainingMs: cooldown.remainingMs,
        lang,
      }),
      targetRoomName,
    );

    return true;
  }

  const creatorPoints = await getUserPoints(creatorUsername);
  const targetPoints = await getUserPoints(parsed.targetUsername);

  const result = await rollBetResult({
    amount: parsed.amount,
    creatorPoints,
    targetPoints,
  });

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

  if (result.winner === 'creator') {
    await changeUserPoints(
      creatorUsername,
      result.amount,
    );

    await changeUserPoints(
      parsed.targetUsername,
      -result.amount,
    );

    const finalPoints = await getUserPoints(creatorUsername);

    ws.sendRoomMessage(
      targetRoomId,
      lang === 'ar'
        ? [
          `🎲 ${creatorName} راهن ضد ${parsed.targetUsername}!`,
          `🏆 الفائز: ${creatorName}`,
          `💰 نقاطك: ${finalPoints}`,
        ].join('\n')
        : [
          `🎲 ${creatorName} bet against ${parsed.targetUsername}!`,
          `🏆 Winner: ${creatorName}`,
          `💰 your points: ${finalPoints}`,
        ].join('\n'),
      targetRoomName,
    );

    return true;
  }

  await changeUserPoints(
    creatorUsername,
    -result.amount,
  );

  await changeUserPoints(
    parsed.targetUsername,
    result.amount,
  );

  const finalPoints = await getUserPoints(creatorUsername);

  ws.sendRoomMessage(
    targetRoomId,
    lang === 'ar'
      ? [
        `🎲 ${creatorName} راهن ضد ${parsed.targetUsername}!`,
        `🏆 الفائز: ${parsed.targetUsername}`,
        `💰 نقاطك: ${finalPoints}`,
      ].join('\n')
      : [
        `🎲 ${creatorName} bet against ${parsed.targetUsername}!`,
        `🏆 Winner: ${parsed.targetUsername}`,
        `💰 your points: ${finalPoints}`,
      ].join('\n'),
    targetRoomName,
  );

  return true;
}