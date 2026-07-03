import path from 'path';
import { JsonStore } from '../core/jsonStore.js';
import { ENV } from '../config/env.js';

const registryStore = new JsonStore(
  path.resolve('data/bot-rooms.json'),
  {
    controlled: {},
    music: {},
    silent: {},
  },
);

function clean(value) {
  return String(value || '').trim();
}

export async function getBotRooms() {
  return registryStore.read();
}

export async function addControlledBot({
  username,
  password,
  room,
  createdBy,
}) {
  const botUsername = clean(username);
  const botPassword = clean(password);
  const roomName = clean(room);

  if (!botUsername || !botPassword || !roomName) {
    return {
      ok: false,
      message: '❌ الصيغة خطأ: username@password@room',
    };
  }

  return registryStore.update((data) => {
    data.controlled ||= {};
    data.music ||= {};
    data.silent ||= {};

    if (data.controlled[roomName]) {
      return {
        ...data,
        __result: {
          ok: false,
          message: `❌ يوجد بوت متحكم بالفعل في غرفة ${roomName}`,
        },
      };
    }

    data.controlled[roomName] = {
      username: botUsername,
      password: botPassword,
      room: roomName,
      type: 'controlled',
      createdBy: clean(createdBy),
      createdAt: new Date().toISOString(),

      /*
        يتم تحديثها لاحقًا بعد نجاح الدخول.
      */
      joined: false,
      joinedAt: '',
      roomId: '',
      lastError: '',
    };

    data.__result = {
      ok: true,
      message: `✅ تم إضافة بوت متحكم للغرفة ${roomName}`,
    };

    return data;
  }).then(async (data) => {
    const result = data.__result;

    delete data.__result;
    await registryStore.write(data);

    return result;
  });
}

export async function addSilentBot({
  username,
  password,
  room,
  createdBy,
}) {
  const botUsername = clean(username);
  const botPassword = clean(password);
  const roomName = clean(room);

  if (!botUsername || !botPassword || !roomName) {
    return {
      ok: false,
      message: '❌ الصيغة خطأ: bot@username@password@room',
    };
  }

  await registryStore.update((data) => {
    data.controlled ||= {};
    data.music ||= {};
    data.silent ||= {};

    data.silent[roomName] ||= [];

    data.silent[roomName].push({
      username: botUsername,
      password: botPassword,
      room: roomName,
      type: 'silent',
      createdBy: clean(createdBy),
      createdAt: new Date().toISOString(),

      joined: false,
      joinedAt: '',
      roomId: '',
      lastError: '',
    });

    return data;
  });

  return {
    ok: true,
    message: `✅ تم إضافة بوت صامت للغرفة ${roomName}`,
  };
}

export async function addMusicBot({
  room,
  createdBy,
}) {
  const roomName = clean(room);

  if (!roomName) {
    return {
      ok: false,
      message: '❌ الصيغة خطأ: join@room',
    };
  }

  const musicUsername = clean(ENV.MUSIC_BOT_USERNAME);
  const musicPassword = clean(ENV.MUSIC_BOT_PASSWORD);

  if (!musicUsername || !musicPassword) {
    return {
      ok: false,
      message: '❌ بيانات بوت المزيكا غير موجودة في ملف .env',
    };
  }

  return registryStore.update((data) => {
    data.controlled ||= {};
    data.music ||= {};
    data.silent ||= {};

    if (data.music[roomName]) {
      return {
        ...data,
        __result: {
          ok: false,
          message: `❌ يوجد بوت مزيكا بالفعل في غرفة ${roomName}`,
        },
      };
    }

    data.music[roomName] = {
      username: musicUsername,
      password: musicPassword,
      room: roomName,
      type: 'music',
      createdBy: clean(createdBy),
      createdAt: new Date().toISOString(),

      /*
        مهم:
        لا نعتبره دخل فعليًا إلا بعد نجاح room.join.
      */
      joined: false,
      joinedAt: '',
      roomId: '',
      lastError: '',
    };

    data.__result = {
      ok: true,
      message: `✅ تم تجهيز بوت المزيكا لغرفة ${roomName}`,
    };

    return data;
  }).then(async (data) => {
    const result = data.__result;

    delete data.__result;
    await registryStore.write(data);

    return result;
  });
}

