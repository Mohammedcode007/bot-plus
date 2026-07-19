
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
  consumeSlapCooldown,
  createSlapChallenge,
  getActiveSlapChallenge,
  getSlapTopPlayers,
  getSlapTopRooms,
  joinAndResolveSlapChallenge,
} from '../services/slapGame.service.js';


/*
  ضع رابط صورة نتيجة اللعبة هنا،
  أو أضفه في ملف البيئة:
  SLAP_RESULT_IMAGE_URL=https://example.com/slap-result.jpg
*/
const SLAP_RESULT_IMAGE_URL = String(
  process.env.SLAP_RESULT_IMAGE_URL ||
    'https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExOXRsOWpmeDEzYTA0eWF6aTh0MjhrYXdiOTgxM20yMmlnN29lZ3RrNCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/i5aZSGUe4HJQTgeXAu/giphy.gif',
).trim();


function parseSlapCommand(text) {
  const command = normalizeCommand(text);

  if (command === 'كف') {
    return {
      isCommand: true,
      type: 'slap',
      lang: 'ar',
    };
  }

  if (command === 'slap') {
    return {
      isCommand: true,
      type: 'slap',
      lang: 'en',
    };
  }

  if (command === 'كفوفي') {
    return {
      isCommand: true,
      type: 'top',
      lang: 'ar',
    };
  }

  if (
    command === 'slaptop' ||
    command === 'slap-top'
  ) {
    return {
      isCommand: true,
      type: 'top',
      lang: 'en',
    };
  }


  return {
    isCommand: false,
    type: '',
    lang: 'ar',
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

function normalizeRoomName(roomName) {
  return clean(roomName).toLowerCase();
}

function isMusicKey(key) {
  return clean(key).toLowerCase().startsWith('music:');
}

function isControllerKey(key) {
  const value = clean(key).toLowerCase();

  return (
    value.startsWith('controller:') ||
    value.startsWith('control:') ||
    value.startsWith('bot_controller:')
  );
}

function getMusicRoomFromKey(key) {
  return clean(key).replace(/^music:/i, '');
}

function getControllerRoomFromKey(key) {
  const raw = clean(key);

  if (!raw) {
    return '';
  }

  const parts = raw.split(':');

  if (parts.length >= 2) {
    return clean(parts[1]);
  }

  return '';
}

function getBroadcastTargets({
  runtime,
  currentSocket,
  currentRoomId,
  currentRoomName,
}) {
  const targetsByRoom = new Map();

  const connections =
    runtime &&
    runtime.registry &&
    runtime.registry.connections instanceof Map
      ? runtime.registry.connections
      : null;

  if (connections) {
    for (const [key, instance] of connections.entries()) {
      if (!isMusicKey(key)) {
        continue;
      }

      if (!instance || typeof instance.sendRoomMessage !== 'function') {
        continue;
      }

      const roomName = getMusicRoomFromKey(key);
      const roomKey = normalizeRoomName(roomName);

      if (!roomKey) {
        continue;
      }

      targetsByRoom.set(roomKey, {
        type: 'music',
        roomId: instance.roomId || instance?.bot?.roomId || '',
        roomName,
        socket: instance,
      });
    }

    for (const [key, instance] of connections.entries()) {
      if (!isControllerKey(key)) {
        continue;
      }

      if (!instance || typeof instance.sendRoomMessage !== 'function') {
        continue;
      }

      const roomName =
        getControllerRoomFromKey(key) ||
        instance.roomName ||
        instance?.bot?.roomName ||
        instance?.bot?.room ||
        '';

      const roomKey = normalizeRoomName(roomName);

      if (!roomKey) {
        continue;
      }

      if (targetsByRoom.has(roomKey)) {
        continue;
      }

      targetsByRoom.set(roomKey, {
        type: 'controller',
        roomId: instance.roomId || instance?.bot?.roomId || '',
        roomName,
        socket: instance,
      });
    }
  }

  if (
    targetsByRoom.size === 0 &&
    currentSocket &&
    typeof currentSocket.sendRoomMessage === 'function'
  ) {
    targetsByRoom.set(
      normalizeRoomName(currentRoomName) || 'current-room',
      {
        type: 'current',
        roomId: currentRoomId,
        roomName: currentRoomName,
        socket: currentSocket,
      },
    );
  }

  return Array.from(targetsByRoom.values());
}

function prioritizeCurrentRoomTargets({
  targets,
  currentRoomName,
  currentSocket,
  currentRoomId,
}) {
  const currentKey = normalizeRoomName(currentRoomName);
  const result = [];
  const usedRooms = new Set();

  if (currentKey) {
    const currentTarget = targets.find((target) => {
      return normalizeRoomName(target.roomName) === currentKey;
    });

    if (currentTarget) {
      result.push(currentTarget);
      usedRooms.add(currentKey);
    } else if (currentSocket) {
      result.push({
        type: 'current',
        roomId: currentRoomId,
        roomName: currentRoomName,
        socket: currentSocket,
      });

      usedRooms.add(currentKey);
    }
  }

  for (const target of targets) {
    const key = normalizeRoomName(target.roomName);

    if (!key || usedRooms.has(key)) {
      continue;
    }

    result.push(target);
    usedRooms.add(key);
  }

  return result;
}

function sendRoomTextSafe(socket, roomId, roomName, text) {
  if (!socket || !text) {
    return false;
  }

  if (typeof socket.sendRoomMessage === 'function') {
    try {
      socket.sendRoomMessage(roomId, text, roomName);
      return true;
    } catch (error) {
      console.log(
        '⚠️ [SLAP_SEND_ROOM_MESSAGE_FAILED_1]',
        error?.message || error,
      );
    }

    try {
      socket.sendRoomMessage(roomId, text);
      return true;
    } catch (error) {
      console.log(
        '⚠️ [SLAP_SEND_ROOM_MESSAGE_FAILED_2]',
        error?.message || error,
      );
    }
  }

  if (typeof socket.send === 'function') {
    socket.send({
      handler: 'room.message.send',
      roomId: String(roomId || '').trim(),
      roomName: String(roomName || '').trim(),
      type: 'text',
      text: String(text || ''),
    });

    return true;
  }

  return false;
}


function isValidSlapImageUrl(value) {
  const url = clean(value);

  return (
    /^https?:\/\//i.test(url) &&
    url !== 'PUT_SLAP_RESULT_IMAGE_URL_HERE'
  );
}

function sendRoomImageSafe(
  socket,
  roomId,
  roomName,
  imageUrl,
) {
  const url = clean(imageUrl);

  if (!socket || !isValidSlapImageUrl(url)) {
    return false;
  }

  if (typeof socket.sendRoomImageUrl === 'function') {
    try {
      socket.sendRoomImageUrl(
        roomId,
        url,
        roomName,
      );

      return true;
    } catch (error) {
      console.log(
        '⚠️ [SLAP_SEND_ROOM_IMAGE_FAILED_1]',
        error?.message || error,
      );
    }
  }

  if (typeof socket.send === 'function') {
    try {
      socket.send({
        handler: 'room.message.send',
        roomId: String(roomId || '').trim(),
        roomName: String(roomName || '').trim(),
        type: 'image',
        text: '',
        url,
        media: {
          url,
          fileName: 'slap-result.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 0,
        },
      });

      return true;
    } catch (error) {
      console.log(
        '⚠️ [SLAP_SEND_ROOM_IMAGE_FAILED_2]',
        error?.message || error,
      );
    }
  }

  return false;
}


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendToAllSlapRooms({
  ws,
  runtime,
  text,
  fallbackRoomId,
  fallbackRoomName,
}) {
  const targets = prioritizeCurrentRoomTargets({
    targets: getBroadcastTargets({
      runtime,
      currentSocket: ws,
      currentRoomId: fallbackRoomId,
      currentRoomName: fallbackRoomName,
    }),
    currentSocket: ws,
    currentRoomId: fallbackRoomId,
    currentRoomName: fallbackRoomName,
  });

  if (!targets.length) {
    sendRoomTextSafe(
      ws,
      fallbackRoomId,
      fallbackRoomName,
      text,
    );

    return;
  }

  const delayMs = Number(process.env.SLAP_BROADCAST_DELAY_MS || 300);

  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];

    sendRoomTextSafe(
      target.socket,
      target.roomId || fallbackRoomId,
      target.roomName || fallbackRoomName,
      text,
    );

    if (i < targets.length - 1) {
      await sleep(delayMs);
    }
  }
}
async function sendToSlapMatchRooms({
  ws,
  runtime,
  text,
  imageUrl,
  starter,
  joiner,
  fallbackRoomId,
  fallbackRoomName,
}) {
  const targets = getBroadcastTargets({
    runtime,
    currentSocket: ws,
    currentRoomId: fallbackRoomId,
    currentRoomName: fallbackRoomName,
  });

  const wantedRooms = new Map();

  const addRoom = (player) => {
    const roomId = clean(player?.roomId);
    const roomName = clean(player?.roomName);

    const key =
      normalizeRoomName(roomName) ||
      roomId;

    if (!key) {
      return;
    }

    wantedRooms.set(key, {
      roomId,
      roomName,
    });
  };

  addRoom(starter);
  addRoom(joiner);

  for (const [roomKey, room] of wantedRooms.entries()) {
    const target = targets.find((item) => {
      const itemKey =
        normalizeRoomName(item.roomName) ||
        clean(item.roomId);

      return itemKey === roomKey;
    });

    if (target) {
      const finalRoomId =
        target.roomId ||
        room.roomId ||
        fallbackRoomId;

      const finalRoomName =
        target.roomName ||
        room.roomName ||
        fallbackRoomName;

      sendRoomTextSafe(
        target.socket,
        finalRoomId,
        finalRoomName,
        text,
      );

      sendRoomImageSafe(
        target.socket,
        finalRoomId,
        finalRoomName,
        imageUrl,
      );

      continue;
    }

    /*
      حل احتياطي للغرفة الحالية.
    */
    const fallbackKey =
      normalizeRoomName(fallbackRoomName) ||
      clean(fallbackRoomId);

    if (fallbackKey === roomKey) {
      const finalRoomId =
        room.roomId ||
        fallbackRoomId;

      const finalRoomName =
        room.roomName ||
        fallbackRoomName;

      sendRoomTextSafe(
        ws,
        finalRoomId,
        finalRoomName,
        text,
      );

      sendRoomImageSafe(
        ws,
        finalRoomId,
        finalRoomName,
        imageUrl,
      );
    }
  }
}
function buildChallengeAnnouncement({
  playerName,
  prizePoints,
  lang,
}) {
  if (lang === 'en') {
    return [
      `🥊 ${playerName} started a slap challenge!`,
      `Type slap to join • Prize: ${prizePoints} points`,
    ].join('\n');
  }

  return [
    `🥊 ${playerName} بدأ تحدي كف!`,
    `اكتب كف للانضمام • الجائزة: ${prizePoints} نقطة`,
  ].join('\n');
}

