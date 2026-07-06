import {
  clean,
} from '../utils/text.js';

import {
  findSavedRoomUserByUsername,
} from '../services/roomUsers.service.js';

import {
  sendPrivateMessageByBot,
} from '../services/dmRelay.service.js';

function parsePrivateRelayCommand(text) {
  const raw = clean(text);

  /*
    Format:
    @username message
  */
  const match = raw.match(/^@([^\s@]+)\s+([\s\S]+)$/);

  if (!match) {
    return {
      isCommand: false,
      username: '',
      message: '',
    };
  }

  return {
    isCommand: true,
    username: clean(match[1]),
    message: clean(match[2]),
  };
}

export async function handlePrivateRelayCommand({
  roomMessage,
  ws,
  sessionInfo,
  targetRoomId,
  targetRoomName,
}) {
  const parsed = parsePrivateRelayCommand(roomMessage.text);

  if (!parsed.isCommand) {
    return false;
  }

  if (!parsed.username) {
    ws.sendRoomMessage(
      targetRoomId,
      '❌ Please write the username after @.',
      targetRoomName,
    );

    return true;
  }

  if (!parsed.message) {
    ws.sendRoomMessage(
      targetRoomId,
      '❌ Please write the message after the username.',
      targetRoomName,
    );

    return true;
  }

  const targetUser = await findSavedRoomUserByUsername({
    username: parsed.username,
    roomId: targetRoomId,
    roomName: targetRoomName,
    sessionInfo,
  });

  if (!targetUser) {
    ws.sendRoomMessage(
      targetRoomId,
      `❌ User ${parsed.username} was not found in this room data.\nUse .r or wait until the user joins the room so the bot can save them.`,
      targetRoomName,
    );

    return true;
  }

  const senderName = clean(roomMessage.fromUsername) || 'User';

  const textToSend = [
    `📩 Message from ${senderName}:`,
    '',
    parsed.message,
  ].join('\n');

  const result = await sendPrivateMessageByBot({
    ws,
    toUserId: targetUser.userId,
    toUsername: targetUser.username,
    text: textToSend,
  });

  if (!result.ok) {
    ws.sendRoomMessage(
      targetRoomId,
      `❌ Failed to send private message.\nReason: ${result.reason}`,
      targetRoomName,
    );

    return true;
  }

  ws.sendRoomMessage(
    targetRoomId,
    `✅ Private message sent to ${targetUser.username}.`,
    targetRoomName,
  );

  return true;
}