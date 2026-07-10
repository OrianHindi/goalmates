// Collection/doc path helpers — the single source of truth for path shapes,
// so the app, the seed script, and the rules-unit-tests never hand-roll a
// path string differently from one another.

export function usersPath(): string {
  return 'users';
}

export function userPath(userId: string): string {
  return `${usersPath()}/${userId}`;
}

export function groupsPath(): string {
  return 'groups';
}

export function groupPath(groupId: string): string {
  return `${groupsPath()}/${groupId}`;
}

export function groupMembersPath(groupId: string): string {
  return `${groupPath(groupId)}/members`;
}

export function groupMemberPath(groupId: string, userId: string): string {
  return `${groupMembersPath(groupId)}/${userId}`;
}

export function betsPath(groupId: string): string {
  return `${groupPath(groupId)}/bets`;
}

/** `betId` is always `${userId}_${fixtureId}` — see architecture-v1.md §2. */
export function betDocId(userId: string, fixtureId: string): string {
  return `${userId}_${fixtureId}`;
}

export function betPath(groupId: string, userId: string, fixtureId: string): string {
  return `${betsPath(groupId)}/${betDocId(userId, fixtureId)}`;
}

export function competitionsPath(): string {
  return 'competitions';
}

export function competitionPath(competitionId: string): string {
  return `${competitionsPath()}/${competitionId}`;
}

export function fixturesPath(): string {
  return 'fixtures';
}

export function fixturePath(fixtureId: string): string {
  return `${fixturesPath()}/${fixtureId}`;
}

export function joinCodesPath(): string {
  return 'joinCodes';
}

export function joinCodePath(code: string): string {
  return `${joinCodesPath()}/${code}`;
}

export function competitionAdminsPath(): string {
  return 'competitionAdmins';
}

export function competitionAdminDocId(competitionId: string, userId: string): string {
  return `${competitionId}_${userId}`;
}

export function competitionAdminPath(competitionId: string, userId: string): string {
  return `${competitionAdminsPath()}/${competitionAdminDocId(competitionId, userId)}`;
}
