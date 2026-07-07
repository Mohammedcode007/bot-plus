import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { ENV } from '../config/env.js';

function safeCloneForLog(value) {
  try {
    const copy = JSON.parse(JSON.stringify(value));

    if (copy.password) {
      copy.password = '***';
    }

    if (copy.payload?.password) {
      copy.payload.password = '***';
    }

    if (copy.data?.password) {
      copy.data.password = '***';
    }

    return copy;
  } catch {
    return value;
  }
}

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .normalize('NFC');
}

function normalizeRoomName(value) {
  return normalizeText(value).toLowerCase();
}

export class WsClient {
  constructor({ username, password, label }) {
    this.username = username;
    this.password = password;
    this.label = label || username;

    this.ws = null;
    this.connected = false;
    this.loggedIn = false;

    this.listeners = new Set();
    this.pingTimer = null;
    this.reconnectTimer = null;

    this.pendingLoginRequests = new Map();

    /*
      انتظار رد room.list
    */
    this.pendingRoomListResolvers = [];
  }

  connect() {
  

    this.ws = new WebSocket(ENV.WS_URL);

    this.ws.on('open', () => {
      this.connected = true;


      this.login();
      this.startPing();
    });

    this.ws.on('message', (raw) => {
      const rawText = raw.toString();



      let data;

      try {
        data = JSON.parse(rawText);
      } catch {
        return;
      }

      console.dir(data, { depth: null, colors: true });

      this.handleMessage(data);
    });

    this.ws.on('close', (code, reason) => {
   

      this.connected = false;
      this.loggedIn = false;

      this.stopPing();
      this.scheduleReconnect();
    });

    this.ws.on('error', (error) => {

    });
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);


    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, ENV.RECONNECT_DELAY_MS);
  }

  startPing() {
    this.stopPing();

    this.pingTimer = setInterval(() => {
      this.send(
        {
          handler: 'ping',
          type: 'ping',
          time: new Date().toISOString(),
        },
        {
          debugName: 'PING',
        },
      );
    }, ENV.PING_INTERVAL_MS);
  }

  stopPing() {
    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  login() {
    if (!this.username || !this.password) {
      return false;
    }

    const payload = {
      handler: 'auth.login',

      username: String(this.username).trim(),
      password: String(this.password).trim(),

      session: String(ENV.BOT_SESSION || '').trim(),

      /*
        الباك ينتظر sdk نص.
      */
      sdk: String(ENV.BOT_SDK || '25').trim(),

      /*
        الباك ينتظر ver وليس version.
      */
      ver: String(ENV.BOT_VERSION || '332').trim(),

      /*
        الباك يشترط id.
      */
      id: String(ENV.BOT_ID || this.username || 'bot').trim(),
    };

 

    return this.send(payload, {
      debugName: 'NORMAL_LOGIN',
      isLogin: true,
    });
  }

  handleMessage(data) {
    const handler = String(data.handler || '');
    const requestId = String(data.request_id || data.requestId || '');



    if (requestId && this.pendingLoginRequests.has(requestId)) {
      const info = this.pendingLoginRequests.get(requestId);

 

      if (data.reason === 'invalid_login_payload') {
      }

      if (data.reason === 'wrong_password') {
      }

      if (data.reason === 'user_not_found') {
      }

      if (data.type === 'success') {
      }
    }

    if (handler === 'login_event') {
      if (data.type === 'success') {
        this.loggedIn = true;


        if (data.user) {
  
        }

        if (data.token) {
      
        }
      } else {

      }
    }

    /*
      استقبال قائمة الغرف.
      حسب السيرفر ممكن ترجع بأكثر من handler أو شكل.
    */
    if (
      handler === 'room.list' ||
      handler === 'room_list_event' ||
      handler === 'rooms_list_event'
    ) {
      const rooms = this.extractRoomsFromEvent(data);

  

      const resolvers = this.pendingRoomListResolvers.splice(0);

      for (const resolve of resolvers) {
        resolve(rooms);
      }
    }

    if (handler === 'room.join') {
      if (data.type === 'success') {
 
      } else {
  
      }
    }

    for (const listener of this.listeners) {
      listener(data, this);
    }
  }

  onMessage(listener) {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  send(payload, meta = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
     

      return false;
    }

    const requestId = randomUUID();

    const body = {
      request_id: requestId,
      ...payload,
    };

    if (meta.isLogin) {
      this.pendingLoginRequests.set(requestId, {
        requestId,
        debugName: meta.debugName || 'UNKNOWN_LOGIN',
        sentAt: new Date().toISOString(),
      });
    }

    console.dir(safeCloneForLog(body), {
      depth: null,
      colors: true,
    });

    const json = JSON.stringify(body);


    this.ws.send(json);

    return true;
  }

  sendDm(toUserId, text) {
    const target = String(toUserId || '').trim();
    const body = String(text || '').trim();

    if (!target || !body) {


      return false;
    }

    return this.send(
      {
        /*
          الهاندلر الموجود عندك للخاص.
          لو السيرفر عندك يستخدم اسمًا آخر غيّر هذا السطر فقط.
        */
        handler: 'dm.send',

        /*
          نرسل أكثر من مفتاح لزيادة التوافق مع الباك.
        */
        to_user_id: target,
        toUserId: target,
        to_user: target,
        toUser: target,
        to_username: target,
        toUsername: target,

        messageKind: 'user',
        type: 'text',
        text: body,
        message: body,
        body,
      },
      {
        debugName: 'DM_SEND',
      },
    );
  }

  /*
    Alias متوافق مع dmRelay.service.js
    يستخدم عندما يكتب المستخدم:
    @username message
  */
  sendPrivateMessage(toUserIdOrUsername, text) {
    return this.sendDm(
      toUserIdOrUsername,
      text,
    );
  }

  /*
    Alias آخر متوافق مع dmRelay.service.js
  */
  sendDmMessage({
    toUserId,
    toUsername,
    text,
  }) {
    return this.sendDm(
      String(toUserId || toUsername || '').trim(),
      text,
    );
  }
  /*
    طلب قائمة الغرف.
  */
  listRooms() {
    return this.send(
      {
        handler: 'room.list',
      },
      {
        debugName: 'ROOM_LIST',
      },
    );
  }

  /*
    انتظار رد room.list.
  */
  waitForRoomsList(timeoutMs = 8000) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
   
      }, timeoutMs);

      this.pendingRoomListResolvers.push((rooms) => {
        clearTimeout(timer);
        resolve(rooms);
      });

      this.listRooms();
    });
  }

  /*
    استخراج الغرف من رد السيرفر مهما كان شكل الداتا.
  */
  extractRoomsFromEvent(data) {
    if (Array.isArray(data.rooms)) {
      return data.rooms;
    }

    if (Array.isArray(data.data)) {
      return data.data;
    }

    if (Array.isArray(data.items)) {
      return data.items;
    }

    if (Array.isArray(data.result)) {
      return data.result;
    }

    if (Array.isArray(data.roomsList)) {
      return data.roomsList;
    }

    if (Array.isArray(data.payload?.rooms)) {
      return data.payload.rooms;
    }

    if (Array.isArray(data.payload?.data)) {
      return data.payload.data;
    }

    return [];
  }

  /*
    البحث عن غرفة باسمها.
  */
  async findRoomByName(roomName) {
    const target = normalizeRoomName(roomName);

    const rooms = await this.waitForRoomsList();

  

    for (const room of rooms) {
      const currentName = normalizeRoomName(
        room.name ||
          room.roomName ||
          room.title ||
          '',
      );

      if (currentName === target) {


        return room;
      }
    }



    return null;
  }

  /*
    الدخول الذكي:
    - لو القيمة room_... يدخل مباشرة.
    - لو اسم غرفة، يجيب roomId الحقيقي من room.list ثم يدخل.
  */
  async joinRoomSmart(roomNameOrId) {
    const value = normalizeText(roomNameOrId);

    if (!value) {

      return {
        ok: false,
        reason: 'empty_room',
      };
    }

    if (value.startsWith('room_')) {
      this.joinRoom(value, '');

      return {
        ok: true,
        roomId: value,
        roomName: '',
      };
    }

    const room = await this.findRoomByName(value);

    if (!room?.roomId) {
      return {
        ok: false,
        reason: 'room_not_found',
        roomName: value,
      };
    }

    const realRoomId = String(room.roomId || '').trim();

    const realRoomName = String(
      room.name ||
        room.roomName ||
        room.title ||
        value,
    ).trim();

    this.joinRoom(realRoomId, realRoomName);

    return {
      ok: true,
      roomId: realRoomId,
      roomName: realRoomName,
    };
  }

  /*
    دخول الغرفة بالـ roomId الحقيقي.
  */
  joinRoom(roomId, roomName = '') {
    return this.send(
      {
        handler: 'room.join',
        roomId: String(roomId || '').trim(),
        roomName: String(roomName || '').trim(),
        password: '',
      },
      {
        debugName: 'ROOM_JOIN',
      },
    );
  }
