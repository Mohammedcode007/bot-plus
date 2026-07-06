import fs from 'fs/promises';
import path from 'path';

import {
  clean,
  normalizeName,
} from '../utils/text.js';

const ROOM_USERS_FILE = path.resolve('data/room-users.json');

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
      normalizeName(normalized.username);

    if (!map.has(key)) {
      map.set(key, normalized);
    }
  }

  return Array.from(map.values());
}

export async function readRoomUsersStore() {
  const data = await readJsonFile(
    ROOM_USERS_FILE,
    {
      rooms: {},
    },
  );

  data.rooms ||= {};

  return data;
}

export async function writeRoomUsersStore(data) {
  data.rooms ||= {};

  await writeJsonFile(
    ROOM_USERS_FILE,
    data,
  );
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

export async function getSavedRoomUsers({
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

export async function findSavedRoomUserByUsername({
  username,
  roomId,
  roomName,
  sessionInfo,
}) {
  const result = await getSavedRoomUsers({
    roomId,
    roomName,
    sessionInfo,
  });

  const target = normalizeName(username);

  return result.users.find((user) => {
    return normalizeName(user.username) === target;
  }) || null;
}