# Architecture v1 Amendment — Multi-competition groups

Status: implemented, amends `architecture-v1.md` (does not replace it).
Founder-approved scope change: **a group can now track more than one
competition**, chosen at creation time. Everything not mentioned below is
unchanged from `architecture-v1.md`.

## 1. Schema change

`groups/{groupId}` (`architecture-v1.md` §2):

| | old (v1) | new (this amendment) |
|---|---|---|
| field | `competitionId: string` | `competitionIds: string[]` |
| immutability | immutable after creation | still immutable after creation |
| add-later flow | none (create a new group instead) | still none — creation-time only |
| cardinality | exactly 1 | 1 to 4 (see §3 for why 4, not "unbounded") |

`packages/shared/src/firestore/types.ts` `GroupDoc.competitionId` →
`GroupDoc.competitionIds: string[]`. No other document shape changes:
`FixtureDoc.competitionId` (singular), `CompetitionAdminDoc.competitionId`
(singular), and `SeedFixture`/`SeedCompetition` (singular) are all
untouched — a fixture and a competitionAdmins grant still each refer to
exactly **one** competition; it's only the group that now tracks several.

## 2. Group-creation batch: N grants, not 1

The atomic group-creation batch (`architecture-v1.md` §3) was: `groups/{id}`
+ its admin `members/{uid}` + `joinCodes/{code}` + **one**
`competitionAdmins/{competitionId}_{uid}` grant — 4 documents total.

It is now: `groups/{id}` + `members/{uid}` + `joinCodes/{code}` + **one
competitionAdmins grant per entry in `competitionIds`** — **3 + N**
documents, where N = `competitionIds.length`.

**Client contract update**: the client must write exactly N grants matching
`competitionIds` 1:1, in the same batch as before. `scripts/seed-emulator.ts`
and the `seedGroup()` test helper (`packages/shared/src/firestore-rules/setup.ts`)
both now loop over `competitionIds` to build one grant per entry.

## 3. Firestore rules change and the real document-read ceiling

`firestore.rules`, `match /groups/{groupId}` `allow create`:

- `competitionId is string` → `competitionIds is list && size() > 0 && size() <= 4`.
- Per-entry validation is **unrolled up to index 3** (4 entries), not a
  `.all()`/list-comprehension: **verified empirically against the real
  emulator** that Firestore rules' list comprehensions cannot call
  `exists()`/`get()` inside the predicate — a first attempt using
  `request.resource.data.competitionIds.all(cid, exists(...))` failed with
  `Function not found error: Name: [all]` when run against
  `firebase emulators:exec`. This is the same "verify before locking in"
  discipline `architecture-v1.md` §3 used for `getAfter()` — don't assume,
  check against the real thing. The unrolled form
  (`size() < i || (exists(...) && ...)`, short-circuiting) is the standard
  workaround for bounded-array validation in Firestore rules.
- Each unrolled index does **two** reads: (a) `exists()` that the
  competition itself is real, and (b) `getAfter()` that a matching
  `competitionAdmins/{competitionId}_{uid}` grant exists **after** this same
  batch commits. (b) is the check that makes "a partial batch missing one
  of the N grants is denied" hold — without it, a group could claim 2
  competitions while the batch only wrote 1 grant, and the create would
  have silently succeeded (this was caught by a failing test during
  implementation, not assumed — see §5).
- `match /competitionAdmins/{grantId}` `allow create`: the check
  `getAfter(groups/{groupId}).data.competitionId == request.resource.data.competitionId`
  became `request.resource.data.competitionId in getAfter(groups/{groupId}).data.competitionIds`
  — a grant's competitionId must be **one of** the group's tracked
  competitions, not the sole one.
- `match /groups/{groupId}` `allow update`: `competitionId ==` became
  `competitionIds ==` (list equality) — still fully immutable, same as
  before, just the field renamed.

**Document-read ceiling, worked exactly** (Firestore's limit: 20 document
accesses total across a transaction/batched write):

| document (create rule) | reads |
|---|---|
| `groups/{id}` | `2N` (N × [competition exists + grant getAfter]) `+ 1` (own admin-membership getAfter) |
| `groups/{id}/members/{uid}` (creator) | `1` (group getAfter) |
| `joinCodes/{code}` | `2` (group + membership getAfter) |
| `competitionAdmins/{cid}_{uid}` × N | `2` each → `2N` |

Total = `(2N+1) + 1 + 2 + 2N = 4N + 4`.

- N=4 → **20** — exactly at the ceiling.
- N=5 → 24 — **over** the ceiling.

**The real, verified ceiling is 4 competitions per group**, not 5 as a
naive per-entry-read estimate might suggest. This still comfortably covers
the founder's stated realistic range (2–4 competitions per group). The
`competitionIds.size() <= 4` check in the rules file enforces this ceiling
directly, so a client can't accidentally construct a batch Firestore would
reject anyway.

## 4. Leaderboard / scoring — no signature change

`packages/shared/src/scoring/computeLeaderboard()` is **unchanged** —
same signature, same implementation. It was already competition-agnostic
(it takes whatever `fixtures` array the caller passes and has no concept of
"competition" at all), so:

- **Per-competition leaderboard**: caller filters its fixtures list to one
  competition before calling — `fixtures.filter(f => f.competitionId ===
  targetCompetitionId)` — then calls `computeLeaderboard(members, bets,
  filteredFixtures)`.
- **Combined leaderboard**: caller calls it again with every fixture across
  all of the group's tracked competitions (no filter).

