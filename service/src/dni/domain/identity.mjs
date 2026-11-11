export function isDni(value) {
  return typeof value === 'string' && /^[0-9]{8}$/u.test(value);
}

function cleanName(value) {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}]/u.test(value)) return null;
  const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  return name.length <= 120 && /\p{L}/u.test(name) && !/\p{N}/u.test(name) ? name : null;
}

// Preserve the provider's field boundaries, accents and compound surnames.
export function makeIdentity(requestedDni, { dni, names, firstSurname, secondSurname }) {
  if (dni !== requestedDni) return null;
  const nombres = cleanName(names);
  const apellidoPaterno = cleanName(firstSurname);
  const hasSecond = secondSurname != null &&
    !(typeof secondSurname === 'string' && !secondSurname.trim());
  const apellidoMaterno = hasSecond ? cleanName(secondSurname) : null;
  if (!nombres || !apellidoPaterno || (hasSecond && !apellidoMaterno)) return null;
  return { nombres, apellidoPaterno, apellidoMaterno };
}
