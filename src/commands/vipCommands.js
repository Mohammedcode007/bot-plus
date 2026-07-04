import fs from 'fs/promises';
import path from 'path';

import {
  verifyUser,
  unverifyUser,
  isOwner,
  isOwnerOrAdmin,
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

/*
  التوثيق فقط:
  v@username
  unv@username

  لاحظ:
  vip@ لم يعد هنا، لأنه أصبح خاص بالـ VIP user.
*/
function parseVerifyCommand(text) {
  const raw = clean(text);
  const lower = raw.toLowerCase();

  if (lower.startsWith('unv@')) {
    return {
      command: 'unverify',
      username: clean(raw.slice(4)),
    };
  }

  if (lower.startsWith('v@')) {
    return {
      command: 'verify',
      username: clean(raw.slice(2)),
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

export async function handleVipRoomCommand({
  roomMessage,
  ws,
  sessionInfo,
  targetRoomId,
  targetRoomName,
}) {
  const parsed = parseVerifyCommand(roomMessage.text);

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
      '❌ Username is required.\nExample: v@username',
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

  if (parsed.command === 'verify') {
    await verifyUser(username);

    ws.sendRoomMessage(
      targetRoomId,
      `✅ ${username} has been verified.`,
      targetRoomName,
    );

    if (savedUser?.userId) {
      ws.sendDm(
        savedUser.userId,
        `✅ You have been verified by the bot admin in ${targetRoomName || sessionInfo.room}.`,
      );
    }

    return true;
  }

  if (parsed.command === 'unverify') {
    await unverifyUser(username);

    ws.sendRoomMessage(
      targetRoomId,
      `✅ ${username} verification has been removed.`,
      targetRoomName,
    );

    if (savedUser?.userId) {
      ws.sendDm(
        savedUser.userId,
        `✅ Your verification has been removed by the bot admin in ${targetRoomName || sessionInfo.room}.`,
      );
    }

    return true;
  }

  return false;
}