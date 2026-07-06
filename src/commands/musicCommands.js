import {
  buildMusicReply,
} from '../services/musicReply.service.js';

const musicCooldownMap = new Map();
const songsStore = new Map();
/*
  منع تنفيذ نفس رسالة الميوزك أكثر من مرة.
  لأن نفس الرسالة قد يقرأها music bot و controller bot معًا.
*/
const handledMusicMessages = new Map();
const HANDLED_MESSAGE_TTL_MS = 60 * 1000;

const activeMusicUsers = new Set();

function getMusicMessageKey(roomMessage) {
  const raw = roomMessage?.raw || {};

  const messageId =
    clean(raw.messageId) ||
    clean(raw.id) ||
    clean(raw._id);

  if (messageId) {
    return `id:${messageId}`;
  }

  return [
    clean(roomMessage.roomId),
    clean(roomMessage.roomName),
    clean(roomMessage.fromUserId),
    clean(roomMessage.fromUsername),
    clean(roomMessage.text),
    clean(raw.createdAt),
  ].join('|');
}

function isDuplicateMusicMessage(roomMessage) {
  const key = getMusicMessageKey(roomMessage);

  if (!key) {
    return false;
  }

  const now = Date.now();

  for (const [oldKey, time] of handledMusicMessages.entries()) {
    if (now - time > HANDLED_MESSAGE_TTL_MS) {
      handledMusicMessages.delete(oldKey);
    }
  }

  if (handledMusicMessages.has(key)) {
    return true;
  }

  handledMusicMessages.set(key, now);

  return false;
}

function getMusicUserKey(roomMessage) {
  return (
    clean(roomMessage.fromUserId) ||
    clean(roomMessage.fromUsername) ||
    'unknown'
  ).toLowerCase();
}

function isMusicUserBusy(roomMessage) {
  const key = getMusicUserKey(roomMessage);

  if (!key) {
    return false;
  }

  return activeMusicUsers.has(key);
}

function setMusicUserBusy(roomMessage) {
  const key = getMusicUserKey(roomMessage);

  if (!key) {
    return '';
  }

  activeMusicUsers.add(key);

  return key;
}

function clearMusicUserBusy(key) {
  if (key) {
    activeMusicUsers.delete(key);
  }
}
function clean(value) {
  return String(value || '').trim();
}

function normalizeCommand(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\s+/g, '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSenderName(roomMessage) {
  return (
    clean(roomMessage?.fromUsername) ||
    clean(roomMessage?.fromUserId) ||
    'unknown'
  );
}

function getMusicCooldownMs() {
  const value = Number(process.env.MUSIC_USER_COMMAND_COOLDOWN_MS || 30000);

  if (!Number.isFinite(value) || value < 0) {
    return 30000;
  }

  return value;
}

function checkMusicCooldown(username) {
  const key = clean(username).toLowerCase();
  const cooldownMs = getMusicCooldownMs();

  if (!key || cooldownMs <= 0) {
    return {
      ok: true,
      waitSeconds: 0,
    };
  }

  const now = Date.now();
  const lastAt = Number(musicCooldownMap.get(key) || 0);
  const diff = now - lastAt;

  if (lastAt && diff < cooldownMs) {
    return {
      ok: false,
      waitSeconds: Math.ceil((cooldownMs - diff) / 1000),
    };
  }

  musicCooldownMap.set(key, now);

  return {
    ok: true,
    waitSeconds: 0,
  };
}

function isRoomMessageEvent(data) {
  return (
    data &&
    data.handler === 'room.message' &&
    data.type === 'message' &&
    data.message
  );
}

function readRoomMessage(data) {
  const message = data?.message || {};

  return {
    raw: message,
    roomId: clean(message.roomId || data.roomId),
    roomName: clean(message.roomName || data.roomName || data.name),
    text: clean(message.text),
    fromUserId: clean(message.fromUserId),
    fromUsername: clean(message.fromUsername),
    fromRole: clean(message.fromRole),
  };
}

