# GoalMates Architecture v1 — Firestore-native, no app server

Status: proposed, implementable as-is. Supersedes nothing — there is no earlier
Postgres/Prisma design in this repo; this is the first and final backend
architecture for v1, per the founder's stack pivot (Firebase over
Next.js API + Prisma + PGlite).

Required reading before this doc: `CLAUDE.md`, `docs/product-spec-v1.md`.

## 0. Stack decision and why

- **Backend**: Firebase — Firestore (database) + Firebase Auth. **No custom
  server, nothing to host.** The Expo/React Native mobile app talks to
  Firestore directly via the Firebase JS SDK.
- **Why no server**: this app is read/write-heavy on a handful of documents
  per screen (fixtures, bets, leaderboard), has no background jobs, no
  third-party webhooks, and no payments — there is nothing a server would do
  that Firestore + security rules + a client-computed leaderboard can't do
  at friends-scale. Adding a server would mean hosting cost and an extra
  deploy target for zero functional gain.
- **Why no Cloud Functions**: Functions require the paid Blaze plan. v1 is
  explicitly designed to avoid needing them — see §3 for how bet-locking,
  privacy, and score-entry authorization move entirely into Firestore
  Security Rules, and §4 for why the leaderboard is a client-side pure
  function over data the client can already read.
- **Local dev cost**: **$0, no account.** The Firebase Emulator Suite
  (Firestore + Auth emulators) runs entirely offline against a placeholder
  project ID — no real Firebase project, no GCP billing, no sign-up. See §5.
- **The tradeoff this creates**: with no server, Firestore Security Rules
  *are* the entire authorization boundary — there is no second layer to
  catch a rules mistake. §3 is written to be reviewed line-by-line by the
  security-engineer before this ships; treat that review as mandatory, not
  optional.

## 1. Monorepo layout

```
apps/
  mobile/            # Expo/React Native app (the only app — no web, no api)
packages/
  shared/
    src/
      scoring/       # pure, zero-Firebase-deps: scoreForBet, computeLeaderboard,
                      # tie-break comparator. Runs in RN AND in plain Node (tests).
      firestore/     # Firestore-dependent: TypeScript types for every document
                      # shape (User, Group, Member, Competition, Fixture, Bet,
                      # JoinCode, CompetitionAdmin), collection path helpers/
                      # constants, typed converters (snapshot -> plain object).
      auth/           # AuthProvider interface + shared types only (no
                      # implementation — implementations are platform code in
                      # apps/mobile, see §6).
      seed/           # Seed DATA constants (seeded user list w/ dev emails,
                      # demo group/competition/fixture definitions) imported by
                      # both scripts/seed-emulator.ts and the rules-unit-tests,
                      # so magic strings aren't duplicated across them.
docs/
  architecture-v1.md  # this file
firestore.rules        # committed at repo root (this PR)
firebase.json           # committed at repo root (this PR)
.firebaserc              # committed at repo root (this PR)
scripts/
  seed-emulator.ts      # NOT part of this PR — T4 (backend-developer) writes
                        # this; see §5 for its exact spec.
```

No `apps/api` — deliberately dropped. `pnpm-workspace.yaml` already globs
`apps/*` and `packages/*`, so **no change needed there**; `apps/mobile` and
`packages/shared` are picked up automatically the moment they're created.

Root `package.json` currently has no `dev`/`emulators`/`seed` scripts because
none of the referenced files exist yet. **T4 must add**, once
`scripts/seed-emulator.ts` and `apps/mobile` exist:

```json
"emulators": "firebase emulators:start",
"seed": "tsx scripts/seed-emulator.ts",
"dev:mobile": "pnpm --filter @goalmates/mobile start",
"test:rules": "firebase emulators:exec --only firestore,auth \"pnpm --filter @goalmates/shared run test:rules\""
```

Plus root devDependencies: `firebase-tools`, `tsx` (or `ts-node`),
`firebase-admin` (used only by the seed script, Node-only, never bundled into
the Expo app).

## 2. Firestore data model

All timestamps are Firestore `Timestamp`, not epoch numbers or strings, so
rules can compare them directly against `request.time`.

### `users/{userId}`
1:1 with the Firebase Auth uid (real project) / Auth emulator uid (dev).

| field | type | notes |
|---|---|---|
| `displayName` | string | required |
| `photoURL` | string \| null | optional |