This is the smallest possible change: scoring stays pure and Firebase-free,
and the "filter then call twice" pattern is a cheap, obviously-correct
client-side operation on data already in memory — not worth adding a
`competitionId` parameter or otherwise complicating the scoring engine's
API. A doc comment was added to `computeLeaderboard()` spelling this out
for whoever builds the mobile leaderboard screen next.

## 5. Confirmed: fixtures rules need zero changes

Fixtures rules (`firestore.rules`, `match /fixtures/{fixtureId}`) reference
only the fixture's own `competitionId` and a `competitionAdmins` grant —
never a group's schema:

```
match /fixtures/{fixtureId} {
  allow read: if isSignedIn();
  allow create: if false; // seed script only, via Admin SDK
  allow update: if isSignedIn()
    && isCompetitionAdmin(resource.data.competitionId)
    && request.resource.data.competitionId == resource.data.competitionId
    && request.resource.data.homeTeam == resource.data.homeTeam
    && request.resource.data.awayTeam == resource.data.awayTeam
    && request.resource.data.kickoffAt == resource.data.kickoffAt
    && request.resource.data.externalRef == resource.data.externalRef
    && request.resource.data.status in ['SCHEDULED', 'FINISHED']
    && (request.resource.data.status == 'FINISHED'
          ? (request.resource.data.homeScore is int && request.resource.data.homeScore >= 0
             && request.resource.data.awayScore is int && request.resource.data.awayScore >= 0)
          : (request.resource.data.homeScore == null && request.resource.data.awayScore == null));
  allow delete: if false;
}
```

`isCompetitionAdmin(competitionId)` itself only does
`exists(competitionAdmins/{competitionId}_{uid})` — it never reads a
`groups/{groupId}` document. A fixture still belongs to exactly one
competition; a group now tracking several competitions doesn't change what
"admin of this fixture's competition" means. **Confirmed unchanged, zero
edits made to this `match` block.**

## 6. Confirmed: bet rules need zero changes

Bet rules (`firestore.rules`, `match /groups/{groupId}/bets/{betId}`) never
reference `competitionId` at all, singular or plural:

```
match /bets/{betId} {
  allow read: if isMember(groupId) && (
    resource.data.userId == request.auth.uid ||
    isLocked(resource.data.fixtureId)
  );

  allow create: if isMember(groupId)
    && request.resource.data.keys().hasOnly(['userId', 'fixtureId', 'predictedHome', 'predictedAway', 'updatedAt'])
    && request.resource.data.userId == request.auth.uid
    && betId == request.resource.data.userId + '_' + request.resource.data.fixtureId
    && request.resource.data.predictedHome is int && request.resource.data.predictedHome >= 0
    && request.resource.data.predictedAway is int && request.resource.data.predictedAway >= 0
    && request.resource.data.updatedAt == request.time
    && !isLocked(request.resource.data.fixtureId);

  allow update: if isMember(groupId)
    && resource.data.userId == request.auth.uid
    && request.resource.data.userId == resource.data.userId
    && request.resource.data.fixtureId == resource.data.fixtureId
    && request.resource.data.keys().hasOnly(['userId', 'fixtureId', 'predictedHome', 'predictedAway', 'updatedAt'])
    && request.resource.data.predictedHome is int && request.resource.data.predictedHome >= 0
    && request.resource.data.predictedAway is int && request.resource.data.predictedAway >= 0
    && request.resource.data.updatedAt == request.time
    && !isLocked(resource.data.fixtureId);

  allow delete: if false; // no bet deletion in v1 (edit instead)
}
```

A bet is gated on group membership (`isMember(groupId)`, an `exists()` on
the membership subcollection) and fixture lock state
(`isLocked(fixtureId)`, a `get()` on the fixture doc) — neither path ever
touches `groups/{groupId}`'s own fields. **Confirmed unchanged, zero edits
made to this `match` block.**

## 7. Seed data

`packages/shared/src/seed/data.ts`: `SEED_GROUP.competitionIds` now lists
**both** seeded competitions (`wc2026` and `israeli-premier-league`), not
just WC2026, so the multi-competition path is actually exercised by the
demo data rather than remaining theoretical. `SEED_BETS` gained a handful
of Israeli Premier League bets (previously WC2026-only) so both the
per-competition and combined leaderboards have non-trivial rows.
`scripts/seed-emulator.ts` writes one `competitionAdmins` grant per entry
in `SEED_GROUP.competitionIds` (was a single grant), inside the same
existing batch.

## 8. Verification performed

- Rules-unit-tests (`pnpm test:rules`, real Firestore emulator, JDK 21):
  **36/36 passing before this change, 41/41 passing after** (5 new tests in
  `group-creation.test.ts`: a 2-competition batch succeeds atomically; a
  batch missing one of N grants is denied; an empty `competitionIds` array
  is denied; a `competitionIds` entry referencing a nonexistent competition
  is denied; a grant whose `competitionId` isn't in the group's
  `competitionIds` is denied).
- `pnpm --filter @goalmates/shared typecheck`: clean.
- `pnpm --filter @goalmates/shared run test` (scoring unit tests): 9/9
  passing, unchanged (no scoring code was touched).
- Seed script run against a live emulator: demo group seeds with
  `competitionIds: ["wc2026", "israeli-premier-league"]` and exactly 2
  `competitionAdmins` documents (`wc2026_seed-alice`,
  `israeli-premier-league_seed-alice`), confirmed by direct Admin-SDK
  reads against the emulator (bypassing rules, as the seed script itself
  does).
