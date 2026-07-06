import {
  clean,
  normalizeCommand,
  normalizeName,
} from '../utils/text.js';

import {
  getUserPoints,
  changeUserPoints,
} from '../services/gamePoints.service.js';

function parseOwnerGivePointsCommand(text) {
  const raw = clean(text);

  /*
    English owner command:
    give@ahmed@100
    give ahmed 100
    give @ahmed 100
  */
  const enMatch = raw.match(/^give\s*@?\s*([^@\s]+)\s*@?\s*(\d+)$/i);

  if (enMatch) {
    return {
      isCommand: true,
      lang: 'en',
      targetUsername: clean(enMatch[1]).replace(/^@/, ''),
      amount: Math.floor(Number(enMatch[2]) || 0),
    };
  }

  /*
    Arabic owner command:
    منح@ahmed@100
    منح ahmed 100
    منح @ahmed 100
  */
  const arMatch = raw.match(/^منح\s*@?\s*([^@\s]+)\s*@?\s*(\d+)$/i);

  if (arMatch) {
    return {
      isCommand: true,
      lang: 'ar',
      targetUsername: clean(arMatch[1]).replace(/^@/, ''),
      amount: Math.floor(Number(arMatch[2]) || 0),
    };
  }

  const command = normalizeCommand(raw);

  if (command === 'give') {
    return {
      isCommand: true,
      lang: 'en',
      targetUsername: '',
      amount: 0,
    };
  }

  if (command === 'منح') {
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

function isBotOwner({
  roomMessage,
  sessionInfo,
}) {
  const envOwnerId = normalizeName(process.env.BOT_OWNER_USER_ID);
  const envOwnerUsername = normalizeName(process.env.BOT_OWNER_USERNAME);

  const createdBy = normalizeName(sessionInfo?.createdBy);

  const fromUserId = normalizeName(roomMessage?.fromUserId);
  const fromUsername = normalizeName(roomMessage?.fromUsername);

  if (envOwnerId && envOwnerId === fromUserId) {
    return true;
  }

  if (envOwnerUsername && envOwnerUsername === fromUsername) {
    return true;
  }

  if (createdBy && createdBy === fromUserId) {
    return true;
  }

  if (createdBy && createdBy === fromUsername) {
    return true;
  }

  return false;
}

function usageText(lang) {
  if (lang === 'ar') {
    return [
      '❌ الاستخدام للمالك فقط:',
      'منح@username@100',
      '',
      'مثال:',
      'منح@ahmed@100',
    ].join('\n');
  }

  return [
    '❌ Owner usage only:',
    'give@username@100',
    '',
    'Example:',
    'give@ahmed@100',
  ].join('\n');
}

export async function handleOwnerGivePointsCommand({
  roomMessage,
  ws,
  sessionInfo,
  targetRoomId,
  targetRoomName,
}) {
  const parsed = parseOwnerGivePointsCommand(roomMessage.text);

  if (!parsed.isCommand) {
    return false;
  }

  const lang = parsed.lang;

  if (
    !isBotOwner({
      roomMessage,
      sessionInfo,
    })
  ) {
    ws.sendRoomMessage(
      targetRoomId,
      lang === 'ar'
        ? '❌ هذا الأمر لمالك البوت فقط.'
        : '❌ This command is only for bot owner.',
      targetRoomName,
    );

    return true;
  }

  if (!parsed.targetUsername || parsed.amount <= 0) {
    ws.sendRoomMessage(
      targetRoomId,
      usageText(lang),
      targetRoomName,
    );

    return true;
  }

  await changeUserPoints(
    parsed.targetUsername,
    parsed.amount,
  );

  const targetPoints = await getUserPoints(parsed.targetUsername);

  if (lang === 'ar') {
    ws.sendRoomMessage(
      targetRoomId,
      [
        `👑 تم منح ${parsed.amount} نقطة إلى ${parsed.targetUsername}`,
        `💰 نقاط ${parsed.targetUsername}: ${targetPoints}`,
      ].join('\n'),
      targetRoomName,
    );

    return true;
  }

  ws.sendRoomMessage(
    targetRoomId,
    [
      `👑 ${parsed.amount} points granted to ${parsed.targetUsername}`,
      `💰 ${parsed.targetUsername} points: ${targetPoints}`,
    ].join('\n'),
    targetRoomName,
  );

  return true;
}