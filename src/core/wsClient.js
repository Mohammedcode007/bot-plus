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
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🚀 [${this.label}] CONNECT_START`);
    console.log(`🌐 [${this.label}] WS_URL:`, ENV.WS_URL);
    console.log(`👤 [${this.label}] username:`, this.username);
    console.log(`🔑 [${this.label}] password_length:`, clean(this.password).length);
    console.log(`🧾 [${this.label}] BOT_SESSION:`, ENV.BOT_SESSION);
    console.log(`🧩 [${this.label}] BOT_SDK:`, ENV.BOT_SDK, typeof ENV.BOT_SDK);
    console.log(`📦 [${this.label}] BOT_VERSION:`, ENV.BOT_VERSION, typeof ENV.BOT_VERSION);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    this.ws = new WebSocket(ENV.WS_URL);

    this.ws.on('open', () => {
      this.connected = true;

      console.log(`✅ [${this.label}] WS connected`);

      this.login();
      this.startPing();
    });

    this.ws.on('message', (raw) => {
      const rawText = raw.toString();

      console.log(`\n📥 [${this.label}] RAW_MESSAGE`);
      console.log(rawText);

      let data;

      try {
        data = JSON.parse(rawText);
      } catch {
        console.log(`⚠️ [${this.label}] invalid json`, rawText);
        return;
      }

      console.log(`📦 [${this.label}] PARSED_MESSAGE`);
      console.dir(data, { depth: null, colors: true });

      this.handleMessage(data);
    });

    this.ws.on('close', (code, reason) => {
      console.log(`❌ [${this.label}] WS closed`, {
        code,
        reason: reason?.toString?.() || '',
      });

      this.connected = false;
      this.loggedIn = false;

      this.stopPing();
      this.scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      console.log(`❌ [${this.label}] WS error`, {
        message: error.message,
        stack: error.stack,
      });
    });
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);

    console.log(`🔁 [${this.label}] reconnect after`, ENV.RECONNECT_DELAY_MS);

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
      console.log(`❌ [${this.label}] missing username or password`);
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

    console.log(`🔐 [${this.label}] LOGIN_PAYLOAD`, {
      handler: payload.handler,
      username: payload.username,
      password: '***',
      session: payload.session,
      sdk: payload.sdk,
      ver: payload.ver,
      id: payload.id,
    });

    return this.send(payload, {
      debugName: 'NORMAL_LOGIN',
      isLogin: true,
    });
  }

  handleMessage(data) {
    const handler = String(data.handler || '');
    const requestId = String(data.request_id || data.requestId || '');

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📡 [${this.label}] SOCKET_EVENT`);
    console.log(`🏷️ handler=`, handler);
    console.log(`📌 type=`, data.type);
    console.log(`❓ reason=`, data.reason);
    console.log(`💬 message=`, data.message);
    console.log(`🆔 request_id=`, requestId);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    if (requestId && this.pendingLoginRequests.has(requestId)) {
      const info = this.pendingLoginRequests.get(requestId);

      console.log(`🔎 [${this.label}] MATCHED_LOGIN_RESPONSE`, {
        requestId,
        variant: info.debugName,
        sentAt: info.sentAt,
        responseHandler: handler,
        responseType: data.type,
        reason: data.reason,
        message: data.message,
      });

      if (data.reason === 'invalid_login_payload') {
        console.log(`🚨 [${this.label}] RESULT_FOR_${info.debugName}: invalid_login_payload`);
      }

      if (data.reason === 'wrong_password') {
        console.log(`🔑 [${this.label}] RESULT_FOR_${info.debugName}: payload accepted but password is wrong`);
      }

      if (data.reason === 'user_not_found') {
        console.log(`👤 [${this.label}] RESULT_FOR_${info.debugName}: payload accepted but user not found`);
      }

      if (data.type === 'success') {
        console.log(`✅ [${this.label}] RESULT_FOR_${info.debugName}: LOGIN SUCCESS`);
      }
    }

    if (handler === 'login_event') {
      if (data.type === 'success') {
        this.loggedIn = true;

        console.log(`✅ [${this.label}] logged in`);

        if (data.user) {
          console.log(`👤 [${this.label}] LOGIN_USER`, {
            userId: data.user.userId,
            username: data.user.username,
            current: data.user.current,
          });
        }

        if (data.token) {
          console.log(`🎟️ [${this.label}] LOGIN_TOKEN_RECEIVED`, {
            tokenLength: String(data.token).length,
            session_expires_at: data.session_expires_at,
          });
        }
      } else {
        console.log(`❌ [${this.label}] login failed`, {
          reason: data.reason,
          message: data.message,
          request_id: requestId,
        });
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

      console.log(`📚 [${this.label}] ROOMS_LIST_RECEIVED`, {
        count: rooms.length,
        sample: rooms.slice(0, 10).map((room) => ({
          roomId: room.roomId,
          name: room.name || room.roomName || room.title,
        })),
      });

      const resolvers = this.pendingRoomListResolvers.splice(0);

      for (const resolve of resolvers) {
        resolve(rooms);
      }
    }

    if (handler === 'room.join') {
      if (data.type === 'success') {
        console.log(`✅ [${this.label}] ROOM_JOIN_SUCCESS`, {
          requestId,
          roomId: data.roomId || data.room?.roomId,
          roomName: data.roomName || data.room?.name,
        });
      } else {
        console.log(`❌ [${this.label}] ROOM_JOIN_FAILED`, {
          requestId,
          reason: data.reason,
          message: data.message,
        });
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
      console.log(`❌ [${this.label}] SEND_FAILED_SOCKET_NOT_OPEN`, {
        readyState: this.ws?.readyState,
      });

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

    console.log(`\n📤 [${this.label}] RAW_SEND`);
    console.dir(safeCloneForLog(body), {
      depth: null,
      colors: true,
    });

    const json = JSON.stringify(body);

    console.log(`📏 [${this.label}] SEND_JSON_LENGTH`, json.length);

    this.ws.send(json);

    return true;
  }

  sendDm(toUserId, text) {
    const target = String(toUserId || '').trim();
    const body = String(text || '').trim();

    if (!target || !body) {
      console.log(`❌ [${this.label}] DM_SEND_FAILED_EMPTY_DATA`, {
        target,
        hasText: Boolean(body),
      });

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
        console.log(`⏱️ [${this.label}] ROOM_LIST_TIMEOUT`);
        resolve([]);
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

    console.log(`🔎 [${this.label}] FIND_ROOM_BY_NAME`, {
      target: roomName,
      normalizedTarget: target,
      roomsCount: rooms.length,
    });

    for (const room of rooms) {
      const currentName = normalizeRoomName(
        room.name ||
          room.roomName ||
          room.title ||
          '',
      );

      if (currentName === target) {
        console.log(`✅ [${this.label}] ROOM_FOUND`, {
          input: roomName,
          roomId: room.roomId,
          name: room.name || room.roomName || room.title,
        });

        return room;
      }
    }

    console.log(`❌ [${this.label}] ROOM_NOT_FOUND_BY_NAME`, {
      input: roomName,
      availableRooms: rooms.map((room) => ({
        roomId: room.roomId,
        name: room.name || room.roomName || room.title,
      })),
    });

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
      console.log(`❌ [${this.label}] joinRoomSmart failed: empty room`);

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

  sendRoomMessage(room, text) {
    return this.send(
      {
        handler: 'room.message.send',
        roomId: String(room || '').trim(),
        roomName: String(room || '').trim(),
        type: 'text',
        text: String(text || ''),
      },
      {
        debugName: 'ROOM_MESSAGE_SEND',
      },
    );
  }
    updateProfileStatus(statusText) {
    const text = String(statusText || '').trim();

    if (!text) {
      console.log(`❌ [${this.label}] empty profile status`);
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