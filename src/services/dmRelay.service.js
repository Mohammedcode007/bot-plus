import {
  clean,
} from '../utils/text.js';

export async function sendPrivateMessageByBot({
  ws,
  toUserId,
  toUsername,
  text,
}) {
  const finalText = clean(text);
  const finalUserId = clean(toUserId);
  const finalUsername = clean(toUsername);

  if (!finalText) {
    return {
      ok: false,
      reason: 'empty_message',
    };
  }

  if (!finalUserId && !finalUsername) {
    return {
      ok: false,
      reason: 'missing_target',
    };
  }

  if (typeof ws.sendPrivateMessage === 'function') {
    await ws.sendPrivateMessage(
      finalUserId || finalUsername,
      finalText,
    );

    return {
      ok: true,
    };
  }

  if (typeof ws.sendDm === 'function') {
    await ws.sendDm(
      finalUserId || finalUsername,
      finalText,
    );

    return {
      ok: true,
    };
  }

  if (typeof ws.sendDmMessage === 'function') {
    await ws.sendDmMessage({
      toUserId: finalUserId,
      toUsername: finalUsername,
      text: finalText,
    });

    return {
      ok: true,
    };
  }

  if (typeof ws.sendMessage === 'function') {
    await ws.sendMessage({
      handler: 'dm.send',
      to_user_id: finalUserId || finalUsername,
      toUserId: finalUserId,
      toUsername: finalUsername,
      type: 'text',
      text: finalText,
    });

    return {
      ok: true,
    };
  }

  return {
    ok: false,
    reason: 'no_private_sender_method',
  };
}
