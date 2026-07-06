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
  rollInvestmentResult,
  getInvestmentCooldownSeconds,
} from '../services/investmentGame.service.js';

const investmentCooldownMap = new Map();

function parseInvestmentCommand(text) {
  const raw = clean(text);
  const command = normalizeCommand(raw);

  /*
    English:
    invest 100
    invest@100
    invest @100
  */
  const enMatch = raw.match(/^invest\s*@?\s*(\d+)$/i);

  if (enMatch) {
    return {
      isCommand: true,
      lang: 'en',
      amount: Number(enMatch[1]) || 0,
    };
  }

  /*
    Arabic:
    استثمار 100
    استثمار@100
    استثمار @100
  */
  const arMatch = raw.match(/^استثمار\s*@?\s*(\d+)$/i);

  if (arMatch) {
    return {
      isCommand: true,
      lang: 'ar',
      amount: Number(arMatch[1]) || 0,
    };
  }

  /*
    لو كتب الكلمة فقط بدون رقم.
  */
  if (command === 'invest') {
    return {
      isCommand: true,
      lang: 'en',
      amount: 0,
    };
  }

  if (command === 'استثمار') {
    return {
      isCommand: true,
      lang: 'ar',
      amount: 0,
    };
  }

  return {
    isCommand: false,
    lang: 'en',
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

async function checkInvestmentCooldown(roomMessage) {
  const key = getCooldownKey(roomMessage);

  if (!key) {
    return {
      allowed: false,
      remainingMs: 0,
      reason: 'missing_user',
    };
  }

  const cooldownSeconds = await getInvestmentCooldownSeconds();
  const cooldownMs = cooldownSeconds * 1000;

  const now = Date.now();
  const lastTime = investmentCooldownMap.get(key) || 0;
  const elapsed = now - lastTime;

  if (elapsed < cooldownMs) {
    return {
      allowed: false,
      remainingMs: cooldownMs - elapsed,
      reason: 'cooldown',
    };
  }

  investmentCooldownMap.set(key, now);

  return {
    allowed: true,
    remainingMs: 0,
    reason: '',
  };
}

function identifyErrorText(lang) {
  if (lang === 'ar') {
    return '❌ لم أستطع تحديد اللاعب.';
  }

  return '❌ Could not identify player.';
}

function usageText(lang) {
  if (lang === 'ar') {
    return [
      '❌ اكتب مبلغ الاستثمار.',
      '',
      'مثال:',
      'استثمار 100',
      'استثمار@100',
    ].join('\n');
  }

  return [
    '❌ Write investment amount.',
    '',
    'Example:',
    'invest 100',
    'invest@100',
  ].join('\n');
}

function cooldownText({
  playerName,
  remainingMs,
  lang,
}) {
  if (lang === 'ar') {
    return `⏱️ ${playerName} انتظر ${formatDuration(remainingMs, 'ar')} قبل استثمار جديد.`;
  }

  return `⏱️ ${playerName}, wait ${formatDuration(remainingMs, 'en')} before investing again.`;
}

function failedText({
  reason,
  lang,
}) {
  if (lang === 'ar') {
    return `❌ فشل الاستثمار. السبب: ${reason}`;
  }

  return `❌ Investment failed. Reason: ${reason}`;
}

function investmentIntro({
  playerName,
  amount,
  lang,
}) {
  if (lang === 'ar') {
    return `🏦 ${playerName} استثمر ${amount} نقطة!`;
  }

  return `🏦 ${playerName} invested ${amount} points!`;
}

function resultText({
  result,
  lang,
}) {
  if (lang === 'ar') {
    if (result.type === 'win') {
      return `✅ ربحت ${result.prize}`;
    }

    return `❌ خسرت ${result.prize}`;
  }

  if (result.type === 'win') {
    return `✅ you won ${result.prize}`;
  }

  return `❌ you lost ${result.prize}`;
}

function percentText({
  result,
  lang,
}) {
  if (lang === 'ar') {
    if (result.type === 'win') {
      return `📈 المكسب: +${result.percent}%`;
    }

    return `📉 الخسارة: -${result.percent}%`;
  }

  if (result.type === 'win') {
    return `📈 profit: +${result.percent}%`;
  }

  return `📉 loss: -${result.percent}%`;
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

export async function handleInvestmentCommand({
  roomMessage,
  ws,
  targetRoomId,
  targetRoomName,
}) {
  const parsed = parseInvestmentCommand(roomMessage.text);

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

  if (!parsed.amount || parsed.amount <= 0) {
    ws.sendRoomMessage(
      targetRoomId,
      usageText(lang),
      targetRoomName,
    );

    return true;
  }

  const cooldown = await checkInvestmentCooldown(roomMessage);

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

  const result = await rollInvestmentResult({
    currentPoints,
    investPoints: parsed.amount,
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

  await addUserPoints(
    playerKey,
    result.points,
  );

  const afterAccess = await getUserAccess(playerKey);
  const finalPoints = Number(afterAccess.points) || 0;

  ws.sendRoomMessage(
    targetRoomId,
    [
      investmentIntro({
        playerName,
        amount: parsed.amount,
        lang,
      }),
      resultText({
        result,
        lang,
      }),
      percentText({
        result,
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