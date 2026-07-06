
import fs from 'fs/promises';
import path from 'path';

import {
  handleVipRoomCommand,
} from './vipCommands.js';
import {
  handleInvestmentCommand,
} from './investmentCommands.js';

import {
  handleLuckyCommand,
} from './luckyCommands.js';
import {
  handleVipUserRoomCommand,
} from './vipUserCommands.js';
import {
  handleRoomModerationCommand,
} from './roomModerationCommands.js';
import { handleTopCommand } from './topCommands.js';
import { handleBoxCommand } from './boxCommands.js';
import { handleStealCommand } from './stealCommands.js';
import { handleBetCommand } from './betCommands.js';
import { handleFishCommand } from './fishCommands.js';
import { handleMineCommand } from './mineCommands.js';
import { handleBankCommand } from './bankCommands.js';
import {
  handlePrivateRelayCommand,
} from './privateRelayCommands.js';
import {
  handleGameCommand,
} from './gameCommands.js';
import {
  getSavedRoomUsers,
  saveRoomUsersFromEvent,
} from '../services/roomUsers.service.js';
import {
  handlePointsTransferCommand,
} from './pointsTransferCommands.js';

import {
  handleOwnerGivePointsCommand,
} from './ownerPointsCommands.js';
import {
  clean,
  normalizeName,
  normalizeCommand,
} from '../utils/text.js';
import {
  handleWelcomeCommand,
} from './welcomeCommands.js';

import {
  buildWelcomeMessageFromEvent,
} from '../services/roomWelcome.service.js';
const ROOM_MASTERS_FILE = path.resolve('data/room-masters.json');

const PAGE_SIZE = 10;
const NEXT_TIMEOUT_MS = 30_000;

const paginationSessions = new Map();
const activePaginationByUser = new Map();

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

function controlledHelpText(page = 1) {
  const pages = {
    1: [
      '🤖 Controller Bot Commands',
      'Page 1/7',
      '',
      '📌 Help Pages',
      '',
      'help / help@1 / help1',
      'Show this page.',
      '',
      'help@2 / help2',
      'Room lists and private messages.',
      '',
      'help@3 / help3',
      'Masters and permissions.',
      '',
      'help@4 / help4',
      'Verification, VIP, and welcome.',
      '',
      'help@5 / help5',
      'Room moderation commands.',
      '',
      'help@6 / help6',
      'Points games.',
      '',
      'help@7 / help7',
      'More games and bank.',
    ],

    2: [
      '🤖 Controller Bot Commands',
      'Page 2/7',
      '',
      '👥 Room Lists',
      '',
      '.r',
      'Show saved room users list.',
      '',
      '.nx',
      'Next page within 30 seconds.',
      '',
      '👑 Masters List',
      '',
      'l@mas',
      'Show controller masters list.',
      '',
      '📩 Private Message',
      '',
      '@username message',
      'Send private message to user by controller bot.',
      '',
      'Example:',
      '@ahmed hello',
    ],

    3: [
      '🤖 Controller Bot Commands',
      'Page 3/7',
      '',
      '👑 Controller Masters',
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
      'Note:',
      'Master commands are for controller owner only.',
      '',
      'Masters can use allowed controller commands in the room.',
    ],

    4: [
      '🤖 Controller Bot Commands',
      'Page 4/7',
      '',
      '✅ Verification',
      '',
      'v@username',
      'Verify user from room.',
      '',
      'unv@username',
      'Remove user verification from room.',
      '',
      '⭐ VIP',
      '',
      'vip@username',
      'Add user as VIP.',
      '',
      'unvip@username',
      'Remove user from VIP.',
      '',
      '👋 Welcome',
      '',
      'wc@on',
      'Turn welcome message on.',
      '',
      'wc@off',
      'Turn welcome message off.',
      '',
      'wcmsg@Welcome $',
      'Set welcome message.',
      '',
      '$',
      'Will be replaced with joined username.',
      '',
      'wc@status',
      'Show welcome settings.',
    ],

    5: [
      '🤖 Controller Bot Commands',
      'Page 5/7',
      '',
      '🛡️ Room Moderation',
      '',
      'o@username',
      'Set user as owner.',
      '',
      '.o username',
      'Set user as owner.',
      '',
      'a@username',
      'Set user as admin.',
      '',
      '.a username',
      'Set user as admin.',
      '',
      'm@username',
      'Set user as member.',
      '',
      '.m username',
      'Set user as member.',
      '',
      'b@username',
      'Ban user from room.',
      '',
      '.b username',
      'Ban user from room.',
      '',
      'k@username',
      'Kick user from room.',
      '',
      '.k username',
      'Kick user from room.',
    ],

    6: [
      '🤖 Controller Bot Commands',
      'Page 6/7',
      '',
      '🎮 Points Games',
      '',
      '.s',
      'Spin game. Win points, gift, grand prize, or nothing.',
      '',
      '.cc',
      'Show your current points.',
      '',
      'lucky',
      'Try your luck in English. Win, lose, or nothing.',
      '',
      'حظ',
      'جرب حظك بالعربي. تكسب أو تخسر أو لا يحدث شيء.',
      '',
      'invest@100',
      'Invest 100 points in English. Win or lose.',
      '',
      'invest 100',
      'Same investment command.',
      '',
      'استثمار@100',
      'استثمار 100 نقطة بالعربي. مكسب أو خسارة.',
      '',
      'استثمار 100',
      'نفس أمر الاستثمار.',
      '',
      'top',
      'Show top 10 users by points.',
      '',
      'توب',
      'عرض أكثر 10 مستخدمين نقاطًا.',
    ],

    7: [
      '🤖 Controller Bot Commands',
      'Page 7/7',
      '',
      '🎁 More Games',
      '',
      'box',
      'Open a mystery box in English.',
      '',
      'صندوق',
      'افتح صندوقًا عشوائيًا بالعربي.',
      '',
      'steal@username',
      'Try to steal points from user.',
      '',
      'steal @username',
      'Same steal command.',
      '',
      'سرقة@username',
      'حاول سرقة نقاط من مستخدم.',
      '',
      'سرقة @username',
      'نفس أمر السرقة.',
      '',
      'bet@username@100',
      'Bet 100 points against user.',
      '',
      'bet @username 100',
      'Same bet command.',
      '',
      'رهان@username@100',
      'راهن ضد مستخدم على 100 نقطة.',
      '',
      'رهان @username 100',
      'نفس أمر الرهان.',
      '',
      'fish',
      'Go fishing in English.',
      '',
      'صيد',
      'ابدأ الصيد بالعربي.',
      '',
      'mine',
      'Start mining in English.',
      '',
      'تعدين',
      'ابدأ التعدين بالعربي.',
      '',
      'bank 100',
      'Deposit 100 points in bank.',
      '',
      'بنك 100',
      'إيداع 100 نقطة في البنك.',
      '',
      'bank',
      'Show your bank deposits.',
      '',
      'بنك',
      'عرض ودائعك في البنك.',
      '',
      'bank withdraw',
      'Withdraw ready bank deposits.',
      '',
      'بنك سحب',
      'سحب الودائع الجاهزة.',
    ],
    8: [
      '🤖 Controller Bot Commands',
      'Page 8/8',
 '💸 Points Transfer',
'',
'send@username@100',
'Send points to another user.',
'',
'تحويل@username@100',
'تحويل نقاط إلى مستخدم آخر.',

    ],
  };

  const safePage = pages[page] ? page : 1;

  return pages[safePage].join('\n');
}