### `groups/{groupId}`
Firestore auto-generated ID (20-char random). **Not sequential, not
guessable** — this matters for §3's join-code design.

| field | type | notes |
|---|---|---|
| `name` | string | editable by admin |
| `competitionId` | string | immutable after creation (product spec §2: one group ↔ one competition, fixed) |
| `createdBy` | string (uid) | immutable; the sole admin in v1 |
| `createdAt` | Timestamp | |

### `groups/{groupId}/members/{userId}` (subcollection)

| field | type | notes |
|---|---|---|
| `role` | `'admin' \| 'member'` | exactly one admin per group in v1: the creator |
| `joinedAt` | Timestamp | |

**Cheap hook for future leave/remove-member** (product spec open question
#1, unresolved — don't build now): the rule for this doc already has
`allow delete: if false` and `allow update: if false` sitting ready to flip
to `if isMember(groupId) && (request.auth.uid == memberId || isGroupAdmin(groupId))`
for delete, or add a `status: 'active' | 'left'` field for update. The
leaderboard aggregation function (§4) takes a `members` list as a plain
argument and is written to tolerate a member with no bets and to skip a
member not present in the list at all — so removing or leaving doesn't
require touching the scoring/leaderboard code later, only the membership
doc and how the caller builds that list.

### `competitions/{competitionId}`
Global, not per-group. Seeded once via the Admin SDK; never written by a
client (`allow write: if false` in rules).

| field | type | notes |
|---|---|---|
| `name` | string | e.g. "World Cup 2026", "Israeli Premier League" |

### `fixtures/{fixtureId}` — **top-level collection, not a subcollection**

**DECIDE: top-level `fixtures/{fixtureId}` with a `competitionId` field**,
not `competitions/{competitionId}/fixtures/{fixtureId}`. Justification: the
bet document only carries `fixtureId` (not `competitionId`), and the bet's
security rule needs `get(/fixtures/$(fixtureId))` — a direct, single-segment
path lookup. If fixtures were nested under competitions, that `get()` would
need the competitionId too, forcing it onto every bet document purely so
rules could build a path — pure denormalization overhead with no query
benefit, since the only fixture query in the app (`where competitionId ==
X`) is a single-field equality filter that Firestore auto-indexes at the
top level exactly as well as it would within a subcollection.

| field | type | notes |
|---|---|---|
| `competitionId` | string | |
| `homeTeam` | string | |
| `awayTeam` | string | |
| `kickoffAt` | Timestamp | immutable once created — see below |
| `status` | `'SCHEDULED' \| 'FINISHED'` | |
| `homeScore` | int \| null | null until FINISHED |
| `awayScore` | int \| null | null until FINISHED |
| `externalRef` | string \| null | for a future real fixture-data provider; unused in v1 |

**DECIDE: score-entry authorization.** Fixtures are shared across every
group running that competition. Simplest-for-friends-scale rule: **any
group-admin of ANY group on that competition may correct the shared fixture
score.** Justification: v1 has exactly one admin per group (the creator, no
promote/add-admin flow), there's no money on the line, and requiring
per-fixture ownership by "the" group would be meaningless anyway since the
fixture and its result are objectively shared, real-world facts, not
opinions — any admin correcting a typo'd score benefits every group on that
competition equally. **Accepted risk**: an admin of Group A can correct a
score that also affects Group B's leaderboard, without Group B's admin's
involvement. At friends-scale this is a feature (one person can fix an
obvious typo without waiting on someone else) not a threat — there's no
incentive to grief a shared, objective sports score when there's no money
riding on it, and every group member can see the fixture change immediately
(reads are public to all signed-in users).

**Security-critical detail, called out for the security-engineer review**:
the update rule pins `competitionId`, `homeTeam`, `awayTeam`, `kickoffAt`,
and `externalRef` as immutable — **only `status`/`homeScore`/`awayScore` may
change**. Without this, a competition-admin could edit `kickoffAt` itself
and retroactively unlock everyone's bets before the real kickoff (breaking
the hidden-until-kickoff guarantee) or relock a fixture after they'd already
seen others' bets. This is the single most important line in `fixtures`'
rules — verify it explicitly in review.

### `joinCodes/{code}`
Top-level lookup collection, doc ID **is** the code itself.

