import {
  clean,
} from '../utils/text.js';

function sendWs(ws, payload, debugName) {
  if (!ws || typeof ws.send !== 'function') {
    return {
      ok: false,
      reason: 'ws_send_not_available',
    };
  }

  console.log(`🛡️ [${debugName}] PAYLOAD`, payload);

  const sent = ws.send(payload, {
    debugName,
  });

  return {
    ok: sent === true,
    reason: sent === true ? '' : 'send_failed',
  };
}

export function sendRoomRoleSet({
  ws,
  roomId,
  targetUserId,
  targetUsername,
  role,
}) {
  const finalRoomId = clean(roomId);
  const finalTargetUserId = clean(targetUserId);
  const finalTargetUsername = clean(targetUsername);
  const finalRole = clean(role).toLowerCase();

  if (!finalRoomId) {
    return {
      ok: false,
      reason: 'missing_room_id',
    };
  }

  /*
    مهم:
    room.role.set في الباك غالبًا لا يقبل username فقط.
    لازم targetUserId.
  */
  if (!finalTargetUserId) {
    return {
      ok: false,
      reason: 'missing_target_user_id',
    };
  }

  if (
    finalRole !== 'owner' &&
    finalRole !== 'admin' &&
    finalRole !== 'member'
  ) {
    return {
      ok: false,
      reason: 'invalid_role',
    };
  }

  return sendWs(
    ws,
    {
      handler: 'room.role.set',
      roomId: finalRoomId,
      targetUserId: finalTargetUserId,
      targetUsername: finalTargetUsername,
      role: finalRole,
    },
    'ROOM_ROLE_SET',
  );
}

export function sendRoomKick({
  ws,
  roomId,
  targetUserId,
  targetUsername,
}) {
  const finalRoomId = clean(roomId);
  const finalTargetUserId = clean(targetUserId);
  const finalTargetUsername = clean(targetUsername);

  if (!finalRoomId) {
    return {
      ok: false,
      reason: 'missing_room_id',
    };
  }

  if (!finalTargetUserId) {
    return {
      ok: false,
      reason: 'missing_target_user_id',
    };
  }

  return sendWs(
    ws,
    {
      handler: 'room.kick',
      roomId: finalRoomId,
      targetUserId: finalTargetUserId,
      targetUsername: finalTargetUsername,
    },
    'ROOM_KICK',
  );
}

export function sendRoomBan({
  ws,
  roomId,
  targetUserId,
  targetUsername,
}) {
  const finalRoomId = clean(roomId);
  const finalTargetUserId = clean(targetUserId);
  const finalTargetUsername = clean(targetUsername);

  if (!finalRoomId) {
    return {
      ok: false,
      reason: 'missing_room_id',
    };
  }

  if (!finalTargetUserId) {
    return {
      ok: false,
      reason: 'missing_target_user_id',
    };
  }

  return sendWs(
    ws,
    {
      handler: 'room.ban',
      roomId: finalRoomId,
      targetUserId: finalTargetUserId,
      targetUsername: finalTargetUsername,
    },
    'ROOM_BAN',
  );
}