function buildWaitingText({
  playerName,
  lang,
}) {
  return lang === 'en'
    ? `⏳ ${playerName} is waiting for an opponent.`
    : `⏳ ${playerName} ينتظر منافسًا.`;
}

function buildAlreadyActiveText({
  starterName,
  lang,
}) {
  return lang === 'en'
    ? `🥊 ${starterName}'s challenge is open. Type slap to join.`
    : `🥊 تحدي ${starterName} مفتوح. اكتب كف للانضمام.`;
}

function buildSamePlayerText(lang) {
  return lang === 'en'
    ? '😂 You cannot challenge yourself.'
    : '😂 لا يمكنك تحدي نفسك.';
}

function buildResultText({
  result,
  lang,
}) {
  const starterName =
    clean(result.starter.username) ||
    clean(result.starter.userId) ||
    (lang === 'en' ? 'Player 1' : 'اللاعب الأول');

  const joinerName =
    clean(result.joiner.username) ||
    clean(result.joiner.userId) ||
    (lang === 'en' ? 'Player 2' : 'اللاعب الثاني');

  const winnerName =
    clean(result.winner.username) ||
    clean(result.winner.userId) ||
    (lang === 'en' ? 'Winner' : 'الفائز');

  const loserName =
    clean(result.loser.username) ||
    clean(result.loser.userId) ||
    (lang === 'en' ? 'Loser' : 'الخاسر');

  const starterRoom =
    clean(result.starter.roomName) ||
    clean(result.starter.roomId) ||
    (lang === 'en' ? 'Unknown room' : 'غرفة غير معروفة');

  const joinerRoom =
    clean(result.joiner.roomName) ||
    clean(result.joiner.roomId) ||
    (lang === 'en' ? 'Unknown room' : 'غرفة غير معروفة');

  const winnerRoom =
    clean(result.winner.roomName) ||
    clean(result.winner.roomId) ||
    (lang === 'en' ? 'Unknown room' : 'غرفة غير معروفة');

  if (lang === 'en') {
    return [
      `🥊 ${starterName} (${starterRoom}) vs ${joinerName} (${joinerRoom})`,
      `🏆 ${winnerName} won • Room: ${winnerRoom}`,
      `😵 ${loserName} • +${result.prizePoints} points`,
    ].join('\n');
  }

  return [
    `🥊 ${starterName} (${starterRoom}) ضد ${joinerName} (${joinerRoom})`,
    `🏆 الفائز: ${winnerName} • الغرفة: ${winnerRoom}`,
    `😵 الخاسر: ${loserName} • +${result.prizePoints} نقطة`,
  ].join('\n');
}

