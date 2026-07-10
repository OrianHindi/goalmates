// Colors lifted directly from the approved mockup
// (goalmates-mockups.html :root custom properties) so the real app matches
// the founder-signed-off look exactly.
export const colors = {
  green: '#16a34a',
  greenDark: '#0e7c39',
  greenLight: '#e7f7ec',
  gold: '#eab308',
  goldLight: '#fef3c7',
  ink: '#14181a',
  muted: '#667085',
  line: '#e6e8eb',
  danger: '#dc2626',
  dangerLight: '#fde8e8',
  blue: '#2563eb',
  blueLight: '#e8f0fe',
  canvas: '#eef1ef',
  white: '#ffffff',
};

export const avatarColors = ['#16a34a', '#2563eb', '#e11d48', '#9333ea', '#ea580c', '#0891b2'];

export function avatarColorFor(uid: string): string {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) hash = (hash * 31 + uid.charCodeAt(i)) >>> 0;
  return avatarColors[hash % avatarColors.length];
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + second).toUpperCase();
}
