import fs from 'fs/promises';
import path from 'path';

import {
  clean,
  normalizeName,
} from '../utils/text.js';

const WELCOME_FILE = path.resolve('data/room-welcome.json');

const recentWelcomeMap = new Map();
const RECENT_WELCOME_TTL_MS = 15_000;

/*
  Runtime state only.
  عند تشغيل البوت، أول users list لكل غرفة تصبح baseline.
  لا نرحب بمن كانوا موجودين قبل دخول البوت.
*/
const runtimeRoomState = new Map();

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

function defaultWelcomeStore() {
  return {
    rooms: {},
  };
}

export async function readWelcomeStore() {
  const data = await readJsonFile(
    WELCOME_FILE,
    defaultWelcomeStore(),
  );

  data.rooms ||= {};

  return data;
}

export async function writeWelcomeStore(data) {
  data.rooms ||= {};

  await writeJsonFile(
    WELCOME_FILE,
    data,
  );
}

function getRoomKey({
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
    joinedAt: clean(user.joinedAt),
    socketId: clean(user.socketId),
    role: clean(user.role),
    accountColor: clean(user.accountColor),
    badgeKey: clean(user.badgeKey),
    badgeName: clean(user.badgeName),
    badgeValue: clean(user.badgeValue),
    verificationType: clean(user.verificationType),
  };
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

function uniqueUsers(users) {
  const map = new Map();

  for (const item of users) {
    const user = normalizeUser(item);

    if (!user) {
      continue;
    }

    const key = getUserKey(user);

    if (!key) {
      continue;
    }

    if (!map.has(key)) {
      map.set(key, user);
    }
  }

  return Array.from(map.values());
}

function getUserKey(user) {
  return clean(user?.userId) || normalizeName(user?.username);
}

function isSameUser(a, b) {
  const aId = clean(a?.userId);
  const bId = clean(b?.userId);

  if (aId && bId && aId === bId) {
    return true;
  }

  const aName = normalizeName(a?.username);
  const bName = normalizeName(b?.username);

  return Boolean(aName && bName && aName === bName);
}

function isRoomJoinOrUsersEvent(data) {
  const handler = String(data?.handler || '');
  const type = String(data?.type || '');

  /*
    لا تجعل الترحيب يتعامل مع أخطاء room.update
    مثل invalid_role_payload.
  */
  if (type === 'error') {
    return false;
  }

  /*
    لا نعالج أي event لا يحتوي users أو activeUsers.
  */
  const hasUsers =
    Array.isArray(data.activeUsers) ||
    Array.isArray(data.active_users) ||
    Array.isArray(data.users) ||
    Array.isArray(data.room?.activeUsers) ||
    Array.isArray(data.room?.active_users) ||
    Array.isArray(data.room?.users) ||
    Array.isArray(data.message?.activeUsers) ||
    Array.isArray(data.message?.active_users) ||
    Array.isArray(data.message?.users);

  if (!hasUsers) {
    return false;
  }

  return (
    handler === 'room.active_count.update' ||
    handler === 'room_active_count_update' ||
    handler === 'room.join' ||
    handler === 'room_join_event' ||
    handler === 'room.users' ||
    handler === 'room.users_event' ||
    handler === 'room_users_event' ||
    handler === 'room.update' ||
    handler === 'room_update_event'
  );
}

function formatWelcomeMessage(template, username) {
  const safeUsername = clean(username) || 'User';
  const safeTemplate = clean(template) || 'Welcome $';

  if (safeTemplate.includes('$')) {
    return safeTemplate.replaceAll('$', safeUsername);
  }

  return `${safeTemplate} ${safeUsername}`;
}

function getWelcomeCacheKey({
  roomKey,
  user,
}) {
  const userKey = getUserKey(user);

  return `${roomKey}:${userKey}`;
}

function wasWelcomedRecently({
  roomKey,
  user,
}) {
  const key = getWelcomeCacheKey({
    roomKey,
    user,
  });

  const oldTime = recentWelcomeMap.get(key);
  const now = Date.now();

  if (oldTime && now - oldTime < RECENT_WELCOME_TTL_MS) {
    return true;
  }

  recentWelcomeMap.set(key, now);

  setTimeout(() => {
    recentWelcomeMap.delete(key);
  }, RECENT_WELCOME_TTL_MS);

  return false;
}

function isBotUser({
  user,
  sessionInfo,
}) {
  const botUsername = normalizeName(sessionInfo?.username);
  const botUserId = normalizeName(sessionInfo?.userId);

  const userUsername = normalizeName(user?.username);
  const userId = normalizeName(user?.userId);

  return Boolean(
    (botUsername && userUsername && botUsername === userUsername) ||
      (botUserId && userId && botUserId === userId),
  );
}

function getState(roomKey) {
  return runtimeRoomState.get(roomKey) || {
    baselineReady: false,
    users: [],
    createdAt: '',
    updatedAt: '',
  };
}

function setState(roomKey, users, reason) {
  const next = {
    baselineReady: true,
    users,
    reason,
    count: users.length,
    createdAt: runtimeRoomState.get(roomKey)?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  runtimeRoomState.set(roomKey, next);



  return next;
}

function getNewUsers({
  currentUsers,
  previousUsers,
  sessionInfo,
}) {
  return currentUsers.filter((currentUser) => {
    if (
      isBotUser({
        user: currentUser,
        sessionInfo,
      })
    ) {
      return false;
    }

    return !previousUsers.some((oldUser) => {
      return isSameUser(currentUser, oldUser);
    });
  });
}

function logWelcomeDebug({
  step,
  data,
  roomKey,
  roomId,
  roomName,
  settings,
  currentUsers,
  previousUsers,
  newUsers,
  result,
}) {




}

export async function getWelcomeSettings({
  roomId,
  roomName,
  sessionInfo,
}) {
  const store = await readWelcomeStore();

  const key = getRoomKey({
    roomId,
    roomName,
    sessionInfo,
  });

  const record = store.rooms?.[key] || {};

  return {
    key,
    enabled: record.enabled === true,
    message: clean(record.message) || 'Welcome $',
    updatedBy: clean(record.updatedBy),
    updatedAt: clean(record.updatedAt),
  };
}

export async function setWelcomeEnabled({
  roomId,
  roomName,
  sessionInfo,
  enabled,
  updatedBy,
}) {
  const store = await readWelcomeStore();

  const key = getRoomKey({
    roomId,
    roomName,
    sessionInfo,
  });

  store.rooms ||= {};

  const old = store.rooms[key] || {};

  store.rooms[key] = {
    roomId: clean(roomId) || clean(sessionInfo?.roomId),
    roomName: clean(roomName) || clean(sessionInfo?.room),
    enabled: enabled === true,
    message: clean(old.message) || 'Welcome $',
    updatedBy: clean(updatedBy),
    updatedAt: new Date().toISOString(),
  };

  await writeWelcomeStore(store);

  return store.rooms[key];
}

export async function setWelcomeMessage({
  roomId,
  roomName,
  sessionInfo,
  message,
  updatedBy,
}) {
  const finalMessage = clean(message).slice(0, 100);

  const store = await readWelcomeStore();

  const key = getRoomKey({
    roomId,
    roomName,
    sessionInfo,
  });

  store.rooms ||= {};

  const old = store.rooms[key] || {};

  store.rooms[key] = {
    roomId: clean(roomId) || clean(sessionInfo?.roomId),
    roomName: clean(roomName) || clean(sessionInfo?.room),
    enabled: old.enabled === true,
    message: finalMessage || 'Welcome $',
    updatedBy: clean(updatedBy),
    updatedAt: new Date().toISOString(),
  };

  await writeWelcomeStore(store);

  return store.rooms[key];
}

export async function buildWelcomeMessageFromEvent({
  data,
  sessionInfo,
}) {
  if (!isRoomJoinOrUsersEvent(data)) {
    return {
      ok: false,
      reason: 'not_join_or_users_event',
    };
  }

  const roomId = extractRoomId(data, sessionInfo);
  const roomName = extractRoomName(data, sessionInfo);

  if (!roomId && !roomName) {
    return {
      ok: false,
      reason: 'missing_room',
    };
  }

  const roomKey = getRoomKey({
    roomId,
    roomName,
    sessionInfo,
  });

  const settings = await getWelcomeSettings({
    roomId,
    roomName,
    sessionInfo,
  });

  const currentUsers = uniqueUsers(extractUsersArray(data));

  const state = getState(roomKey);
  const previousUsers = Array.isArray(state.users)
    ? state.users
    : [];

  logWelcomeDebug({
    step: 'EVENT_RECEIVED',
    data,
    roomKey,
    roomId,
    roomName,
    settings,
    currentUsers,
    previousUsers,
    newUsers: [],
    result: {
      baselineReady: state.baselineReady === true,
      runtimeCount: previousUsers.length,
    },
  });

  if (!settings.enabled) {
    /*
      حتى لو الترحيب مقفول، نحدث الحالة runtime
      حتى عند تشغيله بعد ذلك لا يرحب بالناس القديمة.
    */
    if (currentUsers.length > 0) {
      setState(
        roomKey,
        currentUsers,
        'welcome_disabled_state_sync',
      );
    }

    return {
      ok: false,
      reason: 'welcome_disabled',
    };
  }

  if (currentUsers.length === 0) {
    logWelcomeDebug({
      step: 'NO_USERS_IN_EVENT',
      data,
      roomKey,
      roomId,
      roomName,
      settings,
      currentUsers,
      previousUsers,
      newUsers: [],
      result: {
        ok: false,
        reason: 'no_users_in_event',
      },
    });

    return {
      ok: false,
      reason: 'no_users_in_event',
    };
  }

  /*
    أول قائمة بعد دخول البوت:
    baseline فقط.
    لا ترحب بأي شخص موجود بالفعل.
  */
  if (state.baselineReady !== true) {
    setState(
      roomKey,
      currentUsers,
      'first_users_list_after_bot_start_baseline_only',
    );

    logWelcomeDebug({
      step: 'BASELINE_ONLY_SKIP_EXISTING_USERS',
      data,
      roomKey,
      roomId,
      roomName,
      settings,
      currentUsers,
      previousUsers,
      newUsers: [],
      result: {
        ok: false,
        reason: 'baseline_initialized_skip_existing_users',
      },
    });

    return {
      ok: false,
      reason: 'baseline_initialized_skip_existing_users',
    };
  }

  const newUsers = getNewUsers({
    currentUsers,
    previousUsers,
    sessionInfo,
  }).filter((user) => {
    return !wasWelcomedRecently({
      roomKey,
      user,
    });
  });

  /*
    مهم:
    نحدث الحالة بعد حساب newUsers.
  */
  setState(
    roomKey,
    currentUsers,
    'users_list_processed',
  );

  if (newUsers.length === 0) {
    logWelcomeDebug({
      step: 'NO_NEW_USERS',
      data,
      roomKey,
      roomId,
      roomName,
      settings,
      currentUsers,
      previousUsers,
      newUsers,
      result: {
        ok: false,
        reason: 'no_new_users',
      },
    });

    return {
      ok: false,
      reason: 'no_new_users',
    };
  }

  const lines = newUsers.map((user) => {
    return formatWelcomeMessage(
      settings.message,
      user.username || user.userId,
    );
  });

  const text = lines.join('\n');

  logWelcomeDebug({
    step: 'WELCOME_NEW_USERS',
    data,
    roomKey,
    roomId,
    roomName,
    settings,
    currentUsers,
    previousUsers,
    newUsers,
    result: {
      ok: true,
      text,
    },
  });

  return {
    ok: true,
    roomId,
    roomName,
    text,
  };
}

/*
  Compatibility exports.
*/

export async function getRoomWelcomeSettings({
  roomId,
  roomName,
  sessionInfo,
}) {
  return await getWelcomeSettings({
    roomId,
    roomName,
    sessionInfo,
  });
}

export async function setRoomWelcomeEnabled({
  roomId,
  roomName,
  sessionInfo,
  enabled,
  updatedBy,
}) {
  try {
    const record = await setWelcomeEnabled({
      roomId,
      roomName,
      sessionInfo,
      enabled,
      updatedBy,
    });

    return {
      ok: true,
      message: enabled
        ? '✅ Welcome message enabled.'
        : '✅ Welcome message disabled.',
      data: record,
    };
  } catch (error) {


    return {
      ok: false,
      reason: error?.message || 'save_failed',
    };
  }
}
export async function setRoomWelcomeMessage({
  roomId,
  roomName,
  sessionInfo,
  message,
  updatedBy,
}) {
  try {
    const record = await setWelcomeMessage({
      roomId,
      roomName,
      sessionInfo,
      message,
      updatedBy,
    });

    return {
      ok: true,
      message: '✅ Welcome message saved.',
      data: record,
    };
  } catch (error) {
 

    return {
      ok: false,
      reason: error?.message || 'save_failed',
    };
  }
}
async function readRoomMastersStoreForWelcome() {
  const filePath = path.resolve('data/room-masters.json');

  await ensureJsonFile(filePath, {
    rooms: {},
  });

  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw || '{}');

    data.rooms ||= {};

    return data;
  } catch {
    return {
      rooms: {},
    };
  }
}

function getWelcomeRoomStoreKey({
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

export async function isControllerOwnerOrMaster({
  roomMessage,
  sessionInfo,
  roomId,
  roomName,
}) {
  const createdBy = normalizeName(sessionInfo?.createdBy);
  const fromUsername = normalizeName(roomMessage?.fromUsername);
  const fromUserId = normalizeName(roomMessage?.fromUserId);

  if (
    createdBy &&
    (
      createdBy === fromUsername ||
      createdBy === fromUserId
    )
  ) {
    return true;
  }

  const store = await readRoomMastersStoreForWelcome();

  const key = getWelcomeRoomStoreKey({
    roomId,
    roomName,
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