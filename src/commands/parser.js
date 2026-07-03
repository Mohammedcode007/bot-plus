export function cleanText(value) {
  return String(value || '').trim();
}

export function parsePrivateCommand(text) {
  const body = cleanText(text);

  if (!body) {
    return {
      command: '',
      args: [],
      raw: body,
    };
  }

  if (body.toLowerCase() === 'help') {
    return {
      command: 'help',
      args: [],
      raw: body,
    };
  }

  const parts = body.split('@').map((item) => item.trim());

  if (parts[0] === 'V' && parts[1]) {
    return {
      command: 'verify',
      args: [parts[1]],
      raw: body,
    };
  }

  if (parts[0].toLowerCase() === 'unv' && parts[1]) {
    return {
      command: 'unverify',
      args: [parts[1]],
      raw: body,
    };
  }

  if (parts[0].toLowerCase() === 'admin' && parts[1]) {
    return {
      command: 'add_admin',
      args: [parts[1]],
      raw: body,
    };
  }

  if (parts[0].toLowerCase() === 'unadmin' && parts[1]) {
    return {
      command: 'remove_admin',
      args: [parts[1]],
      raw: body,
    };
  }

  if (parts[0].toLowerCase() === 'bot' && parts.length >= 4) {
    return {
      command: 'add_silent_bot',
      args: [parts[1], parts[2], parts.slice(3).join('@')],
      raw: body,
    };
  }

  if (parts[0].toLowerCase() === 'join' && parts[1]) {
    return {
      command: 'add_music_bot',
      args: [parts.slice(1).join('@')],
      raw: body,
    };
  }

  if (parts.length >= 3) {
    return {
      command: 'add_controlled_bot',
      args: [parts[0], parts[1], parts.slice(2).join('@')],
      raw: body,
    };
  }

  return {
    command: 'unknown',
    args: [],
    raw: body,
  };
}