# GoalMates — Product Spec v1

For-fun soccer prediction league for the founder and their friends. Points only. Mobile-only client (iPhone + Android via Expo/React Native); the app talks directly to Firebase (Firestore + Firebase Auth) — no custom API server, no web pages.

## 1. What GoalMates is / is not

**Is:** a private prediction game. Friends form a group around one real competition (e.g. World Cup 2026, Israeli Premier League), predict fixture scores before kickoff, and compete on a points leaderboard.

**Is NOT (v1 non-goals):**
- No real money, no odds, no payouts — not a bookmaker product in any form.
- No pro/commercial features (public leagues, sponsorships, monetization).
- No per-group scoring configuration — scoring rules are fixed (see §4).
- No push notifications.
- No real fixture-data API — fixtures come from a seeded stub (flagged founder action for later).
- No real Google Sign-In yet — v1 uses Firebase Auth via the local Emulator Suite with seeded test users for local dev. Enabling real Google Sign-In is a founder action (creating the Firebase project) and drops in as pure config, no code changes.

## 2. Users & roles

- **Player**: joins groups via a join code, places/edits bets, views fixtures and leaderboards.
- **Group admin** (the group's creator): everything a player can do, plus manage the group and enter/correct final scores on fixtures.

Decisions (PM default unless noted):
- A user can belong to multiple groups — yes.
- A group admin can also bet — yes; score entry is data entry, not judging (all bets are locked and visible by then).
- One group ↔ one competition, chosen at creation, not changeable after (PM default: keeps model simple; create a new group for a new competition).
- Score correction: leaderboard and per-bet points are **computed on read** from the current final score, so a correction recomputes everyone's points automatically. No manual recompute step.
- Join code: short, human-shareable (e.g. 6 chars), non-guessable enough for friends-scale; no expiry in v1 (PM default).

## 3. Screens & flows (mobile)

**Login (Firebase Auth, emulator-backed in dev)**
- Purpose: sign in via Firebase Auth; in dev this is emulator-backed (e.g. sign-in with seeded test accounts, or anonymous auth for local testing).
- Elements: sign-in action (seeded test account or anonymous, per emulator setup); tap to enter.
- Swappable to real Google Sign-In later purely via Firebase project config — no other screens change.

**Home / groups list**
- Purpose: entry point; all my groups.
- Elements: group cards (name, competition); actions: Create group, Join group.
- Edge: no groups yet → empty state with the two actions front and center.

**Create group**
- Purpose: start a group.
- Flow: enter group name → pick competition from list (seeded) → group created, I'm admin → show share/join code with a share/copy action.

**Join group**
- Purpose: join a friend's group.
- Flow: enter join code → confirm → land in the group.
- Edge: invalid code → clear error; already a member → just open the group.

**Group view — Fixtures tab**
- Purpose: see fixtures and bet.
- *Upcoming*: fixture (teams, kickoff time) + my bet entry/edit (home/away score) until kickoff. Locked at/after kickoff: bet shown read-only, marked locked. Others' bets hidden pre-kickoff (only "has bet / no bet" indicator — PM default).
- *Finished*: final score + every member's bet + points each earned on that fixture.
- Edge: no bet placed and kickoff passed → shows "no bet, 0 pts"; no fixtures finished yet → empty state.

**Group view — Leaderboard tab**
- Purpose: classic prediction-league table.
- Columns per member, ranked: total points, exact-hit count, correct-direction count. No "reverse/wrong" column.
- Tie-break: total points, then exact hits, then correct directions, then joined-earliest (PM default).
- Edge: no finished fixtures yet → all zeros, members listed.

**Admin: enter/correct final score** (admin-only, on a fixture)
- Purpose: record or fix a result (v1 substitute for a results API).
- Flow: pick fixture (at/after kickoff) → enter home/away final score → save. Editable again later to correct; points recompute automatically (§4).

## 4. Scoring rules (fixed, not configurable)

Per finished fixture, per member:
- **Exact score** (predicted home & away both match final): **3 pts**.
- **Correct direction** only (predicted outcome — home win / draw / away win — matches final, but score differs): **1 pt**. Note: a draw prediction (e.g. 1–1) on a drawn fixture (e.g. 2–2) earns 1 pt — draw is a direction.
- **Wrong direction**: 0 pts. **No bet**: 0 pts.
- Points exist only once a final score is entered. Points and leaderboard are computed on read from current data; if the admin corrects a final score, all points update automatically — no stale stored totals.

## 5. Bet lifecycle & rules

| Phase | Rule |
|---|---|
| Before kickoff | One bet per user per fixture: predicted home + away score (non-negative integers). Create/edit freely. |
| Lock | At kickoff, per **Firestore server time** — Firestore security rules reject create/edit at/after kickoff regardless of client time or UI state. |
| Visibility | My bet hidden from other group members until kickoff (enforced by Firestore security rules, not just UI); visible to everyone after. |
| After kickoff, no result yet | Bet read-only, all group bets visible, no points yet. |
| Result entered | Points per §4 shown on the fixture and in the leaderboard. |
| Result corrected | Points recompute automatically for all members. |
| No bet | 0 points for that fixture. |

## 6. Acceptance criteria (QA checklist)

- [ ] Login: can sign in via Firebase Auth Emulator with a seeded test account; swapping to real Google Sign-In later is a config-only change (no code changes).
- [ ] Create group: pick competition, receive shareable join code; creator is admin.
- [ ] Join by code works; invalid code gives a clear error; a user can be in multiple groups.
- [ ] Bet create/edit before kickoff succeeds; attempt at/after kickoff is rejected **by Firestore security rules** (server time), even if the UI would allow it.
- [ ] Pre-kickoff, Firestore reads for member A never return member B's bet values for that fixture; post-kickoff they do.
- [ ] Scoring: exact → 3; direction-only (incl. draw-vs-different-draw) → 1; wrong → 0; no bet → 0. Verified against seeded fixtures.
- [ ] Admin (only) can enter a final score and later correct it; leaderboard and per-fixture points reflect the correction with no manual step.
- [ ] Leaderboard shows exactly: total points, exact hits, correct directions — ranked with the §3 tie-break.
- [ ] Empty states render: no groups, no bets, no finished fixtures.
- [ ] Runs fully locally (stub fixtures + Firebase Auth Emulator); nothing requires a cloud account or paid service.

## Open questions (founder)

1. Can members leave a group / can the admin remove a member in v1, and what happens to their leaderboard row? (PM lean: allow leave, keep row grayed out — but confirm before building.)
2. Real fixture-data API selection and account signup — founder action, post-v1.
