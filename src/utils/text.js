export function clean(value) {
  return String(value || '').trim();
}

export function normalizeText(value) {
  return clean(value).normalize('NFC');
}

export function normalizeName(value) {
  return normalizeText(value).toLowerCase();
}

export function normalizeCommand(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\s+/g, '');
}