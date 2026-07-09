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
  createSlapChallenge,
  getActiveSlapChallenge,
  getKnownSlapRooms,
  getSlapTopPlayers,
  joinAndResolveSlapChallenge,
  registerSlapRoom,
} from '../services/slapGame.service.js';

function parseSlapCommand(text) {
  const command = normalizeCommand(text);

  if (command === 'كف') {
    return {
      isCommand: true,
      type: 'slap',
    };
  }

  if (command === 'كفوفي') {
    return {
      isCommand: true,
      type: 'top',
    };
  }

  return {
    isCommand: false,
    type: '',
  };
}

function getPlayerKey(roomMessage) {
  return clean(roomMessage.fromUsername) ||
    clean(roomMessage.fromUserId) ||
    '';
}

function getPlayerIdKey(roomMessage) {
  return clean(roomMessage.fromUserId) ||
    normalizeName(roomMessage.fromUsername);
}

function getPlayerName(roomMessage) {
  return clean(roomMessage.fromUsername) ||
    clean(roomMessage.fromUserId) ||
    'User';
}

function cleanRoomList(rooms) {
  const seen = new Set();

  return rooms.filter((room) => {
    const roomId = clean(room.roomId);
    const roomName = clean(room.roomName);

    const key = roomId || roomName;

    if (!key) {
      return false;
    }

    const normalized = key.toLowerCase();

    if (seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);

    return true;
  });
}

async function sendToAllSlapRooms({
  ws,
  text,
  fallbackRoomId,
  fallbackRoomName,
}) {
  const knownRooms = cleanRoomList(await getKnownSlapRooms());

  if (knownRooms.length === 0) {
    ws.sendRoomMessage(
      fallbackRoomId,
      text,
      fallbackRoomName,
    );

    return;
  }

  for (const room of knownRooms) {
    ws.sendRoomMessage(
      clean(room.roomId) || fallbackRoomId,
      text,
      clean(room.roomName) || fallbackRoomName,
    );
  }
}

function buildChallengeAnnouncement({
  playerName,
  prizePoints,
  challengeSeconds,
}) {
  return [
    '🥊 تحدي كف جديد',
    '',
    `👋 ${playerName} أرسل تحدي كف!`,
    '',
    'أول مستخدم يكتب:',
    'كف',
    'يدخل معه التحدي.',
    '',
    `🏆 الجائزة: ${prizePoints} نقطة`,
    `⏱️ مدة التحدي: ${challengeSeconds} ثانية`,
  ].join('\n');
}

function buildWaitingText({
  playerName,
}) {
  return [
    '🥊 لديك تحدي كف مفتوح بالفعل.',
    '',
    `👋 ${playerName} ينتظر أول لاعب يكتب: كف`,
  ].join('\n');
}

function buildSamePlayerText() {
  return [
    '😂 لا يمكنك تحدي نفسك.',
    'انتظر لاعبًا آخر يكتب: كف',
  ].join('\n');
}

function buildResultText({
  result,
}) {
  const starterName = clean(result.starter.username) ||
    clean(result.starter.userId) ||
    'Player 1';

  const joinerName = clean(result.joiner.username) ||
    clean(result.joiner.userId) ||
    'Player 2';

  const winnerName = clean(result.winner.username) ||
    clean(result.winner.userId) ||
    'Winner';

  const loserName = clean(result.loser.username) ||
    clean(result.loser.userId) ||
    'Loser';

  const funLines = [
    'الكف نزل بصوت عالي جدًا.',
    'الغرفة سكتت ثانية من قوة الكف.',
    'الكف كان سريع لدرجة البوت نفسه اتخض.',
    'الضربة كانت محسوبة بالملّي.',
    'ده مش كف، ده إعلان رسمي بالفوز.',
  ];

  const randomLine = funLines[Math.floor(Math.random() * funLines.length)];

  return [
    '🥊 نتيجة تحدي الكف',
    '',
    `👋 ${starterName}`,
    'ضد',
    `👋 ${joinerName}`,
    '',
    randomLine,
    '',
    `🏆 الفائز: ${winnerName}`,
    `😵 الخاسر: ${loserName}`,
    `💰 الجائزة: +${result.prizePoints} نقطة`,
  ].join('\n');
}