export async function markMusicBotJoined({
  room,
  roomId,
}) {
  const roomName = clean(room);
  const realRoomId = clean(roomId);

  if (!roomName) {
    return {
      ok: false,
      message: 'missing_room',
    };
  }

  await registryStore.update((data) => {
    data.controlled ||= {};
    data.music ||= {};
    data.silent ||= {};

    if (!data.music[roomName]) {
      return data;
    }

    data.music[roomName] = {
      ...data.music[roomName],
      joined: true,
      joinedAt: new Date().toISOString(),
      roomId: realRoomId,
      lastError: '',
    };

    return data;
  });

  return {
    ok: true,
    message: `✅ تم تأكيد دخول بوت المزيكا إلى غرفة ${roomName}`,
  };
}

export async function markMusicBotFailed({
  room,
  reason,
}) {
  const roomName = clean(room);
  const errorReason = clean(reason);

  if (!roomName) {
    return {
      ok: false,
      message: 'missing_room',
    };
  }

  await registryStore.update((data) => {
    data.controlled ||= {};
    data.music ||= {};
    data.silent ||= {};

    if (!data.music[roomName]) {
      return data;
    }

    data.music[roomName] = {
      ...data.music[roomName],
      joined: false,
      joinedAt: '',
      lastError: errorReason || 'join_failed',
    };

    return data;
  });

  return {
    ok: true,
    message: `❌ فشل دخول بوت المزيكا إلى غرفة ${roomName}`,
  };
}

/*
  حذف بوت المزيكا من الريجستري.
  استخدمها إذا فشل join نهائيًا أو تريد إعادة المحاولة.
*/
export async function removeMusicBot(room) {
  const roomName = clean(room);

  if (!roomName) {
    return {
      ok: false,
      message: '❌ اسم الغرفة فارغ.',
    };
  }

  return registryStore.update((data) => {
    data.controlled ||= {};
    data.music ||= {};
    data.silent ||= {};

    if (!data.music[roomName]) {
      return {
        ...data,
        __result: {
          ok: false,
          message: `❌ لا يوجد بوت مزيكا محفوظ لغرفة ${roomName}`,
        },
      };
    }

    delete data.music[roomName];

    data.__result = {
      ok: true,
      message: `✅ تم حذف بوت المزيكا من غرفة ${roomName}`,
    };

    return data;
  }).then(async (data) => {
    const result = data.__result;

    delete data.__result;
    await registryStore.write(data);

    return result;
  });
}

export async function removeControlledBot(room) {
  const roomName = clean(room);

  if (!roomName) {
    return {
      ok: false,
      message: '❌ اسم الغرفة فارغ.',
    };
  }

  return registryStore.update((data) => {
    data.controlled ||= {};
    data.music ||= {};
    data.silent ||= {};

    if (!data.controlled[roomName]) {
      return {
        ...data,
        __result: {
          ok: false,
          message: `❌ لا يوجد بوت متحكم محفوظ لغرفة ${roomName}`,
        },
      };
    }

    delete data.controlled[roomName];

    data.__result = {
      ok: true,
      message: `✅ تم حذف البوت المتحكم من غرفة ${roomName}`,
    };

    return data;
  }).then(async (data) => {
    const result = data.__result;

    delete data.__result;
    await registryStore.write(data);

    return result;
  });
}

export async function removeSilentBots(room) {
  const roomName = clean(room);

  if (!roomName) {
    return {
      ok: false,
      message: '❌ اسم الغرفة فارغ.',
    };
  }

  return registryStore.update((data) => {
    data.controlled ||= {};
    data.music ||= {};
    data.silent ||= {};

    if (!Array.isArray(data.silent[roomName]) || data.silent[roomName].length === 0) {
      return {
        ...data,
        __result: {
          ok: false,
          message: `❌ لا توجد بوتات صامتة محفوظة لغرفة ${roomName}`,
        },
      };
    }

    delete data.silent[roomName];

    data.__result = {
      ok: true,
      message: `✅ تم حذف البوتات الصامتة من غرفة ${roomName}`,
    };

    return data;
  }).then(async (data) => {
    const result = data.__result;

    delete data.__result;
    await registryStore.write(data);

    return result;
  });
}