sendRoomMessage(roomId, text, roomName = '') {
  const finalRoomId = String(roomId || this.roomId || '').trim();
  const finalRoomName = String(roomName || this.roomName || '').trim();
  const finalText = String(text || '').trim();

  if (!finalRoomId || !finalText) {
 

    return false;
  }

  return this.send(
    {
      handler: 'room.message.send',
      roomId: finalRoomId,
      roomName: finalRoomName,
      type: 'text',
      text: finalText,
    },
    {
      debugName: 'ROOM_MESSAGE_SEND',
    },
  );
}
sendRoomAudioUrl(roomId, audioUrl, roomName = '') {
  const finalRoomId = String(roomId || this.roomId || '').trim();
  const finalRoomName = String(roomName || this.roomName || '').trim();
  const finalUrl = String(audioUrl || '').trim();

  if (!finalRoomId || !finalUrl) {


    return false;
  }

  return this.send(
    {
      handler: 'room.message.send',
      roomId: finalRoomId,
      roomName: finalRoomName,
      messageKind: 'user',
      type: 'audio',
      media: {
        url: finalUrl,
        type: 'audio',
      },
      audioUrl: finalUrl,
      url: finalUrl,
      text: '',
    },
    {
      debugName: 'ROOM_AUDIO_SEND',
    },
  );
}
  // sendRoomMessage(room, text) {
  //   return this.send(
  //     {
  //       handler: 'room.message.send',
  //       roomId: String(room || '').trim(),
  //       roomName: String(room || '').trim(),
  //       type: 'text',
  //       text: String(text || ''),
  //     },
  //     {
  //       debugName: 'ROOM_MESSAGE_SEND',
  //     },
  //   );
  // }
    updateProfileStatus(statusText) {
    const text = String(statusText || '').trim();

    if (!text) {
      return false;
    }

    return this.send(
      {
        /*
          هاندلر تحديث البروفايل في الباك.
          إذا كان عندك في WS_HANDLERS اسم مختلف، غيّر هذا السطر فقط.
        */
        handler: 'users.profile.update',

        status_message: text,
        statusMessage: text,
      },
      {
        debugName: 'PROFILE_STATUS_UPDATE',
      },
    );
  }
}