function shouldIgnoreOwnMessage({
  roomMessage,
  botUsername,
}) {
  const fromUsername = clean(roomMessage.fromUsername).toLowerCase();
  const currentBot = clean(botUsername).toLowerCase();

  if (!fromUsername || !currentBot) {
    return false;
  }

  return fromUsername === currentBot;
}

function isBotMusicStatusMessage(text) {
  const value = clean(text);

  return (
    value.startsWith('تعذر تشغيل الأغنية') ||
    value.startsWith('تعذر العثور على الأغنية') ||
    value.startsWith('تم العثور على:') ||
    value.startsWith('🎵 تم تجهيز الأغنية') ||
    value.startsWith('Loading:') ||
    value.startsWith('Song failed') ||
    value.startsWith('Failed to find song') ||
    value.startsWith('Could not play this song') ||
    value.startsWith('But failed to prepare')
  );
}

function musicHelpText() {
  return [
    '🎵 Music Bot Commands',
    '',
    'music help',
    'Show this help menu.',
    '',
    '🎧 Play in current room',
    '',
    'play song name',
    'Play song in current room.',
    '',
    'تشغيل اسم الأغنية',
    'تشغيل أغنية في الغرفة الحالية.',
    '',
    '🌍 Send to all rooms',
    '',
    '.ps song name',
    'Send song to all rooms.',
    '',
    '.so song name',
    'Send song to all rooms.',
    '',
    '.sh song name',
    'Send song to all rooms.',
    '',
    '❤️ Likes / Comments',
    '',
    'like@id',
    'Like a song.',
    '',
    'com@id@message',
    'Comment on a song.',
    '',
    'songlikes',
    'Show top liked users.',
  ].join('\n');
}

function isMusicHelpCommand(text) {
  const command = normalizeCommand(text);

  return (
    command === 'musichelp' ||
    command === 'music@help' ||
    command === 'mhelp'
  );
}

function parseMusicCommand(text) {
  const raw = clean(text);
  const command = normalizeCommand(raw);
  const lower = raw.toLowerCase();

  if (lower.startsWith('play ')) {
    return {
      isCommand: true,
      type: 'current',
      query: clean(raw.slice('play '.length)),
      lang: 'en',
    };
  }

  if (raw.startsWith('تشغيل ')) {
    return {
      isCommand: true,
      type: 'current',
      query: clean(raw.slice('تشغيل '.length)),
      lang: 'ar',
    };
  }

  if (
    lower.startsWith('.ps ') ||
    lower.startsWith('.so ') ||
    lower.startsWith('.sh ')
  ) {
    return {
      isCommand: true,
      type: 'broadcast',
      query: clean(raw.slice(4)),
      lang: 'ar',
    };
  }

  if (
    command === '.ps' ||
    command === '.so' ||
    command === '.sh'
  ) {
    return {
      isCommand: true,
      type: 'broadcast',
      query: '',
      lang: 'ar',
    };
  }

  const likeMatch = raw.match(/^like@(.+)$/i);

  if (likeMatch) {
    return {
      isCommand: true,
      type: 'like',
      songId: clean(likeMatch[1]),
      query: '',
      lang: 'en',
    };
  }

  const commentMatch = raw.match(/^com@([^@]+)@([\s\S]+)$/i);

  if (commentMatch) {
    return {
      isCommand: true,
      type: 'comment',
      songId: clean(commentMatch[1]),
      comment: clean(commentMatch[2]),
      query: '',
      lang: 'en',
    };
  }

  if (
    command === 'songlikes' ||
    command === 'likesongs' ||
    command === 'musiclikes'
  ) {
    return {
      isCommand: true,
      type: 'likes',
      query: '',
      lang: 'en',
    };
  }

  return {
    isCommand: false,
    type: '',
    query: '',
    lang: 'en',
  };
}