| field | type | notes |
|---|---|---|
| `groupId` | string | |
| `createdBy` | string (uid) | |
| `createdAt` | Timestamp | |

**Code generation**: 6 chars, uppercase alphanumeric, excluding visually
ambiguous characters (`0/O`, `1/I/L`) — ~30-symbol alphabet, ~700M possible
codes. Generated client-side at group-creation time.

**Collision handling**: no server, so no way to check-then-reserve
atomically ahead of time. Instead: the client attempts to `create` (not
`set`-with-merge) the `joinCodes/{code}` doc as part of the group-creation
batch (see below). If the code already exists, Firestore rules see this as
an **update** to an existing immutable doc (`allow update: if false`), so
the whole batch fails with a permission-denied error. The client catches
that specific failure, generates a new random code, and retries the whole
batch (cap at ~5 attempts). At this address-space size and friends-scale
group-creation rate, a real collision is astronomically unlikely; the retry
loop exists for correctness, not because it'll realistically fire.

**Uniqueness enforcement without a server**: exactly the mechanism above —
`allow create` for a legitimate code, `allow update: if false` forever after,
which Firestore's create-vs-update semantics turn into "first writer wins,
everyone else gets denied."

### `competitionAdmins/{competitionId_userId}`
Denormalized authorization grant — **not** a product-facing concept, exists
purely so the `fixtures` update rule can do an O(1) `exists()` check instead
of an impossible "find any group where I'm admin, on this competition"
query (Firestore rules cannot express arbitrary queries, only direct
document path checks).

| field | type | notes |
|---|---|---|
| `competitionId` | string | first half of the doc ID |
| `userId` | string (uid) | second half of the doc ID |
| `groupId` | string | which group creation produced this grant (for rule cross-checks and debugging) |
| `grantedAt` | Timestamp | |

