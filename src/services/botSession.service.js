import { WsClient } from '../core/wsClient.js';
import { ENV } from '../config/env.js';

import {
  getBotRooms,
  markMusicBotJoined,
  markMusicBotFailed,
  removeMusicBot,
} from './botRegistry.service.js';

import {
  handleControlledRoomCommand,
  saveRoomUsersFromEvent,
} from '../commands/roomCommands.js';

import {
  handleMusicRoomCommand,
} from '../commands/musicCommands.js';

const sessions = new Map();

function clean(value) {
  return String(value || '').trim();
}

function sessionKey(type, username, room) {
  return `${clean(type)}:${clean(username).toLowerCase()}:${clean(room)}`;
}

function isLoginSuccess(data) {
  return (
    data &&
    data.handler === 'login_event' &&
    data.type === 'success'
  );
}

function isLoginError(data) {
  return (
    data &&
    data.handler === 'login_event' &&
    data.type === 'error'
  );
}

function isRoomJoinEvent(data) {
  return (
    data &&
    data.handler === 'room.join'
  );
}

function getMasterName(value) {
  return clean(value) ||
    clean(ENV.BOT_OWNER_USERNAME) ||
    clean(ENV.BOT_OWNER_USER_ID) ||
    'Master';
}

function buildBotProfileStatus({
  type,
  room,
  createdBy,
}) {
  const botType = clean(type);
  const roomName = clean(room);
  const master = getMasterName(createdBy);
  const mainBot = clean(ENV.ADMIN_BOT_USERNAME) || 'main';

  if (botType === 'music') {
    return 'Music DJ | Auto Play | 24/7';
  }

  if (botType === 'silent') {
    return `Silent Bot | Master: ${master} | Room: ${roomName} | Main: ${mainBot}`;
  }

  if (botType === 'controlled') {
    return `Controller Bot | Master: ${master} | Room: ${roomName} | Main: ${mainBot}`;
  }

  return `TalkinPlus Bot | Room: ${roomName}`;
}

export function buildMainBotProfileStatus() {
  return `Smart Control Hub | Connected bots: ${sessions.size}`;
}

export function updateMainBotProfile(mainBot) {
  if (!mainBot || typeof mainBot.updateProfileStatus !== 'function') {
    return false;
  }

  return mainBot.updateProfileStatus(
    buildMainBotProfileStatus(),
  );
}

