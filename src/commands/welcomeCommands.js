import {
  clean,
  normalizeCommand,
} from '../utils/text.js';

import {
  setRoomWelcomeEnabled,
  setRoomWelcomeMessage,
  getRoomWelcomeSettings,
  isControllerOwnerOrMaster,
} from '../services/roomWelcome.service.js';

function parseWelcomeCommand(text) {
  const raw = clean(text);
  const command = normalizeCommand(raw);

  if (command === 'wc@on') {
    return {
      command: 'welcome_on',
      message: '',
    };
  }

  if (command === 'wc@off') {
    return {
      command: 'welcome_off',
      message: '',
    };
  }

  if (raw.toLowerCase().startsWith('wcmsg@')) {
    return {
      command: 'welcome_message',
      message: clean(raw.slice(6)),
    };
  }

  if (command === 'wc@status') {
    return {
      command: 'welcome_status',
      message: '',
    };
  }

  return {
    command: '',
    message: '',
  };
}

export async function handleWelcomeCommand({
  roomMessage,
  ws,
  sessionInfo,
  targetRoomId,
  targetRoomName,
}) {
  const parsed = parseWelcomeCommand(roomMessage.text);

  if (!parsed.command) {
    return false;
  }

  const allowed = await isControllerOwnerOrMaster({
    roomMessage,
    roomId: targetRoomId,
    roomName: targetRoomName,
    sessionInfo,
  });

  if (!allowed) {
    ws.sendRoomMessage(
      targetRoomId,
      '❌ Only the controller owner or a master can use welcome commands.',
      targetRoomName,
    );

    return true;
  }

  const updatedBy = clean(roomMessage.fromUsername) ||
    clean(roomMessage.fromUserId);

  if (parsed.command === 'welcome_on') {
    await setRoomWelcomeEnabled({
      roomId: targetRoomId,
      roomName: targetRoomName,
      sessionInfo,
      enabled: true,
      updatedBy,
    });

    ws.sendRoomMessage(
      targetRoomId,
      '✅ Welcome message is now ON.',
      targetRoomName,
    );

    return true;
  }

  if (parsed.command === 'welcome_off') {
    await setRoomWelcomeEnabled({
      roomId: targetRoomId,
      roomName: targetRoomName,
      sessionInfo,
      enabled: false,
      updatedBy,
    });

    ws.sendRoomMessage(
      targetRoomId,
      '✅ Welcome message is now OFF.',
      targetRoomName,
    );

    return true;
  }

  if (parsed.command === 'welcome_message') {
    if (!parsed.message) {
      ws.sendRoomMessage(
        targetRoomId,
        '❌ Welcome message is required.\nExample: wcmsg@Welcome $',
        targetRoomName,
      );

      return true;
    }

    const result = await setRoomWelcomeMessage({
      roomId: targetRoomId,
      roomName: targetRoomName,
      sessionInfo,
      message: parsed.message,
      updatedBy,
    });

    if (!result.ok) {
      if (result.reason === 'message_too_long') {
        ws.sendRoomMessage(
          targetRoomId,
          `❌ Welcome message is too long. Max length is ${result.maxLength} characters.`,
          targetRoomName,
        );

        return true;
      }

      ws.sendRoomMessage(
        targetRoomId,
        `❌ Failed to save welcome message.\nReason: ${result.reason}`,
        targetRoomName,
      );

      return true;
    }

    ws.sendRoomMessage(
      targetRoomId,
      `✅ Welcome message saved.\nPreview: ${parsed.message.replaceAll('$', clean(roomMessage.fromUsername) || 'User')}`,
      targetRoomName,
    );

    return true;
  }

  if (parsed.command === 'welcome_status') {
    const settings = await getRoomWelcomeSettings({
      roomId: targetRoomId,
      roomName: targetRoomName,
      sessionInfo,
    });

    ws.sendRoomMessage(
      targetRoomId,
      [
        '👋 Welcome Settings',
        '',
        `Status: ${settings.enabled ? 'ON' : 'OFF'}`,
        `Message: ${settings.message}`,
        '',
        'Use $ inside the message to insert the joined username.',
      ].join('\n'),
      targetRoomName,
    );

    return true;
  }

  return false;
}
