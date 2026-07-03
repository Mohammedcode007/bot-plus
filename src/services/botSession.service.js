import { WsClient } from '../core/wsClient.js';

import {
  markMusicBotJoined,
  markMusicBotFailed,
  removeMusicBot,
} from './botRegistry.service.js';

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

export function startBotSession({
  username,
  password,
  room,
  type,
}) {
  const botUsername = clean(username);
  const botPassword = clean(password);
  const roomName = clean(room);
  const botType = clean(type) || 'controlled';

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
    startedAt: new Date().toISOString(),
    joined: false,
    roomId: '',
    lastError: '',
    joinRequested: false,
  };

  sessions.set(key, sessionInfo);

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
        },
      );

      /*
        مهم:
        لا نستخدم ws.joinRoom(roomName)
        لأن الباك يبحث عن roomId الحقيقي وليس اسم الغرفة.
      */
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

          await removeMusicBot(roomName);
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
        },
      );

      if (botType === 'music') {
        await markMusicBotFailed({
          room: roomName,
          reason: sessionInfo.lastError,
        });

        await removeMusicBot(roomName);
      }

      sessions.delete(key);
      return;
    }

    if (isRoomJoinEvent(data)) {
      if (data.type === 'success') {
        const joinedRoomId =
          data.roomId ||
          data.room?.roomId ||
          sessionInfo.roomId ||
          '';

        sessionInfo.joined = true;
        sessionInfo.roomId = joinedRoomId;
        sessionInfo.lastError = '';

        console.log(
          `✅ [${botType}:${botUsername}] ROOM_JOIN_CONFIRMED`,
          {
            room: roomName,
            roomId: joinedRoomId,
          },
        );

        if (botType === 'music') {
          await markMusicBotJoined({
            room: roomName,
            roomId: joinedRoomId,
          });
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
        },
      );

      if (botType === 'music') {
        await markMusicBotFailed({
          room: roomName,
          reason: sessionInfo.lastError,
        });

        await removeMusicBot(roomName);
      }

      return;
    }

    if (botType === 'controlled') {
      /*
        لاحقًا سنضع أوامر الغرفة هنا.
      */
    }

    if (botType === 'music') {
      /*
        لاحقًا أوامر المزيكا هنا.
      */
    }

    /*
      silent لا يفعل أي شيء.
    */
  });

  client.connect();

  return {
    ok: true,
    message: `✅ تم تشغيل ${botType} bot: ${botUsername} في ${roomName}`,
  };
}

export function stopBotSession({
  username,
  room,
  type,
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
    startedAt: item.startedAt,
    joined: item.joined,
    roomId: item.roomId,
    lastError: item.lastError,
  }));
}