export function startBotSession({
  username,
  password,
  room,
  type,
  restore = false,
  createdBy = '',
  mainBot = null,
}) {
  const botUsername = clean(username);
  const botPassword = clean(password);
  const roomName = clean(room);
  const botType = clean(type) || 'controlled';
  const master = getMasterName(createdBy);

  if (!botUsername || !botPassword || !roomName) {
    return {
      ok: false,
      message: '❌ بيانات تشغيل البوت ناقصة.',
    };
  }

  const key = sessionKey(
    botType,
    botUsername,
    roomName,
  );

  if (sessions.has(key)) {
    return {
      ok: true,
      message: `ℹ️ البوت ${botUsername} يعمل بالفعل في ${roomName}`,
    };
  }

  const client = new WsClient({
    username: botUsername,
    password: botPassword,
    label: `${botType}:${botUsername}`,
  });

  const sessionInfo = {
    key,
    client,
    type: botType,
    username: botUsername,
    room: roomName,
    createdBy: master,
    startedAt: new Date().toISOString(),
    joined: false,
    roomId: '',
    lastError: '',
    joinRequested: false,
    profileUpdated: false,
    restore: restore === true,
  };

  sessions.set(key, sessionInfo);

  if (mainBot) {
    updateMainBotProfile(mainBot);
  }

  client.onMessage(async (data, ws) => {
    if (isLoginSuccess(data)) {
      if (sessionInfo.joinRequested) {
        return;
      }

      sessionInfo.joinRequested = true;

      console.log(
        `🚪 [${botType}:${botUsername}] LOGIN_SUCCESS_JOIN_SMART`,
        {
          room: roomName,
          restore: sessionInfo.restore,
        },
      );

      const joinResult = await ws.joinRoomSmart(roomName);

      console.log(
        `🚪 [${botType}:${botUsername}] JOIN_SMART_RESULT`,
        joinResult,
      );

      if (!joinResult.ok) {
        sessionInfo.joined = false;
        sessionInfo.lastError =
          joinResult.reason || 'join_failed';

        if (botType === 'music') {
          await markMusicBotFailed({
            room: roomName,
            reason: sessionInfo.lastError,
          });

          if (!sessionInfo.restore) {
            await removeMusicBot(roomName);
          }
        }

        sessions.delete(key);

        if (mainBot) {
          updateMainBotProfile(mainBot);
        }

        return;
      }

      sessionInfo.roomId = joinResult.roomId || '';
      sessionInfo.lastError = '';

      return;
    }

    if (isLoginError(data)) {
      sessionInfo.joined = false;
      sessionInfo.lastError =
        data.reason || 'login_failed';

      console.log(
        `❌ [${botType}:${botUsername}] LOGIN_FAILED`,
        {
          reason: data.reason,
          restore: sessionInfo.restore,
        },
      );

      if (botType === 'music') {
        await markMusicBotFailed({
          room: roomName,
          reason: sessionInfo.lastError,
        });

        if (!sessionInfo.restore) {
          await removeMusicBot(roomName);
        }
      }

      sessions.delete(key);

      if (mainBot) {
        updateMainBotProfile(mainBot);
      }

      return;
    }

    if (isRoomJoinEvent(data)) {
      if (data.type === 'success') {
        const joinedRoomId =
          data.roomId ||
          data.room?.roomId ||
          sessionInfo.roomId ||
          '';

        const joinedRoomName =
          data.roomName ||
          data.room?.name ||
          roomName;

        sessionInfo.joined = true;
        sessionInfo.roomId = joinedRoomId;
        sessionInfo.lastError = '';

        /*
          حفظ يوزرس الغرفة بعد نجاح الدخول لو السيرفر رجّع activeUsers/users.
        */
        await saveRoomUsersFromEvent({
          data,
          sessionInfo,
        });

        console.log(
          `✅ [${botType}:${botUsername}] ROOM_JOIN_CONFIRMED`,
          {
            room: roomName,
            roomId: joinedRoomId,
            restore: sessionInfo.restore,
          },
        );

        if (!sessionInfo.profileUpdated) {
          const statusText = buildBotProfileStatus({
            type: botType,
            room: joinedRoomName,
            createdBy: master,
          });

          ws.updateProfileStatus(statusText);

          sessionInfo.profileUpdated = true;

          console.log(
            `👤 [${botType}:${botUsername}] PROFILE_STATUS_UPDATE_SENT`,
            {
              statusText,
            },
          );
        }

        if (botType === 'music') {
          await markMusicBotJoined({
            room: roomName,
            roomId: joinedRoomId,
          });
        }

        if (mainBot) {
          updateMainBotProfile(mainBot);
        }

        return;
      }

      sessionInfo.joined = false;
      sessionInfo.lastError =
        data.reason || 'room_join_failed';

      console.log(
        `❌ [${botType}:${botUsername}] ROOM_JOIN_FAILED`,
        {
          room: roomName,
          reason: data.reason,
          restore: sessionInfo.restore,
        },
      );

      if (botType === 'music') {
        await markMusicBotFailed({
          room: roomName,
          reason: sessionInfo.lastError,
        });

        if (!sessionInfo.restore) {
          await removeMusicBot(roomName);
        }
      }

      sessions.delete(key);

      if (mainBot) {
        updateMainBotProfile(mainBot);
      }

      return;
    }

    /*
      نحاول حفظ اليوزرس من أي حدث غرفة يحتوي activeUsers/users.
      هذا مهم لأن بعض السيرفرات لا ترسل users داخل room.join،
      لكنها ترسلها في room.update أو room.users_event.
    */
    await saveRoomUsersFromEvent({
      data,
      sessionInfo,
    });

    if (botType === 'controlled') {
      const handled = await handleControlledRoomCommand({
        data,
        ws,
        sessionInfo,
      });

      if (handled) {
        return;
      }
    }

    if (botType === 'music') {
      const handled = await handleMusicRoomCommand({
        data,
        ws,
        sessionInfo,
      });

      if (handled) {
        return;
      }
    }
  });

  client.connect();

  return {
    ok: true,
    message: restore
      ? `♻️ تم استرجاع ${botType} bot: ${botUsername} في ${roomName}`
      : `✅ تم تشغيل ${botType} bot: ${botUsername} في ${roomName}`,
  };
}