function getSongUrlFromResult(result) {
  if (!result) {
    return '';
  }

  const directUrl =
    result.publicUrl ||
    result.audioUrl ||
    result.mp3Url ||
    result.url ||
    result.songUrl ||
    '';

  if (directUrl) {
    return clean(directUrl);
  }

  const meta = result.meta || {};

  const metaUrl =
    meta.publicUrl ||
    meta.audioUrl ||
    meta.mp3Url ||
    meta.url ||
    meta.songUrl ||
    '';

  if (metaUrl) {
    return clean(metaUrl);
  }

  try {
    const fullText = JSON.stringify(result);

    const match = fullText.match(
      /https?:\/\/[^\s"'\\]+\/uploads\/audio-temp\/[^\s"'\\]+\.mp3/i,
    );

    if (match && match[0]) {
      return clean(match[0]);
    }
  } catch {}

  return '';
}

function makeSongId() {
  return `song_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function saveSong({
  songName,
  url,
  requestedBy,
  roomName,
}) {
  const song = {
    id: makeSongId(),
    songName,
    url,
    requestedBy,
    roomName,
    likes: [],
    comments: [],
    createdAt: new Date().toISOString(),
  };

  songsStore.set(song.id, song);

  return song;
}

function formatSongDetails(song) {
  return [
    song.songName,
    '',
    `${song.requestedBy}@${song.roomName}`,
    '',
    song.url,
    '',
    `like@${song.id}`,
    `com@${song.id}@msg`,
  ].join('\n');
}

function sendRoomTextSafe(socket, roomId, roomName, text) {
  if (!socket || !text) {
    return false;
  }

  if (typeof socket.sendRoomMessage === 'function') {
    try {
      socket.sendRoomMessage(roomId, text, roomName);
      return true;
    } catch {}

    try {
      socket.sendRoomMessage(text, roomName);
      return true;
    } catch {}

    try {
      socket.sendRoomMessage(text);
      return true;
    } catch {}
  }

  if (typeof socket.send === 'function') {
    socket.send(
      JSON.stringify({
        handler: 'room.message',
        roomId,
        roomName,
        text,
      }),
    );

    return true;
  }

  return false;
}

function sendRoomAudioSafe(socket, roomId, roomName, url) {
  if (!socket || !url) {
    return false;
  }

  if (typeof socket.sendRoomAudioUrl === 'function') {
    try {
      socket.sendRoomAudioUrl(roomId, url, roomName);
      return true;
    } catch {}

    try {
      socket.sendRoomAudioUrl(url, roomName);
      return true;
    } catch {}

    try {
      socket.sendRoomAudioUrl(url);
      return true;
    } catch {}
  }

  if (socket.socket && typeof socket.socket.sendRoomAudioUrl === 'function') {
    try {
      socket.socket.sendRoomAudioUrl(roomId, url, roomName);
      return true;
    } catch {}

    try {
      socket.socket.sendRoomAudioUrl(url, roomName);
      return true;
    } catch {}

    try {
      socket.socket.sendRoomAudioUrl(url);
      return true;
    } catch {}
  }

  if (socket.client && typeof socket.client.sendRoomAudioUrl === 'function') {
    try {
      socket.client.sendRoomAudioUrl(roomId, url, roomName);
      return true;
    } catch {}

    try {
      socket.client.sendRoomAudioUrl(url, roomName);
      return true;
    } catch {}

    try {
      socket.client.sendRoomAudioUrl(url);
      return true;
    } catch {}
  }

  console.log('❌ [MUSIC_AUDIO_SEND_FAILED]', {
    roomId,
    roomName,
    url,
    socketKeys: socket ? Object.keys(socket) : [],
  });

  return false;
}

function sendPrivateSafe(socket, to, text) {
  if (!socket || !to || !text) {
    return false;
  }

  if (typeof socket.sendPrivate === 'function') {
    return socket.sendPrivate(to, text);
  }

  if (typeof socket.sendDm === 'function') {
    return socket.sendDm(to, text);
  }

  if (typeof socket.sendDmMessage === 'function') {
    return socket.sendDmMessage(to, text);
  }

  return false;
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

async function prepareSong({
  songName,
  requestedBy,
  roomName,
  lang,
}) {
  const commandText = lang === 'en'
    ? `play ${songName}`
    : `تشغيل ${songName}`;

  const result = await buildMusicReply(commandText, {
    requestedBy,
    roomName,
  });

  if (!result) {
    return {
      ok: false,
      error: 'Song failed: empty result.',
    };
  }

  if (!result.handled) {
    return {
      ok: false,
      error: 'Song failed: not handled.',
    };
  }

  if (result.success === false) {
    return {
      ok: false,
      error: result.text || result.error || 'Song failed.',
    };
  }

  const title =
    result?.meta?.youtubeTitle ||
    result?.meta?.title ||
    result.title ||
    songName;

  const url = getSongUrlFromResult(result);

  if (!url) {
    return {
      ok: false,
      error: 'Song failed: no audio url.',
    };
  }

  return {
    ok: true,
    title,
    url,
  };
}

async function handleCurrentSong({
  roomMessage,
  ws,
  targetRoomId,
  targetRoomName,
  parsed,
}) {
  const senderName = getSenderName(roomMessage);

  if (!parsed.query) {
    sendRoomTextSafe(
      ws,
      targetRoomId,
      targetRoomName,
      parsed.lang === 'ar'
        ? 'اكتب اسم الأغنية بعد الأمر'
        : 'Write the song name after the command',
    );

    return true;
  }

  const cooldown = checkMusicCooldown(senderName);

  if (!cooldown.ok) {
    sendRoomTextSafe(
      ws,
      targetRoomId,
      targetRoomName,
      `Please wait ${cooldown.waitSeconds}s.`,
    );

    return true;
  }

  sendRoomTextSafe(
    ws,
    targetRoomId,
    targetRoomName,
    `Loading: ${parsed.query}`,
  );

  const prepared = await prepareSong({
    songName: parsed.query,
    requestedBy: senderName,
    roomName: targetRoomName,
    lang: parsed.lang,
  });

  if (!prepared.ok) {
    sendRoomTextSafe(
      ws,
      targetRoomId,
      targetRoomName,
      prepared.error || 'Song failed.',
    );

    return true;
  }

  const song = saveSong({
    songName: prepared.title,
    url: prepared.url,
    requestedBy: senderName,
    roomName: targetRoomName,
  });

  sendRoomTextSafe(
    ws,
    targetRoomId,
    targetRoomName,
    formatSongDetails(song),
  );

  const audioSent = sendRoomAudioSafe(
    ws,
    targetRoomId,
    targetRoomName,
    prepared.url,
  );

  if (!audioSent) {
    sendRoomTextSafe(
      ws,
      targetRoomId,
      targetRoomName,
      'تم تجهيز الأغنية لكن فشل إرسال ملف الصوت.',
    );
  }

  return true;
}

async function handleBroadcastSong({
  roomMessage,
  ws,
  runtime,
  targetRoomId,
  targetRoomName,
  parsed,
}) {
  const senderName = getSenderName(roomMessage);

  if (!parsed.query) {
    sendRoomTextSafe(
      ws,
      targetRoomId,
      targetRoomName,
      'Use: .ps song name',
    );

    return true;
  }

  const cooldown = checkMusicCooldown(senderName);

  if (!cooldown.ok) {
    sendRoomTextSafe(
      ws,
      targetRoomId,
      targetRoomName,
      `Please wait ${cooldown.waitSeconds}s.`,
    );

    return true;
  }

  sendRoomTextSafe(
    ws,
    targetRoomId,
    targetRoomName,
    `Loading: ${parsed.query}`,
  );

  const targets = prioritizeCurrentRoomTargets({
    targets: getBroadcastTargets({
      runtime,
      currentSocket: ws,
      currentRoomId: targetRoomId,
      currentRoomName: targetRoomName,
    }),
    currentSocket: ws,
    currentRoomId: targetRoomId,
    currentRoomName: targetRoomName,
  });

  if (!targets.length) {
    sendRoomTextSafe(
      ws,
      targetRoomId,
      targetRoomName,
      'No rooms found.',
    );

    return true;
  }

  const prepared = await prepareSong({
    songName: parsed.query,
    requestedBy: senderName,
    roomName: targetRoomName,
    lang: parsed.lang,
  });

  if (!prepared.ok) {
    sendRoomTextSafe(
      ws,
      targetRoomId,
      targetRoomName,
      prepared.error || 'Song failed.',
    );

    return true;
  }

  const song = saveSong({
    songName: prepared.title,
    url: prepared.url,
    requestedBy: senderName,
    roomName: targetRoomName,
  });

  const message = formatSongDetails(song);
  const delayMs = Number(process.env.MUSIC_BROADCAST_DELAY_MS || 1000);

  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];

    sendRoomTextSafe(
      target.socket,
      target.roomId || targetRoomId,
      target.roomName || targetRoomName,
      message,
    );

    const audioSent = sendRoomAudioSafe(
      target.socket,
      target.roomId || targetRoomId,
      target.roomName || targetRoomName,
      prepared.url,
    );

    if (!audioSent) {
      console.log('❌ [MUSIC_BROADCAST_AUDIO_FAILED]', {
        roomName: target.roomName,
        url: prepared.url,
      });
    }

    if (i < targets.length - 1) {
      await sleep(delayMs);
    }
  }

  return true;
}

function handleLikeSong({
  roomMessage,
  ws,
  targetRoomId,
  targetRoomName,
  parsed,
}) {
  const song = songsStore.get(parsed.songId);
  const senderName = getSenderName(roomMessage);

  if (!song) {
    sendRoomTextSafe(
      ws,
      targetRoomId,
      targetRoomName,
      'Not found or expired.',
    );

    return true;
  }

  if (clean(song.requestedBy).toLowerCase() === clean(senderName).toLowerCase()) {
    sendRoomTextSafe(
      ws,
      targetRoomId,
      targetRoomName,
      'You cannot like your own song.',
    );

    return true;
  }

  if (song.likes.includes(senderName)) {
    sendRoomTextSafe(
      ws,
      targetRoomId,
      targetRoomName,
      'Already liked.',
    );

    return true;
  }

  song.likes.push(senderName);

  sendRoomTextSafe(
    ws,
    targetRoomId,
    targetRoomName,
    [
      'Liked',
      song.songName,
      `Likes: ${song.likes.length}`,
    ].join('\n'),
  );

  sendPrivateSafe(
    ws,
    song.requestedBy,
    [
      'New like',
      song.songName,
      `From: ${senderName}`,
      `Likes: ${song.likes.length}`,
    ].join('\n'),
  );

  return true;
}

function handleCommentSong({
  roomMessage,
  ws,
  targetRoomId,
  targetRoomName,
  parsed,
}) {
  const song = songsStore.get(parsed.songId);
  const senderName = getSenderName(roomMessage);

  if (!song) {
    sendRoomTextSafe(
      ws,
      targetRoomId,
      targetRoomName,
      'Not found.',
    );

    return true;
  }

  if (!parsed.comment) {
    sendRoomTextSafe(
      ws,
      targetRoomId,
      targetRoomName,
      'Empty comment.',
    );

    return true;
  }

  song.comments.push({
    from: senderName,
    text: parsed.comment,
    at: new Date().toISOString(),
  });

  sendRoomTextSafe(
    ws,
    targetRoomId,
    targetRoomName,
    'Comment sent.',
  );

  sendPrivateSafe(
    ws,
    song.requestedBy,
    [
      'New comment',
      song.songName,
      `From: ${senderName}`,
      parsed.comment,
    ].join('\n'),
  );

  return true;
}

function handleSongLikes({
  ws,
  targetRoomId,
  targetRoomName,
}) {
  const usersMap = new Map();

  for (const song of songsStore.values()) {
    for (const username of song.likes || []) {
      const key = clean(username).toLowerCase();

      if (!key) {
        continue;
      }

      const old = usersMap.get(key) || {
        username,
        likesCount: 0,
      };

      old.likesCount += 1;
      usersMap.set(key, old);
    }
  }

  const topUsers = Array.from(usersMap.values())
    .sort((a, b) => {
      return b.likesCount - a.likesCount;
    })
    .slice(0, 10);

  if (!topUsers.length) {
    sendRoomTextSafe(
      ws,
      targetRoomId,
      targetRoomName,
      'No likes.',
    );

    return true;
  }

  const lines = topUsers.map((user, index) => {
    return `${index + 1}. ${user.username} | ${user.likesCount} likes`;
  });

  sendRoomTextSafe(
    ws,
    targetRoomId,
    targetRoomName,
    [
      'Top liked users:',
      '',
      ...lines,
    ].join('\n'),
  );

  return true;
}

async function handleControllerMusicCommand({
  roomMessage,
  ws,
  runtime,
  targetRoomId,
  targetRoomName,
}) {
  const parsed = parseMusicCommand(roomMessage.text);

  if (!parsed.isCommand) {
    return false;
  }

  /*
    مهم جدًا:
    يمنع نفس أمر الميوزك أن يتنفذ مرتين.
    هذا يحل مشكلة ظهور Please wait 30s من أول مرة.
  */
  if (isDuplicateMusicMessage(roomMessage)) {
    return true;
  }

  /*
    اللايك والتعليق والترتيب لا يدخلوا في busy/cooldown.
  */
  if (
    parsed.type !== 'like' &&
    parsed.type !== 'comment' &&
    parsed.type !== 'likes'
  ) {
    if (isMusicUserBusy(roomMessage)) {
      sendRoomTextSafe(
        ws,
        targetRoomId,
        targetRoomName,
        '⏳ الأغنية السابقة ما زالت قيد التجهيز.',
      );

      return true;
    }
  }

  if (parsed.type === 'current') {
    const busyKey = setMusicUserBusy(roomMessage);

    try {
      return await handleCurrentSong({
        roomMessage,
        ws,
        targetRoomId,
        targetRoomName,
        parsed,
      });
    } finally {
      clearMusicUserBusy(busyKey);
    }
  }

  if (parsed.type === 'broadcast') {
    const busyKey = setMusicUserBusy(roomMessage);

    try {
      return await handleBroadcastSong({
        roomMessage,
        ws,
        runtime,
        targetRoomId,
        targetRoomName,
        parsed,
      });
    } finally {
      clearMusicUserBusy(busyKey);
    }
  }

  if (parsed.type === 'like') {
    return handleLikeSong({
      roomMessage,
      ws,
      targetRoomId,
      targetRoomName,
      parsed,
    });
  }

  if (parsed.type === 'comment') {
    return handleCommentSong({
      roomMessage,
      ws,
      targetRoomId,
      targetRoomName,
      parsed,
    });
  }

  if (parsed.type === 'likes') {
    return handleSongLikes({
      ws,
      targetRoomId,
      targetRoomName,
    });
  }

  return false;
}
export async function handleMusicRoomCommand({
  data,
  ws,
  sessionInfo,
  runtime,
}) {
  if (!isRoomMessageEvent(data)) {
    return false;
  }

  const roomMessage = readRoomMessage(data);

  if (!roomMessage.text) {
    return false;
  }

  if (isBotMusicStatusMessage(roomMessage.text)) {
    return false;
  }

  if (
    shouldIgnoreOwnMessage({
      roomMessage,
      botUsername: sessionInfo?.username,
    })
  ) {
    return false;
  }

  console.log(
    `📥 [music:${sessionInfo?.username || 'unknown'}] ROOM_COMMAND`,
    {
      text: roomMessage.text,
      roomId: roomMessage.roomId,
      roomName: roomMessage.roomName,
      fromUserId: roomMessage.fromUserId,
      fromUsername: roomMessage.fromUsername,
    },
  );

  const targetRoomId =
    sessionInfo?.roomId ||
    roomMessage.roomId ||
    sessionInfo?.room ||
    '';

  const targetRoomName =
    roomMessage.roomName ||
    sessionInfo?.roomName ||
    sessionInfo?.room ||
    '';

  if (isMusicHelpCommand(roomMessage.text)) {
    sendRoomTextSafe(
      ws,
      targetRoomId,
      targetRoomName,
      musicHelpText(),
    );

    return true;
  }

  return handleControllerMusicCommand({
    roomMessage,
    ws,
    runtime,
    targetRoomId,
    targetRoomName,
  });
}

export {
  handleControllerMusicCommand,
};