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

function parsePointsTransferCommand(text) {
  const raw = clean(text);

  /*
    English:
    send@ahmed@100
    send ahmed 100
    send @ahmed 100
  */
  const enMatch = raw.match(/^send\s*@?\s*([^@\s]+)\s*@?\s*(\d+)$/i);

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
    تحويل@ahmed@100
    تحويل ahmed 100
    تحويل @ahmed 100
  */
  const arMatch = raw.match(/^تحويل\s*@?\s*([^@\s]+)\s*@?\s*(\d+)$/i);

  if (arMatch) {
    return {
      isCommand: true,
      lang: 'ar',
      targetUsername: clean(arMatch[1]).replace(/^@/, ''),
      amount: Math.floor(Number(arMatch[2]) || 0),
    };
  }

  const command = normalizeCommand(raw);

  if (command === 'send') {
    return {
      isCommand: true,
      lang: 'en',
      targetUsername: '',
      amount: 0,
    };
  }

  if (command === 'تحويل') {
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

function sameUser(a, b) {
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

function usageText(lang) {
  if (lang === 'ar') {
    return [
      '❌ الاستخدام:',
      'تحويل@username@100',
      '',
      'مثال:',
      'تحويل@ahmed@100',
    ].join('\n');
  }

  return [
    '❌ Usage:',
    'send@username@100',
    '',
    'Example:',
    'send@ahmed@100',
  ].join('\n');
}

function userNotFoundText(username, lang) {
  if (lang === 'ar') {
    return `❌ المستخدم ${username} غير موجود في ملف النقاط.`;
  }

  return `❌ User ${username} does not exist in points file.`;
}

export async function handlePointsTransferCommand({
  roomMessage,
  ws,
  targetRoomId,
  targetRoomName,
}) {
  const parsed = parsePointsTransferCommand(roomMessage.text);

  if (!parsed.isCommand) {
    return false;
  }

  const lang = parsed.lang;

  const senderUsername = getPlayerKey(roomMessage);
  const senderName = clean(roomMessage.fromUsername) ||
    clean(roomMessage.fromUserId) ||
    'User';

  if (!senderUsername) {
    ws.sendRoomMessage(
      targetRoomId,
      lang === 'ar'
        ? '❌ لم أستطع تحديد المرسل.'
        : '❌ Could not identify sender.',
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

  if (sameUser(senderUsername, parsed.targetUsername)) {
    ws.sendRoomMessage(
      targetRoomId,
      lang === 'ar'
        ? '❌ لا يمكنك تحويل النقاط لنفسك.'
        : '❌ You cannot send points to yourself.',
      targetRoomName,
    );

    return true;
  }

  /*
    المهم:
    لا تحول ولا تنشئ المستخدم إذا كان غير موجود في data/acl.json
  */
  const targetUser = await findUserInAcl(parsed.targetUsername);

  if (!targetUser) {
    ws.sendRoomMessage(
      targetRoomId,
      userNotFoundText(parsed.targetUsername, lang),
      targetRoomName,
    );

    return true;
  }

  const senderUser = await findUserInAcl(senderUsername);

  if (!senderUser) {
    ws.sendRoomMessage(
      targetRoomId,
      lang === 'ar'
        ? '❌ أنت غير موجود في ملف النقاط.'
        : '❌ You do not exist in points file.',
      targetRoomName,
    );

    return true;
  }

  const senderPoints = await getUserPoints(senderUsername);

  if (senderPoints < parsed.amount) {
    ws.sendRoomMessage(
      targetRoomId,
      lang === 'ar'
        ? `❌ نقاطك غير كافية. نقاطك: ${senderPoints}`
        : `❌ Not enough points. your points: ${senderPoints}`,
      targetRoomName,
    );

    return true;
  }

  await changeUserPoints(
    senderUsername,
    -parsed.amount,
  );

  await changeUserPoints(
    parsed.targetUsername,
    parsed.amount,
  );

  const finalSenderPoints = await getUserPoints(senderUsername);
  const finalTargetPoints = await getUserPoints(parsed.targetUsername);

  if (lang === 'ar') {
    ws.sendRoomMessage(
      targetRoomId,
      [
        `💸 ${senderName} حوّل ${parsed.amount} نقطة إلى ${parsed.targetUsername}`,
        `💰 نقاطك: ${finalSenderPoints}`,
        `🎁 نقاط ${parsed.targetUsername}: ${finalTargetPoints}`,
      ].join('\n'),
      targetRoomName,
    );

    return true;
  }

  ws.sendRoomMessage(
    targetRoomId,
    [
      `💸 ${senderName} sent ${parsed.amount} points to ${parsed.targetUsername}`,
      `💰 your points: ${finalSenderPoints}`,
      `🎁 ${parsed.targetUsername} points: ${finalTargetPoints}`,
    ].join('\n'),
    targetRoomName,
  );

  return true;
}