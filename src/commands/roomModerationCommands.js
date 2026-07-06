import {
  clean,
  normalizeCommand,
  normalizeName,
} from '../utils/text.js';

import {
  findSavedRoomUserByUsername,
} from '../services/roomUsers.service.js';

import {
  sendRoomRoleSet,
  sendRoomKick,
  sendRoomBan,
} from '../services/roomAdminActions.service.js';

const ROOM_MASTERS_FILE_PATH = 'data/room-masters.json';

function parseModerationCommand(text) {
  const raw = clean(text);

  if (!raw) {
    return {
      isCommand: false,
      action: '',
      username: '',
      role: '',
    };
  }

  /*
    Forms:
    o@username
    a@username
    m@username
    b@username
    k@username
  */
  const atMatch = raw.match(/^([oambkOAMBK])@(.+)$/);

  if (atMatch) {
    return commandFromLetter({
      letter: atMatch[1],
      username: atMatch[2],
    });
  }

  /*
    Forms:
    .o username
    .a username
    .m username
    .b username
    .k username
  */
  const dotMatch = raw.match(/^\.([oambkOAMBK])\s+(.+)$/);

  if (dotMatch) {
    return commandFromLetter({
      letter: dotMatch[1],
      username: dotMatch[2],
    });
  }

  return {
    isCommand: false,
    action: '',
    username: '',
    role: '',
  };
}

function commandFromLetter({
  letter,
  username,
}) {
  const key = normalizeCommand(letter);
  const targetUsername = clean(username);

  if (!targetUsername) {
    return {
      isCommand: true,
      action: '',
      username: '',
      role: '',
      reason: 'missing_username',
    };
  }

  if (key === 'o') {
    return {
      isCommand: true,
      action: 'set_role',
      username: targetUsername,
      role: 'owner',
    };
  }

  if (key === 'a') {
    return {
      isCommand: true,
      action: 'set_role',
      username: targetUsername,
      role: 'admin',
    };
  }

  if (key === 'm') {
    return {
      isCommand: true,
      action: 'set_role',
      username: targetUsername,
      role: 'member',
    };
  }

  if (key === 'b') {
    return {
      isCommand: true,
      action: 'ban',
      username: targetUsername,
      role: '',
    };
  }

  if (key === 'k') {
    return {
      isCommand: true,
      action: 'kick',
      username: targetUsername,
      role: '',
    };
  }

  return {
    isCommand: false,
    action: '',
    username: '',
    role: '',
  };
}

function getRoomStoreKey({
  roomId,
  roomName,
  sessionInfo,
}) {
  return clean(roomId) ||
    clean(roomName) ||
    clean(sessionInfo?.roomId) ||
    clean(sessionInfo?.room) ||
    'unknown_room';
}

/*
  لا نقرأ بالـ import حتى لا نعمل circular dependency مع roomCommands.js.
*/
async function readJsonFileSafe(filePath, defaultData) {
  const fs = await import('fs/promises');
  const path = await import('path');

  const resolvedPath = path.default.resolve(filePath);

  try {
    await fs.default.mkdir(
      path.default.dirname(resolvedPath),
      {
        recursive: true,
      },
    );

    await fs.default.access(resolvedPath);
  } catch {
    await fs.default.writeFile(
      resolvedPath,
      JSON.stringify(defaultData, null, 2),
      'utf8',
    );
  }

  try {
    const raw = await fs.default.readFile(resolvedPath, 'utf8');
    const data = JSON.parse(raw || '{}');

    return data && typeof data === 'object'
      ? data
      : defaultData;
  } catch {
    return defaultData;
  }
}

async function isControllerOwnerOrMaster({
  roomMessage,
  sessionInfo,
  targetRoomId,
  targetRoomName,
}) {
  const createdBy = normalizeName(sessionInfo?.createdBy);
  const fromUsername = normalizeName(roomMessage?.fromUsername);
  const fromUserId = normalizeName(roomMessage?.fromUserId);

  /*
    Controller owner.
  */
  if (
    createdBy &&
    (
      createdBy === fromUsername ||
      createdBy === fromUserId
    )
  ) {
    return true;
  }

  /*
    Controller masters.
  */
  const store = await readJsonFileSafe(
    ROOM_MASTERS_FILE_PATH,
    {
      rooms: {},
    },
  );

  store.rooms ||= {};

  const key = getRoomStoreKey({
    roomId: targetRoomId,
    roomName: targetRoomName,
    sessionInfo,
  });

  const record = store.rooms?.[key];

  if (!record || !Array.isArray(record.masters)) {
    return false;
  }

  return record.masters.some((master) => {
    const masterUsername = normalizeName(master.username);
    const masterUserId = normalizeName(master.userId);

    return (
      (masterUsername && masterUsername === fromUsername) ||
      (masterUserId && masterUserId === fromUserId)
    );
  });
}