export async function restoreSavedBotSessions(mainBot = null) {
  const data = await getBotRooms();

  data.controlled ||= {};
  data.music ||= {};
  data.silent ||= {};

  let started = 0;
  let skipped = 0;
  let failed = 0;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('♻️ [BOT_RESTORE] START');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  for (const [room, bot] of Object.entries(data.controlled)) {
    const username = clean(bot?.username);
    const password = clean(bot?.password);
    const roomName = clean(bot?.room || room);
    const createdBy = clean(bot?.createdBy);

    if (!username || !password || !roomName) {
      failed += 1;

      console.log('❌ [BOT_RESTORE] invalid controlled bot:', {
        room,
        bot,
      });

      continue;
    }

    const result = startBotSession({
      username,
      password,
      room: roomName,
      type: 'controlled',
      restore: true,
      createdBy,
      mainBot,
    });

    if (result.ok) {
      started += 1;
    } else {
      failed += 1;
    }

    console.log('[BOT_RESTORE] controlled:', result.message);
  }

  for (const [room, bot] of Object.entries(data.music)) {
    const username = clean(bot?.username);
    const password = clean(bot?.password);
    const roomName = clean(bot?.room || room);
    const createdBy = clean(bot?.createdBy);

    if (!username || !password || !roomName) {
      failed += 1;

      console.log('❌ [BOT_RESTORE] invalid music bot:', {
        room,
        bot,
      });

      continue;
    }

    const result = startBotSession({
      username,
      password,
      room: roomName,
      type: 'music',
      restore: true,
      createdBy,
      mainBot,
    });

    if (result.ok) {
      started += 1;
    } else {
      failed += 1;
    }

    console.log('[BOT_RESTORE] music:', result.message);
  }

  for (const [room, bots] of Object.entries(data.silent)) {
    if (!Array.isArray(bots)) {
      skipped += 1;
      continue;
    }

    for (const bot of bots) {
      const username = clean(bot?.username);
      const password = clean(bot?.password);
      const roomName = clean(bot?.room || room);
      const createdBy = clean(bot?.createdBy);

      if (!username || !password || !roomName) {
        failed += 1;

        console.log('❌ [BOT_RESTORE] invalid silent bot:', {
          room,
          bot,
        });

        continue;
      }

      const result = startBotSession({
        username,
        password,
        room: roomName,
        type: 'silent',
        restore: true,
        createdBy,
        mainBot,
      });

      if (result.ok) {
        started += 1;
      } else {
        failed += 1;
      }

      console.log('[BOT_RESTORE] silent:', result.message);
    }
  }

  if (mainBot) {
    updateMainBotProfile(mainBot);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('♻️ [BOT_RESTORE] DONE', {
    started,
    skipped,
    failed,
    sessions: sessions.size,
  });
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return {
    ok: true,
    started,
    skipped,
    failed,
    sessions: sessions.size,
  };
}

export function stopBotSession({
  username,
  room,
  type,
  mainBot = null,
}) {
  const botUsername = clean(username);
  const roomName = clean(room);
  const botType = clean(type) || 'controlled';

  const key = sessionKey(
    botType,
    botUsername,
    roomName,
  );

  const sessionInfo = sessions.get(key);

  if (!sessionInfo) {
    return {
      ok: false,
      message: `❌ لا توجد جلسة تعمل للبوت ${botUsername} في ${roomName}`,
    };
  }

  try {
    sessionInfo.client?.stopPing?.();

    if (sessionInfo.client?.ws) {
      sessionInfo.client.ws.close();
    }
  } catch (error) {
    console.log('[BOT_SESSION] stop error:', error?.message);
  }

  sessions.delete(key);

  if (mainBot) {
    updateMainBotProfile(mainBot);
  }

  return {
    ok: true,
    message: `✅ تم إيقاف ${botType} bot: ${botUsername} من ${roomName}`,
  };
}

export function getSessionsCount() {
  return sessions.size;
}

export function getSessionsInfo() {
  return Array.from(sessions.values()).map((item) => ({
    key: item.key,
    type: item.type,
    username: item.username,
    room: item.room,
    createdBy: item.createdBy,
    startedAt: item.startedAt,
    joined: item.joined,
    roomId: item.roomId,
    lastError: item.lastError,
    restore: item.restore,
  }));
}