import fs from 'fs/promises';
import path from 'path';

import {
  handleVipRoomCommand,
} from './vipCommands.js';

import {
  handleVipUserRoomCommand,
} from './vipUserCommands.js';

const ROOM_USERS_FILE = path.resolve('data/room-users.json');
const ROOM_MASTERS_FILE = path.resolve('data/room-masters.json');

const PAGE_SIZE = 10;
const NEXT_TIMEOUT_MS = 30_000;

const paginationSessions = new Map();
const activePaginationByUser = new Map();

function clean(value) {
  return String(value || '').trim();
}

function normalizeName(value) {
  return clean(value)
    .normalize('NFC')
    .toLowerCase();
}

function normalizeCommand(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\s+/g, '');
}

async function ensureJsonFile(filePath, defaultData) {
  try {
    await fs.mkdir(path.dirname(filePath), {
      recursive: true,
    });

    await fs.access(filePath);
  } catch {
    await fs.writeFile(
      filePath,
      JSON.stringify(defaultData, null, 2),
      'utf8',
    );
  }
}

async function readJsonFile(filePath, defaultData) {
  await ensureJsonFile(filePath, defaultData);

  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw || '{}');

    return data && typeof data === 'object'
      ? data
      : defaultData;
  } catch {
    return defaultData;
  }
}

async function writeJsonFile(filePath, data) {
  await fs.mkdir(path.dirname(filePath), {
    recursive: true,
  });

  await fs.writeFile(
    filePath,
    JSON.stringify(data, null, 2),
    'utf8',
  );
}

async function readRoomUsersStore() {
  const data = await readJsonFile(
    ROOM_USERS_FILE,
    {
      rooms: {},
    },
  );

  data.rooms ||= {};

  return data;
}

async function writeRoomUsersStore(data) {
  data.rooms ||= {};

  await writeJsonFile(
    ROOM_USERS_FILE,
    data,
  );
}

async function readRoomMastersStore() {
  const data = await readJsonFile(
    ROOM_MASTERS_FILE,
    {
      rooms: {},
    },
  );

  data.rooms ||= {};

  return data;
}

async function writeRoomMastersStore(data) {
  data.rooms ||= {};

  await writeJsonFile(
    ROOM_MASTERS_FILE,
    data,
  );
}

export function isRoomMessageEvent(data) {
  const handler = String(data?.handler || '');

  return (
    handler === 'room.message_event' ||
    handler === 'room_message_event' ||
    handler === 'room.message' ||
    handler === 'room_message' ||
    handler === 'room.message.send' ||
    handler === 'room_message_send_event'
  );
}

function isRoomUsersEvent(data) {
  const handler = String(data?.handler || '');

  return (
    handler === 'room.join' ||
    handler === 'room.leave' ||
    handler === 'room.users' ||
    handler === 'room.users_event' ||
    handler === 'room_users_event' ||
    handler === 'room.update' ||
    handler === 'room_update_event'
  );
}

export function readRoomMessage(data) {
  const message =
    data.message && typeof data.message === 'object'
      ? data.message
      : data;

  const text = clean(
    message.text ||
      message.body ||
      message.message ||
      data.text ||
      '',
  );

  const roomId = clean(
    message.roomId ||
      message.room_id ||
      data.roomId ||
      data.room_id ||
      data.room?.roomId ||
      '',
  );

  const roomName = clean(
    message.roomName ||
      message.room_name ||
      data.roomName ||
      data.room_name ||
      data.room?.name ||
      '',
  );

  const fromUserId = clean(
    message.fromUserId ||
      message.from_user_id ||
      message.userId ||
      message.user_id ||
      data.fromUserId ||
      data.from_user_id ||
      '',
  );

  const fromUsername = clean(
    message.fromUsername ||
      message.from_username ||
      message.username ||
      data.fromUsername ||
      data.from_username ||
      '',
  );

  return {
    text,
    roomId,
    roomName,
    fromUserId,
    fromUsername,
    raw: message,
  };
}

function extractRoomId(data, sessionInfo = {}) {
  return clean(
    data.roomId ||
      data.room_id ||
      data.room?.roomId ||
      data.message?.roomId ||
      data.message?.room_id ||
      sessionInfo.roomId ||
      sessionInfo.room ||
      '',
  );
}