function buildTopText(players, lang) {
  if (!players.length) {
    return lang === 'en'
      ? '🥊 No slap winners yet.'
      : '🥊 لا يوجد فائزون حتى الآن.';
  }

  const medals = ['🥇', '🥈', '🥉'];

  const lines = players.map((player, index) => {
    const name =
      clean(player.username) ||
      clean(player.userId) ||
      clean(player.playerKey) ||
      (lang === 'en' ? 'Unknown' : 'مجهول');

    const wins = Number(player.wins) || 0;
    const losses = Number(player.losses) || 0;
    const rank = medals[index] || `${index + 1}️⃣`;

    return lang === 'en'
      ? `${rank} ${name}\n   🏆 Wins: ${wins} | ❌ Losses: ${losses}`
      : `${rank} ${name}\n   🏆 الفوز: ${wins} | ❌ الخسارة: ${losses}`;
  });

  return [
    lang === 'en'
      ? '🥊 Top slap players'
      : '🥊 ترتيب أفضل لاعبي الكف',
    '',
    ...lines,
  ].join('\n\n');
}



function buildCooldownText(
  waitSeconds,
  lang,
) {
  const totalSeconds = Math.max(
    1,
    Number(waitSeconds) || 1,
  );

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (lang === 'en') {
    const remaining = [
      minutes > 0 ? `${minutes}m` : '',
      seconds > 0 ? `${seconds}s` : '',
    ]
      .filter(Boolean)
      .join(' ');

    return `⏳ Try again in ${remaining}.`;
  }

  const remaining = [
    minutes > 0 ? `${minutes} د` : '',
    seconds > 0 ? `${seconds} ث` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return `⏳ حاول بعد ${remaining}.`;
}

function identifyErrorText(lang) {
  return lang === 'en'
    ? '❌ Could not identify the player.'
    : '❌ تعذر تحديد اللاعب.';
}

function disabledText(lang) {
  return lang === 'en'
    ? '❌ Slap game is disabled.'
    : '❌ لعبة الكف متوقفة.';
}

function noActiveChallengeText(lang) {
  return lang === 'en'
    ? '🥊 No open challenge. Type slap to start.'
    : '🥊 لا يوجد تحدٍ مفتوح. اكتب كف للبدء.';
}

export async function handleSlapCommand({
  roomMessage,
  ws,
  runtime,
  targetRoomId,
  targetRoomName,
}) {
  const parsed = parseSlapCommand(roomMessage.text);

  if (!parsed.isCommand) {
    return false;
  }

  if (parsed.type === 'top') {
    const topPlayers = await getSlapTopPlayers(10);

    sendRoomTextSafe(
      ws,
      targetRoomId,
      targetRoomName,
      buildTopText(topPlayers, parsed.lang),
    );

    return true;
  }



  const playerKey = getPlayerKey(roomMessage);
  const playerIdKey = getPlayerIdKey(roomMessage);
  const playerName = getPlayerName(roomMessage);

  if (!playerKey || !playerIdKey) {
    sendRoomTextSafe(
      ws,
      targetRoomId,
      targetRoomName,
      identifyErrorText(parsed.lang),
    );

    return true;
  }

  /*
    كل لاعب يستطيع استخدام "كف" مرة واحدة كل خمس دقائق،
    سواء كان سيبدأ تحديًا أو سينضم إلى تحدٍ قائم.
  */
  const cooldown = await consumeSlapCooldown({
    playerKey: playerIdKey,
    username: clean(roomMessage.fromUsername),
    userId: clean(roomMessage.fromUserId),
  });

  if (!cooldown.ok) {
    sendRoomTextSafe(
      ws,
      targetRoomId,
      targetRoomName,
      buildCooldownText(cooldown.waitSeconds, parsed.lang),
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
        sendRoomTextSafe(
          ws,
          targetRoomId,
          targetRoomName,
          disabledText(parsed.lang),
        );

        return true;
      }

      if (created.reason === 'starter_already_waiting') {
        sendRoomTextSafe(
          ws,
          targetRoomId,
          targetRoomName,
          buildWaitingText({
            playerName,
            lang: parsed.lang,
          }),
        );

        return true;
      }

      if (created.reason === 'already_active') {
        const starterName =
          clean(created.challenge?.starter?.username) ||
          clean(created.challenge?.starter?.userId) ||
          'لاعب';

        sendRoomTextSafe(
          ws,
          targetRoomId,
          targetRoomName,
          buildAlreadyActiveText({
            starterName,
            lang: parsed.lang,
          }),
        );

        return true;
      }

      sendRoomTextSafe(
        ws,
        targetRoomId,
        targetRoomName,
        parsed.lang === 'en'
          ? '❌ Could not create the slap challenge.'
          : '❌ تعذر إنشاء تحدي الكف.',
      );

      return true;
    }

    await sendToAllSlapRooms({
      ws,
      runtime,
      text: buildChallengeAnnouncement({
        playerName,
        prizePoints: created.settings.prizePoints,
        lang: parsed.lang,
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
    sendRoomTextSafe(
      ws,
      targetRoomId,
      targetRoomName,
      buildWaitingText({
        playerName,
        lang: parsed.lang,
      }),
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
      sendRoomTextSafe(
        ws,
        targetRoomId,
        targetRoomName,
        disabledText(parsed.lang),
      );

      return true;
    }

    if (resolved.reason === 'same_player') {
      sendRoomTextSafe(
        ws,
        targetRoomId,
        targetRoomName,
        buildSamePlayerText(parsed.lang),
      );

      return true;
    }

    if (resolved.reason === 'no_active_challenge') {
      sendRoomTextSafe(
        ws,
        targetRoomId,
        targetRoomName,
        noActiveChallengeText(parsed.lang),
      );

      return true;
    }

    sendRoomTextSafe(
      ws,
      targetRoomId,
      targetRoomName,
      parsed.lang === 'en'
        ? '❌ Could not finish the slap challenge.'
        : '❌ تعذر إنهاء تحدي الكف.',
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
await sendToSlapMatchRooms({
  ws,
  runtime,

  text: buildResultText({
    result: resolved.result,
    lang: parsed.lang,
  }),

  imageUrl: SLAP_RESULT_IMAGE_URL,

  starter: resolved.result.starter,
  joiner: resolved.result.joiner,

  fallbackRoomId: targetRoomId,
  fallbackRoomName: targetRoomName,
});
return true;

}