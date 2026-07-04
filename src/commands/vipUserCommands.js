import fs from 'fs/promises';
import path from 'path';

import {
  isOwner,
  isOwnerOrAdmin,
  addVipUser,
  removeVipUser,
  isVipUser,
} from '../services/acl.service.js';

const ROOM_USERS_FILE = path.resolve('data/room-users.json');

function clean(value) {
  return String(value || '').trim();
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .normalize('NFC');
}

function normalizeName(value) {
  return normalizeText(value).toLowerCase();
}

function getOwnerUserId() {
  return normalizeText(process.env.BOT_OWNER_USER_ID);
}

function getOwnerUsername() {
  return normalizeText(process.env.BOT_OWNER_USERNAME);
}

async function readJsonFile(filePath, defaultData) {
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

async function isRoomMessageFromOwner({
  fromUserId,
  fromUsername,
}) {
  const senderUserId = normalizeText(fromUserId);
  const senderUsername = normalizeText(fromUsername);

  const ownerUserId = getOwnerUserId();
  const ownerUsername = getOwnerUsername();

  if (ownerUserId && senderUserId === ownerUserId) {
    return true;
  }

  if (ownerUsername && senderUsername === ownerUsername) {
    return true;
  }

  if (senderUsername && await isOwner(senderUsername)) {
    return true;
  }

  return false;
}

async function isRoomMessageFromOwnerOrAdmin({
  fromUserId,
  fromUsername,
}) {
  if (
    await isRoomMessageFromOwner({
      fromUserId,
      fromUsername,
    })
  ) {
    return true;
  }

  const senderUsername = normalizeText(fromUsername);

  if (senderUsername && await isOwnerOrAdmin(senderUsername)) {
    return true;
  }

  return false;
}

function parseVipUserCommand(text) {
  const raw = clean(text);
  const lower = raw.toLowerCase();

  if (lower.startsWith('unvip@')) {
    return {
      command: 'remove_vip',
      username: clean(raw.slice(6)),
    };
  }

  if (lower.startsWith('vip@')) {
    return {
      command: 'add_vip',
      username: clean(raw.slice(4)),
    };
  }

  return {
    command: '',
    username: '',
  };
}

async function findSavedUser({
  username,
  targetRoomId,
  targetRoomName,
  sessionInfo,
}) {
  const store = await readRoomUsersStore();

  const keys = [
    clean(targetRoomId),
    clean(targetRoomName),
    clean(sessionInfo?.roomId),
    clean(sessionInfo?.room),
  ].filter(Boolean);

  const target = normalizeName(username);

  for (const key of keys) {
    const room = store.rooms?.[key];

    if (!room || !Array.isArray(room.users)) {
      continue;
    }

    const found = room.users.find((user) => {
      return normalizeName(user.username) === target;
    });

    if (found) {
      return found;
    }
  }

  return null;
}

export async function handleVipUserRoomCommand({
  roomMessage,
  ws,
  sessionInfo,
  targetRoomId,
  targetRoomName,
}) {
  const parsed = parseVipUserCommand(roomMessage.text);

  if (!parsed.command) {
    return false;
  }

  const allowed = await isRoomMessageFromOwnerOrAdmin({
    fromUserId: roomMessage.fromUserId,
    fromUsername: roomMessage.fromUsername,
  });

  if (!allowed) {
    ws.sendRoomMessage(
      targetRoomId,
      '❌ This command is for bot owner or bot admins only.',
      targetRoomName,
    );

    return true;
  }

  const username = clean(parsed.username);

  if (!username) {
    ws.sendRoomMessage(
      targetRoomId,
      '❌ Username is required.\nExample: vip@username',
      targetRoomName,
    );

    return true;
  }

  const savedUser = await findSavedUser({
    username,
    targetRoomId,
    targetRoomName,
    sessionInfo,
  });

  if (parsed.command === 'add_vip') {
    if (await isVipUser(username)) {
      ws.sendRoomMessage(
        targetRoomId,
        `ℹ️ ${username} is already VIP.`,
        targetRoomName,
      );

      return true;
    }

    /*
      هذا هو المهم:
      لا نحفظ في room-vips.json.
      نحفظ في data/acl.json داخل users:
      verified: true
      vip: true
      points: 0
    */
    await addVipUser(username);

    ws.sendRoomMessage(
      targetRoomId,
      `✅ ${username} added as VIP and verified.`,
      targetRoomName,
    );

    if (savedUser?.userId) {
      ws.sendDm(
        savedUser.userId,
        `⭐ You have been added as VIP and verified in ${targetRoomName || sessionInfo.room}.`,
      );
    }

    return true;
  }

  if (parsed.command === 'remove_vip') {
    if (!(await isVipUser(username))) {
      ws.sendRoomMessage(
        targetRoomId,
        `ℹ️ ${username} is not VIP.`,
        targetRoomName,
      );

      return true;
    }

    /*
      unvip:
      يلغي VIP فقط.
      يترك verified كما هو.
    */
    await removeVipUser(username);

    ws.sendRoomMessage(
      targetRoomId,
      `✅ ${username} removed from VIP users.`,
      targetRoomName,
    );

    if (savedUser?.userId) {
      ws.sendDm(
        savedUser.userId,
        `⭐ You have been removed from VIP users in ${targetRoomName || sessionInfo.room}.`,
      );
    }

    return true;
  }

  return false;
}