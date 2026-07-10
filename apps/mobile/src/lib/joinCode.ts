// 6-char uppercase alphanumeric join code generator, excluding visually
// ambiguous characters (0/O, 1/I/L) -- per architecture-v1.md §2.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0,O,1,I,L

export function generateJoinCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}
