import {
  isRoomMessageEvent,
  readRoomMessage,
} from './roomCommands.js';

import {
  handleControllerMusicCommand,
} from './controllerMusicCommands.js';

function clean(value) {
  return String(value || '').trim();
}

function normalizeCommand(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\s+/g, '');
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

  if (
    shouldIgnoreOwnMessage({
      roomMessage,
      botUsername: sessionInfo.username,
    })
  ) {
    return false;
  }

  console.log(
    `📥 [music:${sessionInfo.username}] ROOM_COMMAND`,
    {
      text: roomMessage.text,
      roomId: roomMessage.roomId,
      roomName: roomMessage.roomName,
      fromUserId: roomMessage.fromUserId,
      fromUsername: roomMessage.fromUsername,
    },
  );

  const targetRoomId =
    sessionInfo.roomId ||
    roomMessage.roomId ||
    sessionInfo.room;

  const targetRoomName =
    roomMessage.roomName ||
    sessionInfo.room;

  if (isMusicHelpCommand(roomMessage.text)) {
    ws.sendRoomMessage(
      targetRoomId,
      musicHelpText(),
      targetRoomName,
    );

    return true;
  }

  const musicCommandHandled = await handleControllerMusicCommand({
    roomMessage,
    ws,
    runtime,
    targetRoomId,
    targetRoomName,
  });

  if (musicCommandHandled) {
    return true;
  }

  return false;
}