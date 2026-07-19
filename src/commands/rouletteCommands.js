import {
  clean,
  normalizeCommand,
  normalizeName,
} from '../utils/text.js';

import {
  consumeRouletteCooldown,
  createRouletteRound,
  getActiveRouletteRound,
  getRouletteTopPlayers,
  joinRouletteRound,
  resolveRouletteRound,
} from '../services/rouletteGame.service.js';

// ============================================================
// ضع رابط فيديو نتيجة الروليت هنا
// مثال: https://te-bot.site/uploads/badges/roulette.mp4
// ويمكنك بدلًا منه استخدام ROULETTE_RESULT_VIDEO_URL في ملف البيئة.
// ============================================================
const ROULETTE_RESULT_VIDEO_URL = String(
  process.env.ROULETTE_RESULT_VIDEO_URL ||
    'https://te-bot.site/uploads/badges/Roulette.json',
).trim();
// ============================================================

const rouletteTimers = new Map();

function parseRouletteCommand(text) {
  const command = normalizeCommand(text);

  if (command === 'روليت' || command === 'roulette') {
    return { isCommand: true, type: 'play', lang: command === 'roulette' ? 'en' : 'ar' };
  }

  if (
    command === 'روليت توب' ||
    command === 'توب روليت' ||
    command === 'roulettetop' ||
    command === 'roulette-top'
  ) {
    return { isCommand: true, type: 'top', lang: command.includes('roulette') ? 'en' : 'ar' };
  }

  return { isCommand: false, type: '', lang: 'ar' };
}

function getPlayerKey(roomMessage) {
  return clean(roomMessage.fromUserId) || normalizeName(roomMessage.fromUsername);
}

function getPlayerName(roomMessage) {
  return clean(roomMessage.fromUsername) || clean(roomMessage.fromUserId) || 'لاعب';
}

function normalizeRoomName(value) {
  return clean(value).toLowerCase();
}

function isMusicKey(key) {
  return clean(key).toLowerCase().startsWith('music:');
}

function isControllerKey(key) {
  const value = clean(key).toLowerCase();
  return value.startsWith('controller:') || value.startsWith('control:') || value.startsWith('bot_controller:');
}

function getRoomFromConnectionKey(key) {
  const raw = clean(key);
  if (isMusicKey(raw)) return clean(raw.replace(/^music:/i, ''));
  const parts = raw.split(':');
  return clean(parts[1]);
}

function getBroadcastTargets({ runtime, currentSocket, currentRoomId, currentRoomName }) {
  const targets = new Map();
  const connections = runtime?.registry?.connections instanceof Map
    ? runtime.registry.connections
    : null;

  if (connections) {
    for (const [key, instance] of connections.entries()) {
      if (!isMusicKey(key) && !isControllerKey(key)) continue;
      if (!instance || typeof instance.sendRoomMessage !== 'function') continue;

      const roomName =
        getRoomFromConnectionKey(key) ||
        instance.roomName ||
        instance?.bot?.roomName ||
        instance?.bot?.room ||
        '';

      const roomId = instance.roomId || instance?.bot?.roomId || '';
      const roomKey = normalizeRoomName(roomName) || clean(roomId);
      if (!roomKey || targets.has(roomKey)) continue;

      targets.set(roomKey, { socket: instance, roomId, roomName });
    }
  }

  const fallbackKey = normalizeRoomName(currentRoomName) || clean(currentRoomId) || 'current';
  if (!targets.has(fallbackKey) && currentSocket) {
    targets.set(fallbackKey, {
      socket: currentSocket,
      roomId: currentRoomId,
      roomName: currentRoomName,
    });
  }

  return Array.from(targets.values());
}