function buildTopText(players) {
  if (!players.length) {
    return [
      '🥊 كفوفي',
      '',
      'لا يوجد فائزون حتى الآن.',
      'اكتب كف لبدء أول تحدي.',
    ].join('\n');
  }

  const lines = players.map((player, index) => {
    const name = clean(player.username) ||
      clean(player.userId) ||
      clean(player.playerKey) ||
      'Unknown';

    const wins = Number(player.wins) || 0;
    const losses = Number(player.losses) || 0;
    const pointsWon = Number(player.pointsWon) || 0;

    return `${index + 1}. ${name} | فوز: ${wins} | خسارة: ${losses} | نقاط: ${pointsWon}`;
  });

  return [
    '🥊 أفضل 10 لاعبين في الكف',
    '',
    ...lines,
  ].join('\n');
}

function identifyErrorText() {
  return '❌ لم أستطع تحديد اللاعب.';
}

function disabledText() {
  return '❌ لعبة الكف متوقفة حاليًا.';
}

function noActiveChallengeText() {
  return [
    '🥊 لا يوجد تحدي كف مفتوح الآن.',
    'اكتب كف لبدء تحدي جديد.',
  ].join('\n');
}

export async function handleSlapCommand({
  roomMessage,
  ws,
  targetRoomId,
  targetRoomName,
}) {
  const parsed = parseSlapCommand(roomMessage.text);

  if (!parsed.isCommand) {
    return false;
  }

  await registerSlapRoom({
    roomId: targetRoomId,
    roomName: targetRoomName,
  });

  if (parsed.type === 'top') {
    const topPlayers = await getSlapTopPlayers(10);

    ws.sendRoomMessage(
      targetRoomId,
      buildTopText(topPlayers),
      targetRoomName,
    );

    return true;
  }

  const playerKey = getPlayerKey(roomMessage);
  const playerIdKey = getPlayerIdKey(roomMessage);
  const playerName = getPlayerName(roomMessage);

  if (!playerKey || !playerIdKey) {
    ws.sendRoomMessage(
      targetRoomId,
      identifyErrorText(),
      targetRoomName,
    );

    return true;
  }

  const activeChallenge = await getActiveSlapChallenge();

  if (!activeChallenge) {
    const created = await createSlapChallenge({
      playerKey,
      username: clean(roomMessage.fromUsername),
      userId: clean(roomMessage.fromUserId),
      roomId: targetRoomId,
      roomName: targetRoomName,
    });

    if (!created.ok) {
      if (created.reason === 'disabled') {
        ws.sendRoomMessage(
          targetRoomId,
          disabledText(),
          targetRoomName,
        );

        return true;
      }

      ws.sendRoomMessage(
        targetRoomId,
        '❌ لم أستطع إنشاء تحدي الكف.',
        targetRoomName,
      );

      return true;
    }

    await sendToAllSlapRooms({
      ws,
      text: buildChallengeAnnouncement({
        playerName,
        prizePoints: created.settings.prizePoints,
        challengeSeconds: created.settings.challengeSeconds,
      }),
      fallbackRoomId: targetRoomId,
      fallbackRoomName: targetRoomName,
    });

    return true;
  }

  const activeStarterKey = clean(activeChallenge.starter?.playerKey);

  if (
    activeStarterKey &&
    activeStarterKey.toLowerCase() === playerKey.toLowerCase()
  ) {
    ws.sendRoomMessage(
      targetRoomId,
      buildWaitingText({
        playerName,
      }),
      targetRoomName,
    );

    return true;
  }

  const resolved = await joinAndResolveSlapChallenge({
    playerKey,
    username: clean(roomMessage.fromUsername),
    userId: clean(roomMessage.fromUserId),
    roomId: targetRoomId,
    roomName: targetRoomName,
  });

  if (!resolved.ok) {
    if (resolved.reason === 'disabled') {
      ws.sendRoomMessage(
        targetRoomId,
        disabledText(),
        targetRoomName,
      );

      return true;
    }

    if (resolved.reason === 'same_player') {
      ws.sendRoomMessage(
        targetRoomId,
        buildSamePlayerText(),
        targetRoomName,
      );

      return true;
    }

    if (resolved.reason === 'no_active_challenge') {
      ws.sendRoomMessage(
        targetRoomId,
        noActiveChallengeText(),
        targetRoomName,
      );

      return true;
    }

    ws.sendRoomMessage(
      targetRoomId,
      '❌ لم أستطع إنهاء تحدي الكف.',
      targetRoomName,
    );

    return true;
  }

  const winnerKey = clean(resolved.result.winner.playerKey);

  if (winnerKey) {
    await getUserAccess(winnerKey);

    await addUserPoints(
      winnerKey,
      resolved.result.prizePoints,
    );
  }

  await sendToAllSlapRooms({
    ws,
    text: buildResultText({
      result: resolved.result,
    }),
    fallbackRoomId: targetRoomId,
    fallbackRoomName: targetRoomName,
  });

  return true;
}