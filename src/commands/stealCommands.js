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
  rollStealResult,
  getStealCooldownSeconds,
} from '../services/stealGame.service.js';

const stealCooldownMap = new Map();

function parseStealCommand(text) {
  const raw = clean(text);

  /*
    English:
    steal@ahmed
    steal ahmed
    steal @ahmed
  */
  const enMatch = raw.match(/^steal\s*@?\s*([^@\s]+)$/i);

  if (enMatch) {
    return {
      isCommand: true,
      lang: 'en',
      targetUsername: clean(enMatch[1]).replace(/^@/, ''),
    };
  }

  /*
    Arabic:
    سرقة@ahmed
    سرقة ahmed
    سرقة @ahmed
  */
  const arMatch = raw.match(/^سرقة\s*@?\s*([^@\s]+)$/i);

  if (arMatch) {
    return {
      isCommand: true,
      lang: 'ar',
      targetUsername: clean(arMatch[1]).replace(/^@/, ''),
    };
  }

  const command = normalizeCommand(raw);

  if (command === 'steal') {
    return {
      isCommand: true,
      lang: 'en',
      targetUsername: '',
    };
  }

  if (command === 'سرقة') {
    return {
      isCommand: true,
      lang: 'ar',
      targetUsername: '',
    };
  }

  return {
    isCommand: false,
    lang: 'en',
    targetUsername: '',
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

  const cooldownMs = (await getStealCooldownSeconds()) * 1000;

  const now = Date.now();
  const lastTime = stealCooldownMap.get(key) || 0;
  const elapsed = now - lastTime;

  if (elapsed < cooldownMs) {
    return {
      allowed: false,
      remainingMs: cooldownMs - elapsed,
      reason: 'cooldown',
    };
  }

  stealCooldownMap.set(key, now);

  return {
    allowed: true,
    remainingMs: 0,
    reason: '',
  };
}

function usageText(lang) {
  if (lang === 'ar') {
    return '❌ اكتب اسم المستخدم. مثال: سرقة@ahmed';
  }

  return '❌ Write username. Example: steal@ahmed';
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
    return `⏱️ ${playerName} انتظر ${formatDuration(remainingMs, 'ar')} قبل محاولة سرقة جديدة.`;
  }

  return `⏱️ ${playerName}, wait ${formatDuration(remainingMs, 'en')} before stealing again.`;
}

function failedText({
  reason,
  lang,
}) {
  if (lang === 'ar') {
    return `❌ فشلت السرقة. السبب: ${reason}`;
  }

  return `❌ Steal failed. Reason: ${reason}`;
}

export async function handleStealCommand({
  roomMessage,
  ws,
  targetRoomId,
  targetRoomName,
}) {
  const parsed = parseStealCommand(roomMessage.text);

  if (!parsed.isCommand) {
    return false;
  }

  const lang = parsed.lang;

  const thiefUsername = getPlayerKey(roomMessage);
  const thiefName = clean(roomMessage.fromUsername) ||
    clean(roomMessage.fromUserId) ||
    'User';

  if (!thiefUsername) {
    ws.sendRoomMessage(
      targetRoomId,
      identifyErrorText(lang),
      targetRoomName,
    );

    return true;
  }

  if (!parsed.targetUsername) {
    ws.sendRoomMessage(
      targetRoomId,
      usageText(lang),
      targetRoomName,
    );

    return true;
  }

  if (sameName(thiefUsername, parsed.targetUsername)) {
    ws.sendRoomMessage(
      targetRoomId,
      lang === 'ar'
        ? '❌ لا يمكنك سرقة نفسك.'
        : '❌ You cannot steal from yourself.',
      targetRoomName,
    );

    return true;
  }

  /*
    المهم:
    لا تسمح بالسرقة إذا السارق أو الهدف غير موجودين في data/acl.json
    حتى لا يتم إنشاء مستخدم جديد تلقائيًا.
  */
  const thiefUser = await findUserInAcl(thiefUsername);

  if (!thiefUser) {
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
        playerName: thiefName,
        remainingMs: cooldown.remainingMs,
        lang,
      }),
      targetRoomName,
    );

    return true;
  }

  const thiefPoints = await getUserPoints(thiefUsername);
  const targetPoints = await getUserPoints(parsed.targetUsername);

  const result = await rollStealResult({
    thiefPoints,
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

  if (result.type === 'success') {
    if (result.points > 0) {
      await changeUserPoints(
        parsed.targetUsername,
        -result.points,
      );

      await changeUserPoints(
        thiefUsername,
        result.points,
      );
    }

    const finalPoints = await getUserPoints(thiefUsername);

    ws.sendRoomMessage(
      targetRoomId,
      lang === 'ar'
        ? [
          `🕵️ ${thiefName} حاول سرقة ${parsed.targetUsername}!`,
          `✅ نجحت السرقة بنسبة ${result.percent}%`,
          `💰 نقاطك: ${finalPoints}`,
        ].join('\n')
        : [
          `🕵️ ${thiefName} tried to steal from ${parsed.targetUsername}!`,
          `✅ Success! stolen ${result.percent}%`,
          `💰 your points: ${finalPoints}`,
        ].join('\n'),
      targetRoomName,
    );

    return true;
  }

  if (result.points < 0) {
    await changeUserPoints(
      thiefUsername,
      result.points,
    );
  }

  const finalPoints = await getUserPoints(thiefUsername);

  ws.sendRoomMessage(
    targetRoomId,
    lang === 'ar'
      ? [
        `🕵️ ${thiefName} حاول سرقة ${parsed.targetUsername}!`,
        `❌ فشلت السرقة وخسرت ${result.percent}%`,
        `💰 نقاطك: ${finalPoints}`,
      ].join('\n')
      : [
        `🕵️ ${thiefName} tried to steal from ${parsed.targetUsername}!`,
        `❌ Failed! lost ${result.percent}%`,
        `💰 your points: ${finalPoints}`,
      ].join('\n'),
    targetRoomName,
  );

  return true;
}