function sendRoomTextSafe(socket, roomId, roomName, text) {
  if (!socket || !text) return false;

  if (typeof socket.sendRoomMessage === 'function') {
    try {
      socket.sendRoomMessage(roomId, text, roomName);
      return true;
    } catch (error) {
      console.log('⚠️ [ROULETTE_SEND_TEXT_FAILED]', error?.message || error);
    }
  }

  if (typeof socket.send === 'function') {
    socket.send({
      handler: 'room.message.send',
      roomId: clean(roomId),
      roomName: clean(roomName),
      type: 'text',
      text: String(text),
    });
    return true;
  }

  return false;
}

function isValidVideoUrl(value) {
  const url = clean(value);
  return /^https?:\/\//i.test(url) && url !== 'PUT_ROULETTE_RESULT_VIDEO_URL_HERE';
}

function sendRoomVideoSafe(socket, roomId, roomName, videoUrl) {
  const url = clean(videoUrl);
  if (!socket || !isValidVideoUrl(url)) return false;

  if (typeof socket.sendRoomVideoUrl === 'function') {
    try {
      socket.sendRoomVideoUrl(roomId, url, roomName);
      return true;
    } catch (error) {
      console.log('⚠️ [ROULETTE_SEND_VIDEO_URL_FAILED]', error?.message || error);
    }
  }

  if (typeof socket.send === 'function') {
    try {
      socket.send({
        handler: 'room.message.send',
        roomId: clean(roomId),
        roomName: clean(roomName),
        type: 'video',
        text: '',
        url,
        media: {
          url,
          fileName: 'roulette-result.mp4',
          mimeType: 'video/mp4',
          sizeBytes: 0,
        },
      });
      return true;
    } catch (error) {
      console.log('⚠️ [ROULETTE_SEND_VIDEO_FAILED]', error?.message || error);
    }
  }

  return false;
}

async function sendAnnouncementToAllRooms({ ws, runtime, targetRoomId, targetRoomName, text }) {
  const targets = getBroadcastTargets({
    runtime,
    currentSocket: ws,
    currentRoomId: targetRoomId,
    currentRoomName: targetRoomName,
  });

  for (const target of targets) {
    sendRoomTextSafe(target.socket, target.roomId || targetRoomId, target.roomName || targetRoomName, text);
  }
}

async function sendResultToParticipatingRooms({
  ws,
  runtime,
  targetRoomId,
  targetRoomName,
  result,
  text,
}) {
  const targets = getBroadcastTargets({
    runtime,
    currentSocket: ws,
    currentRoomId: targetRoomId,
    currentRoomName: targetRoomName,
  });

  const participatingRooms = new Map();

  for (const player of result.humanPlayers || []) {
    const roomId = clean(player.roomId);
    const roomName = clean(player.roomName);
    const key = normalizeRoomName(roomName) || roomId;
    if (!key) continue;
    participatingRooms.set(key, { roomId, roomName });
  }

  for (const [roomKey, room] of participatingRooms.entries()) {
    const target = targets.find((item) => {
      const key = normalizeRoomName(item.roomName) || clean(item.roomId);
      return key === roomKey;
    });

    const socket = target?.socket || ws;
    const finalRoomId = target?.roomId || room.roomId || targetRoomId;
    const finalRoomName = target?.roomName || room.roomName || targetRoomName;

    sendRoomTextSafe(socket, finalRoomId, finalRoomName, text);
    sendRoomVideoSafe(socket, finalRoomId, finalRoomName, ROULETTE_RESULT_VIDEO_URL);
  }
}