async function findTargetUser({
  username,
  targetRoomId,
  targetRoomName,
  sessionInfo,
}) {
  const savedUser = await findSavedRoomUserByUsername({
    username,
    roomId: targetRoomId,
    roomName: targetRoomName,
    sessionInfo,
  });

  /*
    لو لم نجده في room-users.json، نرجع username فقط.
    بعض الباك يقبل targetUsername.
  */
  if (!savedUser) {
    return {
      userId: '',
      username,
      foundInRoomUsers: false,
    };
  }

  return {
    userId: clean(savedUser.userId),
    username: clean(savedUser.username) || username,
    foundInRoomUsers: true,
  };
}

export async function handleRoomModerationCommand({
  roomMessage,
  ws,
  sessionInfo,
  targetRoomId,
  targetRoomName,
}) {
  const parsed = parseModerationCommand(roomMessage.text);

  if (!parsed.isCommand) {
    return false;
  }

  if (!parsed.username) {
    ws.sendRoomMessage(
      targetRoomId,
      '❌ Username is required.',
      targetRoomName,
    );

    return true;
  }

  const allowed = await isControllerOwnerOrMaster({
    roomMessage,
    sessionInfo,
    targetRoomId,
    targetRoomName,
  });

  if (!allowed) {
    ws.sendRoomMessage(
      targetRoomId,
      '❌ This command is only for controller owner or masters.',
      targetRoomName,
    );

    return true;
  }

  const targetUser = await findTargetUser({
    username: parsed.username,
    targetRoomId,
    targetRoomName,
    sessionInfo,
  });

if (!targetUser.foundInRoomUsers || !targetUser.userId) {
  ws.sendRoomMessage(
    targetRoomId,
    `❌ ${parsed.username} was not found in saved room users.\nUse .r first and make sure the user is currently inside the room.`,
    targetRoomName,
  );

  return true;
}
  if (parsed.action === 'set_role') {
    const result = sendRoomRoleSet({
      ws,
      roomId: targetRoomId,
      roomName: targetRoomName,
      targetUserId: targetUser.userId,
      targetUsername: targetUser.username,
      role: parsed.role,
    });

    if (!result.ok) {
      ws.sendRoomMessage(
        targetRoomId,
        `❌ Failed to set role.\nReason: ${result.reason}`,
        targetRoomName,
      );

      return true;
    }

    ws.sendRoomMessage(
      targetRoomId,
      `✅ Sent role command: ${targetUser.username} => ${parsed.role}`,
      targetRoomName,
    );

    return true;
  }

  if (parsed.action === 'kick') {
    const result = sendRoomKick({
      ws,
      roomId: targetRoomId,
      roomName: targetRoomName,
      targetUserId: targetUser.userId,
      targetUsername: targetUser.username,
    });

    if (!result.ok) {
      ws.sendRoomMessage(
        targetRoomId,
        `❌ Failed to kick user.\nReason: ${result.reason}`,
        targetRoomName,
      );

      return true;
    }

    ws.sendRoomMessage(
      targetRoomId,
      `✅ Sent kick command for ${targetUser.username}.`,
      targetRoomName,
    );

    return true;
  }

  if (parsed.action === 'ban') {
    const result = sendRoomBan({
      ws,
      roomId: targetRoomId,
      roomName: targetRoomName,
      targetUserId: targetUser.userId,
      targetUsername: targetUser.username,
    });

    if (!result.ok) {
      ws.sendRoomMessage(
        targetRoomId,
        `❌ Failed to ban user.\nReason: ${result.reason}`,
        targetRoomName,
      );

      return true;
    }

    ws.sendRoomMessage(
      targetRoomId,
      `✅ Sent ban command for ${targetUser.username}.`,
      targetRoomName,
    );

    return true;
  }

  return false;
}