**Accepted risk, flagged for later**: because v1 has no "leave group" or
"promote another admin" flow, this grant is created once at group creation
and **never revoked**. If a later release adds group deletion or admin
demotion, a stale `competitionAdmins` grant would let a former admin keep
editing that competition's fixtures. Not a v1 problem (nothing revokes
admin-ness yet), but flag it the moment leave/remove (open question #1) gets
built — the fix is a corresponding delete of this doc, not a rules change.

### `groups/{groupId}/bets/{betId}` — **subcollection, composite doc ID**

**DECIDE: `groups/{groupId}/bets/{betId}` with `betId = "${userId}_${fixtureId}"`**,
not nested under `members/{userId}/bets/{fixtureId}`. Justification: the
group's "finished fixture" view needs "every member's bet for fixture X" —
a flat `bets` collection scoped by the natural `groupId` parent supports
`where fixtureId == X` directly. Nesting bets under each member's
subcollection would require a `collectionGroup` query to get the same
answer, which is both slower to reason about and messier to write rules for
(a collection-group query's security rule has to independently verify group
membership for every subcollection instance it might match, since the rule
can't rely on the specific parent path the way a direct subcollection
under `groups/{groupId}` can). The composite ID also gives a second win for
free: "get my own bet for fixture X" is a direct-path `get()`, no query at
all.

| field | type | notes |
|---|---|---|
| `userId` | string (uid) | must equal the first half of `betId` and the doc's own writer |
| `fixtureId` | string | must equal the second half of `betId`; immutable after creation |
| `predictedHome` | int, >= 0 | |
| `predictedAway` | int, >= 0 | |
| `updatedAt` | Timestamp | must equal `request.time` on every write (rules-enforced, prevents client clock spoofing) |

This is the crux of the whole rules design — see §3 for the exact rule
snippets and how each of the four requirements (own-bet-only write, lock at
kickoff, owner-always-reads-own, others-read-only-post-kickoff,
membership-gated) is enforced.

## 3. Security rules — the authorization boundary

The full file is committed at `firestore.rules` (repo root). This section
explains the parts that need explaining; treat the committed file as the
source of truth, not this prose.

### Why `getAfter()`, and why it's safe to rely on

**Verified directly against Firebase's own documentation before locking
this in** (this was the single load-bearing assumption the whole
atomic-group-creation design depends on): Firestore security rules'
`get()`/`exists()` only see the database's state as of the *start* of a
batch/transaction — they do **not** see sibling writes in the same
batch. That would make "group + admin-membership + joinCode +
competitionAdmins, all created together, each validated against the
others" impossible with `get()` alone. Firebase's docs for exactly this
situation point to `getAfter()`: it reads a document's state *after* the
whole batch/transaction would commit, specifically so rules can validate
multi-document atomic writes against each other. (Confirmed via Firebase's
"Writing conditions for Cloud Firestore Security Rules" doc:
https://firebase.google.com/docs/firestore/security/rules-conditions and
"Transactions and batched writes":
https://firebase.google.com/docs/firestore/manage-data/transactions.) The
rules file uses `getAfter()` for exactly this — e.g. the `joinCodes/{code}`
create rule checks `getAfter(/groups/$(groupId)).data.createdBy ==
request.auth.uid`, which resolves correctly even though the group doc is
being created in the very same batch. Document limit note: batched/
transactional rule evaluation allows 20 document accesses total (vs. 10 per
single document) — our create batch touches 4 documents with 1-2 accesses
each, comfortably under that.

**Client contract this creates**: creating a group is **one atomic batch
write** of four documents — `groups/{groupId}`, its own
`groups/{groupId}/members/{uid}` (role: admin), `joinCodes/{code}`, and
`competitionAdmins/{competitionId}_{uid}` — or none of them. Never write
these individually. `frontend-developer` implementing "Create group" must
use `writeBatch()` (or `runTransaction()`) with all four `set()` calls
before a single `commit()`.

### Bet rules — the four requirements, as committed

```
match /bets/{betId} {
  allow read: if isMember(groupId) && (
    resource.data.userId == request.auth.uid ||
    isLocked(resource.data.fixtureId)
  );

  allow create: if isMember(groupId)
    && request.resource.data.userId == request.auth.uid
    && betId == request.resource.data.userId + '_' + request.resource.data.fixtureId
    && ... (type checks) ...
    && !isLocked(request.resource.data.fixtureId);

  allow update: if isMember(groupId)
    && resource.data.userId == request.auth.uid
    && request.resource.data.userId == resource.data.userId
    && request.resource.data.fixtureId == resource.data.fixtureId
    && ... (type checks) ...
    && !isLocked(resource.data.fixtureId);

  allow delete: if false;
}
```

- **(a) only the bet's own user can write it**: `request.resource.data.userId
  == request.auth.uid` on create, plus `resource.data.userId ==
  request.auth.uid` on update (checks the *existing* doc's owner, so you
  can't "adopt" someone else's bet doc by writing over it).
- **(b) writes rejected at/after kickoff**: `!isLocked(fixtureId)`, where
  `isLocked(fixtureId)` is `request.time >= fixtureOf(fixtureId).kickoffAt`
  — a `get()` on the fixture doc from inside the bet rule, per the brief.
- **(c) reads**: owner always reads their own
  (`resource.data.userId == request.auth.uid`); everyone else only once
  `isLocked(fixtureId)` is true. Both are the same `allow read` line, just
  the two arms of the `||`.
- **(d) membership-gated**: every one of the four rules starts with
  `isMember(groupId)`, itself an `exists()` check on
  `groups/{groupId}/members/{request.auth.uid}`.

### Join-by-code — the one deliberately "loose" rule, and why it's fine

The `members/{memberId}` create rule's "join as member" arm has **no
explicit code-redemption check**:

```
|| (request.resource.data.role == 'member'
  && exists(/databases/$(database)/documents/groups/$(groupId)))
```

This looks like it lets anyone self-appoint as a member of any group they
can name. In practice they can't name one: `groupId` is a Firestore
auto-generated ~20-character random ID, not enumerable, not guessable, and
`groups/{groupId}` reads require membership — so the *only* realistic way a
non-member learns a real `groupId` is by resolving a `joinCodes/{code}` doc
(which does require signed-in-but-not-yet-a-member read access, by design —
that's the whole point of the join flow). Requiring the code again at the
membership-write step would be redundant, not more secure: the code's job
was to disclose the groupId, and it already did that at the read step.
**Accepted risk, flagged for the security-engineer review explicitly**: a
signed-in user who brute-forces or is leaked a valid 6-character code (or a
`groupId` directly, out of band — e.g. someone pastes a raw Firestore
console link) can join uninvited. At friends-scale, no-money, this is
equivalent to someone using a leaked Discord invite link — an accepted,
documented risk, not an oversight.

## 4. Scoring engine (`packages/shared/src/scoring/`)

Pure functions, zero Firebase/Firestore imports, so they run identically in
the Expo app (React Native/Hermes) and in plain Node for unit tests.

```ts
type FixtureResult =
  | { status: 'SCHEDULED' }
  | { status: 'FINISHED'; homeScore: number; awayScore: number };

type BetPrediction = { predictedHome: number; predictedAway: number } | null; // null = no bet placed

interface ScoreResult {
  points: 0 | 1 | 3;
  isExact: boolean;      // true only on a 3-point (exact score) result
  isDirection: boolean;  // true only on a 1-point (right direction, wrong score) result
  // isExact and isDirection are mutually exclusive by construction.
}

function scoreForBet(bet: BetPrediction, fixture: FixtureResult): ScoreResult
```

**DECIDE: `isExact` and `isDirection` are mutually exclusive buckets**, not
"isDirection also true whenever isExact is true." Justification: the
leaderboard's three columns are total points, exact-hit count,
correct-direction count (product spec §3) — read naturally, these are meant
to be the two point-earning *tiers* (3-pt bucket size and 1-pt bucket size),
so exact + direction + wrong + no-bet sums to "fixtures finished so far"
for that member. If exact scores also counted toward the direction column,
the columns wouldn't sum to anything meaningful and a player scanning the
row would double-count their best fixtures.

- No result yet (`status: 'SCHEDULED'`, or `homeScore`/`awayScore` not both
  present): `{ points: 0, isExact: false, isDirection: false }` — "points
  exist only once a final score is entered" (product spec §4).
- `bet === null` (no bet placed): same zero result.
- Exact match: `points: 3`.
- Direction match only (draw counts as a direction — a 1-1 prediction on a
  2-2 result scores 1, not 0): `points: 1`.
- Wrong direction: `points: 0`.

```ts
interface MemberStanding {
  userId: string;
  totalPoints: number;
  exactCount: number;
  directionCount: number;
  joinedAt: Timestamp; // from the membership doc, for tie-break only
}

function computeLeaderboard(
  members: { userId: string; joinedAt: Timestamp }[],
  bets: { userId: string; fixtureId: string; predictedHome: number; predictedAway: number }[],
  fixtures: { fixtureId: string; status: 'SCHEDULED' | 'FINISHED'; homeScore: number | null; awayScore: number | null }[]
): MemberStanding[]
```

- For each member, for each `FINISHED` fixture, look up that member's bet
  (or `null` if absent) and call `scoreForBet`; accumulate `totalPoints`,
  `exactCount`, `directionCount`.
- **Tie-break, exactly per product spec §3**: `totalPoints` desc, then
  `exactCount` desc, then `directionCount` desc, then `joinedAt` asc
  (earliest joined ranks higher on a full tie).
- **Tolerates a member absent from later data** (the cheap hook from §2):
  the function only ever iterates the `members` array it's given — a caller
  that later filters out `status: 'left'` members, or that's missing a
  member document entirely, doesn't break this function; it just produces a
  standings list without that row. No leave/remove logic needs to live
  here.
- Runs entirely **client-side**, once per screen render/refresh, over data
  the client can already read post-kickoff (bets become readable to all
  members once locked — see §3). This is the same "leaderboard computed on
  read, never stored" decision from the product spec, just moved from
  "server computes on API read" to "client computes on Firestore read" —
  identical semantics, no functional change from what was already decided.

## 5. Emulator + local dev setup

**Ports** — checked against BinyaniApp's dev setup first (Next.js web on
`3000`, PGlite Postgres wire-protocol server on `54329`; no Firebase
emulator use there at all). No collision with any Firebase default, so
these are the stock defaults, kept for minimal surprise with the wider
Firebase tooling ecosystem:

| Emulator | Port |
|---|---|
| Firestore | `8080` |
| Auth | `9099` |
| Emulator UI | `4000` |

(`firebase.json`, committed at repo root, wires these up plus
`singleProjectMode: true` so a single placeholder project ID covers every
emulator.)

**No composite Firestore indexes needed for v1** — every query
(`fixtures where competitionId == X`, `bets where fixtureId == X` within a
group) is a single-field equality filter, which Firestore auto-indexes. No
`firestore.indexes.json` committed; add one if a future feature needs a
compound query.

**`.firebaserc`** (committed): `{ "projects": { "default":
"goalmates-dev-placeholder" } }`. This placeholder ID is never used to
reach real GCP — the emulator suite runs fully offline against it. Founder
action for later: once a real Firebase project exists, add a `"prod"` alias
here (or swap `"default"`) — no code changes required, purely this file.

**Seed script** (`scripts/seed-emulator.ts`, **not written in this PR** —
spec for T4):
- Uses the Firebase **Admin SDK** (bypasses security rules entirely —
  correct, since rules should never gate the seed script), pointed at the
  emulator via the standard `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` and
  `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` env vars (the Admin SDK
  auto-detects these; no credentials file needed against an emulator).
- Creates Auth emulator users (`admin.auth().createUser(...)`) for each
  seeded player, with a deterministic dev email (e.g.
  `alice@goalmates.dev`) and a fixed dev-only password — **this list is the
  single source of truth for the mobile app's dev-stub login picker** (see
  §6), so it must live in `packages/shared/src/seed/`, imported by both the
  script and the app.
- Writes matching `users/{uid}` profile docs.
- Writes 2 competitions: **WC2026** and **Israeli Premier League**.
- Writes ~12 WC2026 fixtures + ~6 Israeli league fixtures. Mix of
  `FINISHED` (with scores, so the leaderboard isn't empty on first run) and
  `SCHEDULED` — **including at least one or two SCHEDULED fixtures with
  `kickoffAt` only a few minutes in the future**, specifically so
  lock-behavior (bet acceptance right up to, then rejected at, kickoff) is
  manually testable without waiting for a real match.
- Writes 1 demo group (with a real join code, going through the same
  atomic batch shape the app will use — group + admin membership + joinCode
  + competitionAdmins grant) plus a few seeded bets across the demo users
  so the leaderboard has non-zero rows immediately.
- Because it uses the Admin SDK, it does not need to satisfy
  `firestore.rules` at all (rules don't apply to Admin SDK writes) — but the
  *shape* of every document it writes must still match §2's field lists
  exactly, since the app and the rules both assume that shape.

**Dev-run sequence**:
```bash
source "$NVM_DIR/nvm.sh" && nvm use
pnpm install

# terminal A — leave running
pnpm emulators          # firebase emulators:start (Firestore :8080, Auth :9099, UI :4000)

# terminal B — once, after the emulators in terminal A are up
pnpm seed               # scripts/seed-emulator.ts against the running emulators

# terminal B — then
pnpm dev:mobile         # pnpm --filter @goalmates/mobile start (Expo)
```

No real Firebase project, no account, no credentials file, at any step
above.

## 6. Auth

**Dev (emulator)**: Firebase Auth Emulator, email/password sign-in with the
seeded dev accounts from §5 — the emulator supports real
`signInWithEmailAndPassword` calls against fake, locally-created users, no
real OAuth client needed. This directly implements product-spec §3's
"Login (dev-stub user picker)": the picker UI lists the seeded users (from
`packages/shared/src/seed/`) and taps map to a real (emulator) sign-in call,
not a fake cookie — closer to production behavior than BinyaniApp's
unsigned-cookie dev provider, for free.

**Swappable-integration-stub, applied to the whole backend, not just
fixtures** (per standing rule 8 and the swap pattern already used in
BinyaniApp's `src/lib/auth/provider.ts` — reviewed as a reference for the
*pattern*, not the implementation): an `AuthProvider` interface in
`packages/shared/src/auth/` —

```ts
interface AuthProvider {
  getCurrentUser(): AuthUser | null;
  onAuthStateChanged(cb: (user: AuthUser | null) => void): Unsubscribe;
  signOut(): Promise<void>;
}
```

with two call-site-compatible implementations living in `apps/mobile`
(platform code, not `packages/shared`, since they wrap the Firebase JS SDK
directly):
- `EmulatorDevAuthProvider` — adds a dev-only `signInAsSeedUser(seedUserId)`
  method used by the picker screen, calling
  `signInWithEmailAndPassword(auth, seedUser.email, seedUser.devPassword)`
  against the emulator.
- `GoogleSignInAuthProvider` — real Google Sign-In, **not built in this
  PR** (needs founder-created Firebase project + OAuth client — flagged
  founder action for later, matching product-spec's open question #2 style
  flag, nothing new).

**The actual emulator-vs-real swap is pure config, zero app code changes**:
whether the Firebase JS SDK talks to the emulator or a real project is
decided entirely by (1) which config object (`apiKey`, `projectId`, etc.) is
passed to `initializeApp()`, driven by an env var like
`EXPO_PUBLIC_USE_FIREBASE_EMULATOR`, and (2) whether `connectFirestoreEmulator()`
/ `connectAuthEmulator()` are called after init. Every `AuthProvider` call
site, every Firestore read/write in the app, is identical either way — this
is the "swappable interface" from standing rule 8 applied at the SDK-config
layer, which is a stronger guarantee than wrapping each provider
individually. **Founder action for later, not part of this build**: create
the real Firebase project, enable Google Sign-In in the Firebase console,
and provide the real config values.

## 7. Testing & CI plan

**Rules tests** (`@firebase/rules-unit-testing`, in
`packages/shared/src/firestore-rules/*.test.ts`, run only against the
emulator — never against production, there is no production project to
accidentally hit):

- Non-member cannot read or write any group-scoped data (group doc,
  members, bets).
- A member can always read their own bet, pre- and post-kickoff.
- A member cannot read another member's bet pre-kickoff.
- A member CAN read another member's bet post-kickoff (once
  `request.time >= fixture.kickoffAt`).
- A bet write (create or update) is rejected at/after kickoff.
- Only a `competitionAdmins` grant holder can write a fixture's
  `status`/`homeScore`/`awayScore`; a non-admin's attempt is denied; an
  attempt to change `kickoffAt` (even by a legitimate grant holder) is
  denied.
- `joinCodes`/`groups`/`members`/`competitionAdmins` creation is atomic:
  a batch that's missing any one of the four documents fails entirely (test
  this by attempting each document individually, outside a batch, and
  confirming each one alone is denied by its `getAfter()` cross-check).
- A second `create` attempt at an existing `joinCodes/{code}` is denied
  (collision-handling correctness).

**Run pattern, no real Firebase project required**:
```bash
firebase emulators:exec --only firestore,auth "pnpm --filter @goalmates/shared run test:rules"
```
`emulators:exec` starts the emulators, runs the given command, then tears
the emulators down — no `firebase login`, no real project, safe to run in
GitHub Actions exactly as-is.

**CI update — for whoever wires this in (T4)**, added as a **new step** to
`.github/workflows/ci.yml` (not written in this PR — the referenced
packages/scripts don't exist yet on this branch, so adding the step now
would reference nonexistent commands):

```yaml
      - run: pnpm exec firebase emulators:exec --only firestore,auth "pnpm --filter @goalmates/shared run test:rules"
```
placed after the existing `pnpm test` step. Needs `firebase-tools` as a
root devDependency (already noted in §1) — no `firebase login` and no
`GOOGLE_APPLICATION_CREDENTIALS` secret required for emulator-only use, so
this adds zero new CI secrets.

Everything above needs the founder for is already flagged in §1 and §6
(root `package.json` scripts, the CI step itself, real Google Sign-In
credentials) — nothing new beyond those.

## 8. Fixture sync

Fixture data (times, teams, reschedules, and eventually real scores) needs
to be kept current without a server to run a cron job inside — v1 has no
server and no Cloud Functions at all (§0). The mechanism: a **GitHub
Actions scheduled workflow** (`.github/workflows/fixture-sync.yml`) running
a Node script (`scripts/sync-fixtures.ts`) that writes into Firestore via
the Admin SDK, on the same rules-bypass path `scripts/seed-emulator.ts`
already uses.

**Why GitHub Actions cron instead of Cloud Functions**: Cloud Functions'
scheduler (Cloud Scheduler + Pub/Sub trigger) requires the paid Blaze plan
— exactly the cost §0 designed around avoiding. A GitHub Actions scheduled
workflow needs no Firebase plan upgrade at all; it's a plain script run on
a timer, authenticating to Firestore the same way the seed script does.

**The interface boundary**: `packages/shared/src/fixtures/` defines
`FixtureSyncProvider` (one method, `syncFixtures(competitionId):
Promise<FixtureUpdate[]>`) and ships one implementation,
`StubFixtureSyncProvider`, which re-applies the existing seed fixture data
(`packages/shared/src/seed/data.ts`) instead of calling a real API — there
is no real fixture-data API key yet (creating a football-data.org, or
equivalent, account is a separate founder action, not part of this build).
This is the same swappable-integration-stub pattern already used for
`AuthProvider` (§6): `scripts/sync-fixtures.ts` only ever depends on the
`FixtureSyncProvider` interface, so swapping the stub for a real provider
is a one-line change at its construction site, not a call-site rewrite.

**Founder action for later, to swap in the real provider**:
1. Create a football-data.org (or equivalent) account and get an API key.
2. Add it as the `FIXTURE_API_KEY` repo secret.
3. Add the `FIREBASE_SERVICE_ACCOUNT` repo secret (see below).
4. Implement `RealFixtureSyncProvider` in
   `packages/shared/src/fixtures/`, reading its key from the
   `FIXTURE_API_KEY` env var, and swap it in at
   `scripts/sync-fixtures.ts`'s `new StubFixtureSyncProvider()` call site
   — marked there and in `stub-provider.ts` with a
   `// TODO(founder): swap in RealFixtureSyncProvider once API key exists`
   comment.

**Idempotency guarantee** (this script runs every 30-60 min forever, so it
must be safe to run repeatedly): for each fixture the provider reports,
`scripts/sync-fixtures.ts`'s `applyFixtureUpdate`:
- Creates the Firestore doc if it doesn't exist yet.
- **Never touches a fixture once its `status` is `FINISHED`** — a finished
  fixture's score is treated as a fixed point once set, whether it got
  there via the seed script, a prior sync, or a group-admin's manual
  in-app correction. This is what protects final scores from being
  clobbered by a stale re-sync.
- For a still-`SCHEDULED` fixture, only writes fields that actually
  differ from what's stored, and deliberately excludes `kickoffAt` from
  this comparison for the stub specifically — `StubFixtureSyncProvider`
  recomputes `kickoffAt` relative to "now" on every call (same
  offset-from-now trick the seed data already uses), so writing it back
  every run would look like a reschedule on every single run. A
  `RealFixtureSyncProvider` reporting a genuine reschedule (an absolute
  wall-clock change from the real upstream source) should reinstate
  `kickoffAt` into that comparison.
- Net effect, verified manually against the Firestore emulator: seeding,
  then running the sync script twice back-to-back, produces byte-identical
  Firestore state after both runs (0 created/0 updated the second time),
  and a manually-corrected `FINISHED` score survives a subsequent sync
  unchanged.

**Emulator-vs-real-project conditional**: there is no real Firebase
project yet, so `.github/workflows/fixture-sync.yml`'s real-project step
is gated on `secrets.FIREBASE_SERVICE_ACCOUNT != ''` — a GitHub Actions
secret reference is an empty string when the secret doesn't exist, so this
condition is always valid and the step is skipped entirely right now. **No
GitHub secret is required for this workflow, or its CI, to pass.** The
default path instead runs the sync script against a throwaway Firestore
emulator instance spun up and torn down inside the job itself, via
`firebase emulators:exec` (the exact pattern `ci.yml`'s rules-test step
already uses) — seeding first, then running the sync script twice, so the
workflow is fully green and meaningfully exercises both fixture creation
and idempotency with zero real credentials. `scripts/sync-fixtures.ts`
itself decides emulator-vs-real by checking whether
`GOOGLE_APPLICATION_CREDENTIALS` is set (real mode) or not (emulator
mode, matching `scripts/seed-emulator.ts`'s existing `FIRESTORE_EMULATOR_HOST`
default). The moment the founder adds the `FIREBASE_SERVICE_ACCOUNT`
secret, the real-project step activates with no other code change.

**Cron interval — every 60 minutes** (`0 * * * *`): picked over the tighter
end of the 30-60 min range because this repo is **private**, so GitHub
Actions minutes are not unlimited-free the way they are on a public repo —
they draw down the account's monthly free-tier minutes. Hourly is still
fresh enough for a friends' hobby app, and roughly halves the CI-minutes
footprint of the emulator-validated default path above versus a 30-minute
cadence. Worth revisiting once the real-project path is active, since a
real sync run has no JVM/emulator startup cost and is much cheaper per
run.

**Open question, deliberately not resolved here** (tracked in
`docs/product-spec-v1.md`'s "Open questions (founder)"): if a fixture's
kickoff time changes (a reschedule) after group members have already
placed bets on it, should their existing bets be kept as-is, or should
members be warned/notified?