function extractRoomName(data, sessionInfo = {}) {
  return clean(
    data.roomName ||
      data.room_name ||
      data.room?.name ||
      data.room?.roomName ||
      data.message?.roomName ||
      data.message?.room_name ||
      sessionInfo.room ||
      '',
  );
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

function extractUsersArray(data) {
  const possibleLists = [
    data.activeUsers,
    data.active_users,
    data.users,
    data.room?.activeUsers,
    data.room?.active_users,
    data.room?.users,
    data.message?.activeUsers,
    data.message?.active_users,
    data.message?.users,
  ];

  for (const list of possibleLists) {
    if (Array.isArray(list)) {
      return list;
    }
  }

  return [];
}

function normalizeUser(user) {
  if (!user || typeof user !== 'object') {
    return null;
  }

  const userId = clean(
    user.userId ||
      user.user_id ||
      user.id ||
      user._id ||
      '',
  );

  const username = clean(
    user.username ||
      user.name ||
      user.displayName ||
      user.display_name ||
      '',
  );

  if (!userId && !username) {
    return null;
  }

  return {
    userId,
    username,
    photoUrl: clean(
      user.photoUrl ||
        user.photo_url ||
        user.avatar ||
        '',
    ),
    role: clean(
      user.role ||
        user.roomRole ||
        user.room_role ||
        '',
    ),
    current: clean(user.current || ''),
  };
}

function uniqueUsers(users) {
  const map = new Map();

  for (const user of users) {
    const normalized = normalizeUser(user);

    if (!normalized) {
      continue;
    }

    const key =
      normalized.userId ||
      normalized.username.toLowerCase();

    if (!map.has(key)) {
      map.set(key, normalized);
    }
  }

  return Array.from(map.values());
}

export async function saveRoomUsersFromEvent({
  data,
  sessionInfo,
}) {
  if (!isRoomUsersEvent(data)) {
    return false;
  }

  const users = uniqueUsers(extractUsersArray(data));

  if (users.length === 0) {
    return false;
  }

  const roomId = extractRoomId(data, sessionInfo);
  const roomName = extractRoomName(data, sessionInfo);

  if (!roomId && !roomName) {
    return false;
  }

  const key = getRoomStoreKey({
    roomId,
    roomName,
    sessionInfo,
  });

  const store = await readRoomUsersStore();

  store.rooms ||= {};

  store.rooms[key] = {
    roomId,
    roomName,
    users,
    count: users.length,
    updatedAt: new Date().toISOString(),
  };

  await writeRoomUsersStore(store);

  console.log('💾 [ROOM_USERS_SAVED]', {
    roomId,
    roomName,
    count: users.length,
  });

  return true;
}

async function getSavedRoomUsers({
  roomId,
  roomName,
  sessionInfo,
}) {
  const store = await readRoomUsersStore();

  const keys = [
    clean(roomId),
    clean(roomName),
    clean(sessionInfo?.roomId),
    clean(sessionInfo?.room),
  ].filter(Boolean);

  for (const key of keys) {
    const room = store.rooms?.[key];

    if (room && Array.isArray(room.users)) {
      return {
        room,
        users: room.users,
      };
    }
  }

  return {
    room: null,
    users: [],
  };
}

function getUserDisplayName(user, index) {
  const username = clean(user.username);

  if (username) {
    return `${index}. ${username}`;
  }

  return `${index}. Unknown`;
}

function buildUsersPageText({
  users,
  page,
  roomName,
}) {
  const total = users.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const safePage = Math.min(
    Math.max(page, 1),
    totalPages,
  );

  const start = (safePage - 1) * PAGE_SIZE;
  const pageUsers = users.slice(start, start + PAGE_SIZE);

  const lines = pageUsers.map((user, index) => {
    return getUserDisplayName(
      user,
      start + index + 1,
    );
  });

  return [
    `👥 Room Users${roomName ? ` | ${roomName}` : ''}`,
    `Page ${safePage}/${totalPages} | Total: ${total}`,
    '',
    ...lines,
    '',
    safePage < totalPages
      ? 'Send .nx within 30 seconds for next page.'
      : 'End of list.',
  ].join('\n');
}

function buildMastersPageText({
  masters,
  page,
  roomName,
}) {
  const total = masters.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const safePage = Math.min(
    Math.max(page, 1),
    totalPages,
  );

  const start = (safePage - 1) * PAGE_SIZE;
  const pageMasters = masters.slice(start, start + PAGE_SIZE);

  const lines = pageMasters.map((item, index) => {
    const username = clean(item.username) || 'Unknown';

    return `${start + index + 1}. ${username}`;
  });

  return [
    `👑 Controller Masters${roomName ? ` | ${roomName}` : ''}`,
    `Page ${safePage}/${totalPages} | Total: ${total}`,
    '',
    ...lines,
    '',
    safePage < totalPages
      ? 'Send .nx within 30 seconds for next page.'
      : 'End of list.',
  ].join('\n');
}

function getBasePaginationKey({
  roomId,
  roomName,
  fromUserId,
  fromUsername,
}) {
  const roomKey = clean(roomId) || clean(roomName) || 'unknown_room';
  const userKey = clean(fromUserId) || clean(fromUsername) || 'unknown_user';

  return `${roomKey}:${userKey}`;
}

function getPaginationKey({
  type,
  roomId,
  roomName,
  fromUserId,
  fromUsername,
}) {
  const listType = clean(type) || 'users';
  const baseKey = getBasePaginationKey({
    roomId,
    roomName,
    fromUserId,
    fromUsername,
  });

  return `${listType}:${baseKey}`;
}

function clearPaginationSession(key) {
  const old = paginationSessions.get(key);

  if (old?.timer) {
    clearTimeout(old.timer);
  }

  paginationSessions.delete(key);
}

function clearAllUserPaginationSessions({
  roomId,
  roomName,
  fromUserId,
  fromUsername,
}) {
  const baseKey = getBasePaginationKey({
    roomId,
    roomName,
    fromUserId,
    fromUsername,
  });

  const usersKey = `users:${baseKey}`;
  const mastersKey = `masters:${baseKey}`;

  clearPaginationSession(usersKey);
  clearPaginationSession(mastersKey);

  activePaginationByUser.delete(baseKey);
}

function setPaginationSession({
  key,
  type,
  items,
  page,
  roomName,
  baseKey,
}) {
  clearPaginationSession(key);

  const timer = setTimeout(() => {
    paginationSessions.delete(key);

    if (activePaginationByUser.get(baseKey) === key) {
      activePaginationByUser.delete(baseKey);
    }
  }, NEXT_TIMEOUT_MS);

  paginationSessions.set(key, {
    type,
    items,
    page,
    roomName,
    expiresAt: Date.now() + NEXT_TIMEOUT_MS,
    timer,
  });

  activePaginationByUser.set(baseKey, key);
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

function controlledHelpText() {
  return [
    '🤖 Controller Bot Commands',
    '',
    'help / help1 / help@1',
    'Show help menu.',
    '',
    '.r',
    'Show room users list.',
    '',
    '.nx',
    'Next page within 30 seconds.',
    '',
    'mas@username',
    'Add user to controller masters.',
    '',
    'unmas@username',
    'Remove user from controller masters.',
    '',
    'l@mas',
    'Show controller masters list.',
    '',
    'v@username',
    'Verify user from room.',
    '',
    'unv@username',
    'Remove user verification from room.',
    '',
    'vip@username',
    'Add user as VIP.',
    '',
    'unvip@username',
    'Remove user from VIP.',
  ].join('\n');
}

function isHelpCommand(text) {
  const command = normalizeCommand(text);

  return (
    command === 'help' ||
    command === 'help1' ||
    command === 'help@1'
  );
}

function isUsersListCommand(text) {
  return normalizeCommand(text) === '.r';
}

function isNextPageCommand(text) {
  return normalizeCommand(text) === '.nx';
}

function parseMasterCommand(text) {
  const raw = clean(text);
  const lower = raw.toLowerCase();

  if (lower === 'l@mas') {
    return {
      command: 'list_masters',
      username: '',
    };
  }

  if (lower.startsWith('mas@')) {
    return {
      command: 'add_master',
      username: clean(raw.slice(4)),
    };
  }

  if (lower.startsWith('unmas@')) {
    return {
      command: 'remove_master',
      username: clean(raw.slice(6)),
    };
  }

  return {
    command: '',
    username: '',
  };
}

function isControllerOwner({
  roomMessage,
  sessionInfo,
}) {
  const createdBy = normalizeName(sessionInfo?.createdBy);
  const fromUsername = normalizeName(roomMessage?.fromUsername);
  const fromUserId = normalizeName(roomMessage?.fromUserId);

  if (!createdBy) {
    return false;
  }

  return (
    createdBy === fromUsername ||
    createdBy === fromUserId
  );
}

async function getRoomMastersRecord({
  roomId,
  roomName,
  sessionInfo,
}) {
  const store = await readRoomMastersStore();

  store.rooms ||= {};

  const key = getRoomStoreKey({
    roomId,
    roomName,
    sessionInfo,
  });

  if (!store.rooms[key]) {
    store.rooms[key] = {
      roomId: clean(roomId) || clean(sessionInfo?.roomId),
      roomName: clean(roomName) || clean(sessionInfo?.room),
      owner: clean(sessionInfo?.createdBy),
      masters: [],
      updatedAt: new Date().toISOString(),
    };
  }

  if (!Array.isArray(store.rooms[key].masters)) {
    store.rooms[key].masters = [];
  }

  return {
    store,
    key,
    record: store.rooms[key],
  };
}

async function findSavedUserByUsername({
  username,
  targetRoomId,
  targetRoomName,
  sessionInfo,
}) {
  const result = await getSavedRoomUsers({
    roomId: targetRoomId,
    roomName: targetRoomName,
    sessionInfo,
  });

  const target = normalizeName(username);

  return result.users.find((user) => {
    return normalizeName(user.username) === target;
  }) || null;
}

async function handleMasterCommands({
  roomMessage,
  ws,
  sessionInfo,
  targetRoomId,
  targetRoomName,
}) {
  const parsed = parseMasterCommand(roomMessage.text);

  if (!parsed.command) {
    return false;
  }

  if (!isControllerOwner({
    roomMessage,
    sessionInfo,
  })) {
    ws.sendRoomMessage(
      targetRoomId,
      '❌ Only the controller owner can use master commands.',
      targetRoomName,
    );

    return true;
  }

  const { store, key, record } = await getRoomMastersRecord({
    roomId: targetRoomId,
    roomName: targetRoomName,
    sessionInfo,
  });

  if (parsed.command === 'list_masters') {
    const masters = Array.isArray(record.masters)
      ? record.masters
      : [];

    if (masters.length === 0) {
      clearAllUserPaginationSessions({
        roomId: targetRoomId,
        roomName: targetRoomName,
        fromUserId: roomMessage.fromUserId,
        fromUsername: roomMessage.fromUsername,
      });

      ws.sendRoomMessage(
        targetRoomId,
        '👑 Controller Masters\n\nNo masters yet.',
        targetRoomName,
      );

      return true;
    }

    const page = 1;

    ws.sendRoomMessage(
      targetRoomId,
      buildMastersPageText({
        masters,
        page,
        roomName: targetRoomName,
      }),
      targetRoomName,
    );

    const baseKey = getBasePaginationKey({
      roomId: targetRoomId,
      roomName: targetRoomName,
      fromUserId: roomMessage.fromUserId,
      fromUsername: roomMessage.fromUsername,
    });

    const pageKey = getPaginationKey({
      type: 'masters',
      roomId: targetRoomId,
      roomName: targetRoomName,
      fromUserId: roomMessage.fromUserId,
      fromUsername: roomMessage.fromUsername,
    });

    const totalPages = Math.ceil(masters.length / PAGE_SIZE);

    if (totalPages > 1) {
      clearAllUserPaginationSessions({
        roomId: targetRoomId,
        roomName: targetRoomName,
        fromUserId: roomMessage.fromUserId,
        fromUsername: roomMessage.fromUsername,
      });

      setPaginationSession({
        key: pageKey,
        type: 'masters',
        items: masters,
        page,
        roomName: targetRoomName,
        baseKey,
      });
    } else {
      clearAllUserPaginationSessions({
        roomId: targetRoomId,
        roomName: targetRoomName,
        fromUserId: roomMessage.fromUserId,
        fromUsername: roomMessage.fromUsername,
      });
    }

    return true;
  }

  const username = clean(parsed.username);

  if (!username) {
    ws.sendRoomMessage(
      targetRoomId,
      '❌ Username is required.',
      targetRoomName,
    );

    return true;
  }

  const savedUser = await findSavedUserByUsername({
    username,
    targetRoomId,
    targetRoomName,
    sessionInfo,
  });

  const exists = record.masters.some((item) => {
    return normalizeName(item.username) === normalizeName(username);
  });

  if (parsed.command === 'add_master') {
    if (exists) {
      ws.sendRoomMessage(
        targetRoomId,
        `ℹ️ ${username} is already a master.`,
        targetRoomName,
      );

      return true;
    }

    record.masters.push({
      username,
      userId: clean(savedUser?.userId),
      addedBy: clean(roomMessage.fromUsername) || clean(roomMessage.fromUserId),
      addedAt: new Date().toISOString(),
    });

    record.owner = clean(sessionInfo.createdBy);
    record.updatedAt = new Date().toISOString();

    store.rooms[key] = record;

    await writeRoomMastersStore(store);

    ws.sendRoomMessage(
      targetRoomId,
      `✅ ${username} added to controller masters.`,
      targetRoomName,
    );

    return true;
  }

  if (parsed.command === 'remove_master') {
    if (!exists) {
      ws.sendRoomMessage(
        targetRoomId,
        `ℹ️ ${username} is not in masters list.`,
        targetRoomName,
      );

      return true;
    }

    record.masters = record.masters.filter((item) => {
      return normalizeName(item.username) !== normalizeName(username);
    });

    record.owner = clean(sessionInfo.createdBy);
    record.updatedAt = new Date().toISOString();

    store.rooms[key] = record;

    await writeRoomMastersStore(store);

    ws.sendRoomMessage(
      targetRoomId,
      `✅ ${username} removed from controller masters.`,
      targetRoomName,
    );

    return true;
  }

  return false;
}

async function handleNextPageCommand({
  roomMessage,
  ws,
  targetRoomId,
  targetRoomName,
}) {
  if (!isNextPageCommand(roomMessage.text)) {
    return false;
  }

  const baseKey = getBasePaginationKey({
    roomId: targetRoomId,
    roomName: targetRoomName,
    fromUserId: roomMessage.fromUserId,
    fromUsername: roomMessage.fromUsername,
  });

  const activeKey = activePaginationByUser.get(baseKey);

  if (!activeKey) {
    ws.sendRoomMessage(
      targetRoomId,
      '⏱️ Session expired. Send list command again.',
      targetRoomName,
    );

    return true;
  }

  const session = paginationSessions.get(activeKey);

  if (!session || Date.now() > session.expiresAt) {
    clearPaginationSession(activeKey);
    activePaginationByUser.delete(baseKey);

    ws.sendRoomMessage(
      targetRoomId,
      '⏱️ Session expired. Send list command again.',
      targetRoomName,
    );

    return true;
  }

  const nextPage = session.page + 1;
  const totalPages = Math.ceil(session.items.length / PAGE_SIZE);

  if (nextPage > totalPages) {
    clearPaginationSession(activeKey);
    activePaginationByUser.delete(baseKey);

    ws.sendRoomMessage(
      targetRoomId,
      '✅ End of list.',
      targetRoomName,
    );

    return true;
  }

  const text = session.type === 'masters'
    ? buildMastersPageText({
      masters: session.items,
      page: nextPage,
      roomName: session.roomName || targetRoomName,
    })
    : buildUsersPageText({
      users: session.items,
      page: nextPage,
      roomName: session.roomName || targetRoomName,
    });

  ws.sendRoomMessage(
    targetRoomId,
    text,
    targetRoomName,
  );

  if (nextPage < totalPages) {
    setPaginationSession({
      key: activeKey,
      type: session.type,
      items: session.items,
      page: nextPage,
      roomName: session.roomName || targetRoomName,
      baseKey,
    });
  } else {
    clearPaginationSession(activeKey);
    activePaginationByUser.delete(baseKey);
  }

  return true;
}

export async function handleControlledRoomCommand({
  data,
  ws,
  sessionInfo,
}) {
  await saveRoomUsersFromEvent({
    data,
    sessionInfo,
  });

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

  const targetRoomId =
    sessionInfo.roomId ||
    roomMessage.roomId ||
    sessionInfo.room;

  const targetRoomName =
    roomMessage.roomName ||
    sessionInfo.room;

  console.log(
    `📥 [controlled:${sessionInfo.username}] ROOM_COMMAND`,
    {
      text: roomMessage.text,
      roomId: roomMessage.roomId,
      roomName: roomMessage.roomName,
      fromUserId: roomMessage.fromUserId,
      fromUsername: roomMessage.fromUsername,
      createdBy: sessionInfo.createdBy,
    },
  );

  /*
    VIP user:
    vip@username
    unvip@username

    مهم أن يكون قبل التوثيق.
  */
  const vipUserHandled = await handleVipUserRoomCommand({
    roomMessage,
    ws,
    sessionInfo,
    targetRoomId,
    targetRoomName,
  });

  if (vipUserHandled) {
    return true;
  }

  /*
    Verification:
    v@username
    unv@username
  */
  const vipHandled = await handleVipRoomCommand({
    roomMessage,
    ws,
    sessionInfo,
    targetRoomId,
    targetRoomName,
  });

  if (vipHandled) {
    return true;
  }

  const masterHandled = await handleMasterCommands({
    roomMessage,
    ws,
    sessionInfo,
    targetRoomId,
    targetRoomName,
  });

  if (masterHandled) {
    return true;
  }

  if (isHelpCommand(roomMessage.text)) {
    ws.sendRoomMessage(
      targetRoomId,
      controlledHelpText(),
      targetRoomName,
    );

    return true;
  }

  if (isUsersListCommand(roomMessage.text)) {
    const result = await getSavedRoomUsers({
      roomId: targetRoomId,
      roomName: targetRoomName,
      sessionInfo,
    });

    if (result.users.length === 0) {
      clearAllUserPaginationSessions({
        roomId: targetRoomId,
        roomName: targetRoomName,
        fromUserId: roomMessage.fromUserId,
        fromUsername: roomMessage.fromUsername,
      });

      ws.sendRoomMessage(
        targetRoomId,
        '❌ No saved users for this room yet.',
        targetRoomName,
      );

      return true;
    }

    const page = 1;

    const text = buildUsersPageText({
      users: result.users,
      page,
      roomName: targetRoomName,
    });

    ws.sendRoomMessage(
      targetRoomId,
      text,
      targetRoomName,
    );

    const baseKey = getBasePaginationKey({
      roomId: targetRoomId,
      roomName: targetRoomName,
      fromUserId: roomMessage.fromUserId,
      fromUsername: roomMessage.fromUsername,
    });

    const pageKey = getPaginationKey({
      type: 'users',
      roomId: targetRoomId,
      roomName: targetRoomName,
      fromUserId: roomMessage.fromUserId,
      fromUsername: roomMessage.fromUsername,
    });

    const totalPages = Math.ceil(result.users.length / PAGE_SIZE);

    if (totalPages > 1) {
      clearAllUserPaginationSessions({
        roomId: targetRoomId,
        roomName: targetRoomName,
        fromUserId: roomMessage.fromUserId,
        fromUsername: roomMessage.fromUsername,
      });

      setPaginationSession({
        key: pageKey,
        type: 'users',
        items: result.users,
        page,
        roomName: targetRoomName,
        baseKey,
      });
    } else {
      clearAllUserPaginationSessions({
        roomId: targetRoomId,
        roomName: targetRoomName,
        fromUserId: roomMessage.fromUserId,
        fromUsername: roomMessage.fromUsername,
      });
    }

    return true;
  }

  const nextHandled = await handleNextPageCommand({
    roomMessage,
    ws,
    targetRoomId,
    targetRoomName,
  });

  if (nextHandled) {
    return true;
  }

  return false;
}