function formatDuration(ms) {
  const totalSeconds = Math.max(1, Math.ceil(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return [minutes ? `${minutes} د` : '', seconds ? `${seconds} ث` : ''].filter(Boolean).join(' ');
}

function buildStartText({ playerName, maxPlayers, joinDurationMs, lang }) {
  if (lang === 'en') {
    return [
      `🎰 ${playerName} started a roulette round!`,
      `Type roulette to join (${maxPlayers} players maximum).`,
      `The round starts in ${Math.ceil(joinDurationMs / 1000)} seconds or immediately when full.`,
    ].join('\n');
  }

  return [
    `🎰 بدأ ${playerName} جولة روليت جديدة!`,
    `اكتب روليت للانضمام — الحد الأقصى ${maxPlayers} لاعبين.`,
    `تبدأ النتيجة بعد ${Math.ceil(joinDurationMs / 1000)} ثانية أو فور اكتمال العدد.`,
  ].join('\n');
}

function buildJoinText({ playerName, current, maxPlayers, lang }) {
  return lang === 'en'
    ? `✅ ${playerName} joined roulette (${current}/${maxPlayers}).`
    : `✅ انضم ${playerName} إلى الروليت (${current}/${maxPlayers}).`;
}

function buildResultText(result, lang) {
  const names = (result.players || []).map((player, index) => {
    const name = clean(player.username) || clean(player.userId) || `Player ${index + 1}`;
    return `${index + 1}. ${name}`;
  });

  const winnerName = clean(result.winner?.username) || clean(result.winner?.userId) || 'الفائز';

  if (lang === 'en') {
    return [
      '🎰 Roulette result',
      '',
      ...names,
      '',
      `🏆 Winner: ${winnerName}`,
      result.playedAgainstComputer ? '🤖 This round was played against the computer.' : '',
    ].filter(Boolean).join('\n');
  }

  return [
    '🎰 نتيجة لعبة الروليت',
    '',
    ...names,
    '',
    `🏆 الفائز: ${winnerName}`,
    result.playedAgainstComputer ? '🤖 تم لعب هذه الجولة ضد الجهاز لعدم انضمام لاعب آخر.' : '',
  ].filter(Boolean).join('\n');
}

function buildCooldownText(waitSeconds, lang) {
  const remaining = formatDuration(Number(waitSeconds || 0) * 1000);
  return lang === 'en'
    ? `⏳ You can play again after ${remaining}.`
    : `⏳ يمكنك لعب الروليت مرة أخرى بعد ${remaining}.`;
}

function buildTopText(players, lang) {
  if (!players.length) {
    return lang === 'en' ? '🎰 No roulette winners yet.' : '🎰 لا يوجد فائزون في الروليت حتى الآن.';
  }

  const lines = players.map((player, index) => {
    const name = clean(player.username) || clean(player.userId) || clean(player.playerKey) || 'مجهول';
    return `${index + 1}. ${name} — 🏆 ${Number(player.wins || 0)}`;
  });

  return [lang === 'en' ? '🎰 Top roulette players' : '🎰 أفضل لاعبي الروليت', '', ...lines].join('\n');
}

async function finishRound({ roundId, ws, runtime, targetRoomId, targetRoomName, lang }) {
  const timer = rouletteTimers.get(roundId);
  if (timer) {
    clearTimeout(timer);
    rouletteTimers.delete(roundId);
  }

  const resolved = await resolveRouletteRound(roundId);
  if (!resolved.ok) return false;

  await sendResultToParticipatingRooms({
    ws,
    runtime,
    targetRoomId,
    targetRoomName,
    result: resolved.result,
    text: buildResultText(resolved.result, lang),
  });

  return true;
}

function scheduleRoundFinish({ round, ws, runtime, targetRoomId, targetRoomName, lang }) {
  const oldTimer = rouletteTimers.get(round.id);
  if (oldTimer) clearTimeout(oldTimer);

  const delayMs = Math.max(0, new Date(round.closesAt).getTime() - Date.now());
  const timer = setTimeout(() => {
    finishRound({
      roundId: round.id,
      ws,
      runtime,
      targetRoomId,
      targetRoomName,
      lang,
    }).catch((error) => {
      console.log('⚠️ [ROULETTE_AUTO_FINISH_FAILED]', error?.message || error);
    });
  }, delayMs);

  timer.unref?.();
  rouletteTimers.set(round.id, timer);
}

export async function handleRouletteCommand({
  roomMessage,
  ws,
  runtime,
  targetRoomId,
  targetRoomName,
}) {
  const parsed = parseRouletteCommand(roomMessage.text);
  if (!parsed.isCommand) return false;

  if (parsed.type === 'top') {
    const top = await getRouletteTopPlayers(10);
    sendRoomTextSafe(ws, targetRoomId, targetRoomName, buildTopText(top, parsed.lang));
    return true;
  }

  const playerKey = getPlayerKey(roomMessage);
  const playerName = getPlayerName(roomMessage);

  if (!playerKey) {
    sendRoomTextSafe(ws, targetRoomId, targetRoomName, '❌ تعذر تحديد بيانات اللاعب.');
    return true;
  }

  const activeBeforeCooldown = await getActiveRouletteRound();
  const alreadyJoined = activeBeforeCooldown?.players?.some(
    (player) => normalizeName(player.playerKey) === normalizeName(playerKey),
  );

  if (alreadyJoined) {
    sendRoomTextSafe(
      ws,
      targetRoomId,
      targetRoomName,
      parsed.lang === 'en' ? 'ℹ️ You already joined this round.' : 'ℹ️ أنت منضم بالفعل إلى هذه الجولة.',
    );
    return true;
  }

  const cooldown = await consumeRouletteCooldown({
    playerKey,
    username: clean(roomMessage.fromUsername),
    userId: clean(roomMessage.fromUserId),
  });

  if (!cooldown.ok) {
    sendRoomTextSafe(ws, targetRoomId, targetRoomName, buildCooldownText(cooldown.waitSeconds, parsed.lang));
    return true;
  }

  const playerData = {
    playerKey,
    username: clean(roomMessage.fromUsername),
    userId: clean(roomMessage.fromUserId),
    roomId: targetRoomId,
    roomName: targetRoomName,
  };

  const activeRound = await getActiveRouletteRound();

  if (!activeRound) {
    const created = await createRouletteRound(playerData);

    if (!created.ok) {
      sendRoomTextSafe(ws, targetRoomId, targetRoomName, '❌ تعذر بدء جولة الروليت.');
      return true;
    }

    await sendAnnouncementToAllRooms({
      ws,
      runtime,
      targetRoomId,
      targetRoomName,
      text: buildStartText({
        playerName,
        maxPlayers: created.settings.maxPlayers,
        joinDurationMs: created.settings.joinDurationMs,
        lang: parsed.lang,
      }),
    });

    scheduleRoundFinish({
      round: created.round,
      ws,
      runtime,
      targetRoomId,
      targetRoomName,
      lang: parsed.lang,
    });

    return true;
  }

  const joined = await joinRouletteRound(playerData);

  if (!joined.ok) {
    const messages = {
      already_joined: 'ℹ️ أنت منضم بالفعل إلى هذه الجولة.',
      round_full: 'ℹ️ اكتمل عدد لاعبي الروليت.',
      no_active_round: 'ℹ️ انتهت الجولة السابقة. اكتب روليت لبدء جولة جديدة.',
    };

    sendRoomTextSafe(
      ws,
      targetRoomId,
      targetRoomName,
      messages[joined.reason] || '❌ تعذر الانضمام إلى الروليت.',
    );
    return true;
  }

  await sendAnnouncementToAllRooms({
    ws,
    runtime,
    targetRoomId,
    targetRoomName,
    text: buildJoinText({
      playerName,
      current: joined.round.players.length,
      maxPlayers: joined.settings.maxPlayers,
      lang: parsed.lang,
    }),
  });

  if (joined.isFull) {
    await finishRound({
      roundId: joined.round.id,
      ws,
      runtime,
      targetRoomId,
      targetRoomName,
      lang: parsed.lang,
    });
  } else if (!rouletteTimers.has(joined.round.id)) {
    scheduleRoundFinish({
      round: joined.round,
      ws,
      runtime,
      targetRoomId,
      targetRoomName,
      lang: parsed.lang,
    });
  }

  return true;
}
