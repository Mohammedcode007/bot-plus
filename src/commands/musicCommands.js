import {
  isRoomMessageEvent,
  readRoomMessage,
} from './roomCommands.js';

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
    'More music commands coming soon.',
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

  if (isMusicHelpCommand(roomMessage.text)) {
    const targetRoomId =
      sessionInfo.roomId ||
      roomMessage.roomId ||
      sessionInfo.room;

    const targetRoomName =
      roomMessage.roomName ||
      sessionInfo.room;

    ws.sendRoomMessage(
      targetRoomId,
      musicHelpText(),
      targetRoomName,
    );

    return true;
  }

  return false;
}