function parseHelpCommand(text) {
  const command = normalizeCommand(text);

  if (command === 'help') {
    return {
      isHelp: true,
      page: 1,
    };
  }

  const atMatch = command.match(/^help@(\d+)$/);

  if (atMatch) {
    return {
      isHelp: true,
      page: Number(atMatch[1]) || 1,
    };
  }

  const compactMatch = command.match(/^help(\d+)$/);

  if (compactMatch) {
    return {
      isHelp: true,
      page: Number(compactMatch[1]) || 1,
    };
  }

  return {
    isHelp: false,
    page: 1,
  };
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
  const welcomeResult = await buildWelcomeMessageFromEvent({
    data,
    sessionInfo,
  });

  if (welcomeResult.ok) {
    ws.sendRoomMessage(
      welcomeResult.roomId,
      welcomeResult.text,
      welcomeResult.roomName,
    );
  }
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
const ownerGivePointsHandled = await handleOwnerGivePointsCommand({
  roomMessage,
  ws,
  sessionInfo,
  targetRoomId,
  targetRoomName,
});

if (ownerGivePointsHandled) {
  return true;
}

const pointsTransferHandled = await handlePointsTransferCommand({
  roomMessage,
  ws,
  targetRoomId,
  targetRoomName,
});

if (pointsTransferHandled) {
  return true;
}
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

  const welcomeHandled = await handleWelcomeCommand({
    roomMessage,
    ws,
    sessionInfo,
    targetRoomId,
    targetRoomName,
  });

  if (welcomeHandled) {
    return true;
  }
  const moderationHandled = await handleRoomModerationCommand({
    roomMessage,
    ws,
    sessionInfo,
    targetRoomId,
    targetRoomName,
  });
  const gameHandled = await handleGameCommand({
    roomMessage,
    ws,
    targetRoomId,
    targetRoomName,
  });

  if (gameHandled) {
    return true;
  }
  if (moderationHandled) {
    return true;
  }
  const topHandled = await handleTopCommand({
  roomMessage,
  ws,
  targetRoomId,
  targetRoomName,
});

if (topHandled) return true;

const boxHandled = await handleBoxCommand({
  roomMessage,
  ws,
  targetRoomId,
  targetRoomName,
});

if (boxHandled) return true;

const stealHandled = await handleStealCommand({
  roomMessage,
  ws,
  targetRoomId,
  targetRoomName,
});

if (stealHandled) return true;

const betHandled = await handleBetCommand({
  roomMessage,
  ws,
  targetRoomId,
  targetRoomName,
});

if (betHandled) return true;

const fishHandled = await handleFishCommand({
  roomMessage,
  ws,
  targetRoomId,
  targetRoomName,
});

if (fishHandled) return true;

const mineHandled = await handleMineCommand({
  roomMessage,
  ws,
  targetRoomId,
  targetRoomName,
});

if (mineHandled) return true;

const bankHandled = await handleBankCommand({
  roomMessage,
  ws,
  targetRoomId,
  targetRoomName,
});

if (bankHandled) return true;
  const luckyHandled = await handleLuckyCommand({
    roomMessage,
    ws,
    targetRoomId,
    targetRoomName,
  });

  if (luckyHandled) {
    return true;
  }
  const investmentHandled = await handleInvestmentCommand({
  roomMessage,
  ws,
  targetRoomId,
  targetRoomName,
});

if (investmentHandled) {
  return true;
}
  /*
    إرسال خاص من الغرفة:
    @username message
  */
  const privateRelayHandled = await handlePrivateRelayCommand({
    roomMessage,
    ws,
    sessionInfo,
    targetRoomId,
    targetRoomName,
  });

  if (privateRelayHandled) {
    return true;
  }

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

  const helpCommand = parseHelpCommand(roomMessage.text);

  if (helpCommand.isHelp) {
    ws.sendRoomMessage(
      targetRoomId,
      controlledHelpText(helpCommand.page),
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
