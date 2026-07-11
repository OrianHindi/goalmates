# Architecture v1 Amendment — Automatic live scores

Status: **design + schema/rules landed; sync-script provider and mobile UI are
follow-up tasks.** Amends `architecture-v1.md` (§2, §4, §8) and
`architecture-v1-amendment-multicompetition.md`; does not replace them.
Everything not mentioned here is unchanged.

Founder-approved goal: **fully automatic score updates, including while a match
is being played, with zero manual entry required.** The existing admin
score-entry screen stays as a fallback/override, not the primary path.

Required reading first: `architecture-v1.md` §2 (fixture model), §4 (scoring),
§8 (fixture sync), and the multi-competition amendment.

---

## Phase 1 verdict (research) — READ FIRST

**Genuine free-tier live in-play score data IS available — from API-Football
(api-sports.io) — but the binding constraint is a hard 100 requests/day on the
free tier.** That single number, not the update frequency, is what the whole
sync design below is built around. The two other obvious free candidates do
**not** offer live in-play data for free and were rejected for this goal.

All three were checked against their current (mid-2026) docs/pricing, not
training-data assumptions:

| Provider | Free-tier live in-play? | Free rate limits | WC 2026 | Israeli Ligat HaAl | Notes |
|---|---|---|---|---|---|
| **API-Football / api-sports.io** | **YES** — `fixtures?live=all`, updated **~every 15 s** during a match | **100 requests/day** (resets 00:00 UTC); per-minute limit never approached at our cadence | Yes — `league=1&season=2026` | Yes — `league=73` (Ligat HaAl) | All endpoints + all competitions on every plan; only *historical seasons* are restricted on free. Free key, no credit card. |
| football-data.org | **NO** — free scores are **delayed, not real-time**; live needs the paid livescores add-on | 10 req/min | Yes (free tier includes the World Cup) | No (free tier = 12 named competitions, Israel not among them) | Fine for schedules/next-day results only. |
| TheSportsDB | **NO on free** — livescores are a **Premium ($9/mo) V2** feature (2-min livescores) | ~30 req/min (test key) / ~100 req/min (personal) | Yes (schedule/results) | Yes (`4644`, schedule/results) | Great free *reference/schedule* data; no free live. |

**Chosen provider: API-Football (api-sports.io).** Why it's the best (and only
viable) option: it's the *only* free tier that actually returns in-play scores,
its coverage includes both competitions GoalMates seeds (World Cup 2026 and the
Israeli Premier League), and the same free key exposes every endpoint. The
honest caveat, surfaced to the founder rather than smoothed over: **100
requests/day is genuinely tight on a heavy World Cup matchday** (see §4's
budget). The design fits inside it with ~40% headroom by (a) only ever calling
the API when a match is actually live, and (b) using the single `live=all`
endpoint that returns *all* concurrent live matches in **one** request. If the
founder later wants sub-15-second freshness or a safety margin for a day with
many overlapping matches, the first paid tier (higher daily cap) is the lever —
flagged as a founder decision, not silently assumed.

Sources checked:
- API-Football pricing / free plan (100 req/day, resets 00:00 UTC, all
  competitions/endpoints on all plans): <https://www.api-football.com/pricing>,
  <https://www.api-football.com/news/post/how-ratelimit-works>
- API-Football live endpoint (`fixtures?live=all`, updated every 15 s):
  <https://api-sports.io/documentation/football/v3>
- API-Football World Cup 2026 (`league=1&season=2026`):
  <https://www.api-football.com/news/post/fifa-world-cup-2026-guide-to-using-data-with-api-sports>,
  <https://www.api-football.com/coverage>
- Ligat HaAl = `league=73`: <https://api-sports.io/sports/football>
- football-data.org free tier (delayed scores, 10 req/min, 12 competitions):
  <https://www.football-data.org/pricing>,
  <https://docs.football-data.org/general/v4/policies.html>
- TheSportsDB (livescores are Premium/V2 only):
  <https://www.thesportsdb.com/free_sports_api>,
  <https://www.thesportsdb.com/pricing>
- GitHub Actions minutes, public vs private (see §4):
  <https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions>

---

## 1. Provider chosen

API-Football (api-sports.io), free tier, as above. Verified free-tier facts:
100 requests/day (hard cap, resets 00:00 UTC); `fixtures?live=all` returns every
in-progress match in one call, refreshed ~every 15 s; World Cup 2026 and Ligat
HaAl both covered; no credit card for the free key. It stays behind the existing
`FixtureSyncProvider` boundary (§5), so no app or rules code depends on it
directly.

## 2. Fixture status model — add `LIVE`

`FixtureStatus` (`packages/shared/src/firestore/types.ts`) goes from
`'SCHEDULED' | 'FINISHED'` to **`'SCHEDULED' | 'LIVE' | 'FINISHED'`**.

Score-field semantics by status:

| status | `homeScore` / `awayScore` | who writes it, how often |
|---|---|---|
| `SCHEDULED` | both **null** | — (not kicked off) |
| `LIVE` | non-negative ints — the **running** score | sync job, **overwritten every poll** while the match plays |
| `FINISHED` | non-negative ints — the **final** result | sync job once at full-time; admin override thereafter |

The key design point is how a LIVE score relates to the existing
"FINISHED-is-a-fixed-point" model:

- **At the rules layer there is no immutability to weaken.** The committed
  `fixtures` update rule never froze a FINISHED score — it *always* let a
  `competitionAdmins` grant holder rewrite `status`/`homeScore`/`awayScore`.
  That permissiveness is deliberate: it's exactly what makes the manual admin
  override (`submitFinalScore`) able to correct a wrong result. So a LIVE
  score being "freely updatable until FINISHED" needs **no new mutability
  mechanism** — the rule already permits score changes on any valid update.
- **The fixed-point lives in the sync SCRIPT, not the rules.**
  `scripts/sync-fixtures.ts`'s `applyFixtureUpdate` is what treats FINISHED as
  a never-touch-again point (so a stale re-sync can't clobber a final or a
  manual correction). LIVE simply is *not* that fixed point: for a LIVE
  fixture the script writes the running score on every poll, and allows the
  `LIVE -> FINISHED` transition. (This script change is a follow-up task — see
  §5.)
- **kickoffAt and all identity fields stay immutable across every status**,
  including the `SCHEDULED -> LIVE -> FINISHED` path. Untouched.

Scoring stays "points only at full-time." `computeLeaderboard`
(`packages/shared/src/scoring/`) already filters to `status === 'FINISHED'`, and
`toFixtureResult` maps any non-FINISHED status (now including LIVE) to a
no-result-yet 0-point outcome — so a live in-progress score **never** leaks into
standings before full-time. The only change made to the scoring package is a
one-line widening of `LeaderboardFixture.status` to accept `'LIVE'`; no scoring
*logic* changed (verified: 9/9 scoring unit tests still pass).

## 3. Rules changes (`firestore.rules`)

**Verified against the committed rules file** that the client-facing risk
surface is narrow: `fixtures` has `allow create: if false` (seed script only,
Admin SDK) and `allow update` gated on `isCompetitionAdmin(...)`. Both the seed
script and the sync script write via the **Admin SDK, which bypasses rules
entirely**. So the *only* path these rules actually govern is the in-app manual
admin override. The rule's job for LIVE is therefore to **validate** the new
status value and score shape correctly, not to newly *permit* any client write.

The single `allow update` block changed as follows (landed in this PR):

- Status set: `in ['SCHEDULED', 'FINISHED']` → `in ['SCHEDULED', 'LIVE', 'FINISHED']`.
- Score shape re-keyed from "FINISHED vs. not" to "SCHEDULED vs. not":
  - `SCHEDULED` → both scores **must be null**.
  - `LIVE` **or** `FINISHED` → both scores are **non-negative ints**.
- All identity-field pins (`competitionId`, `homeTeam`, `awayTeam`,
  **`kickoffAt`**, `externalRef`) are byte-for-byte unchanged.

Transition direction is intentionally **not** constrained (an admin may move a
fixture between any statuses). This matches the existing design philosophy —
the admin override is trusted, friends-scale, no money — and preserves the
override's ability to fix a wrongly-FINISHED or wrongly-LIVE fixture. Enforcing
a forward-only state machine would fight that use-case for no security gain
(fixtures carry no money and are objective facts).

**Bets rules need zero changes** (confirmed against the committed file, same as
the multi-competition amendment's §6 finding): bet locking keys off
`isLocked(fixtureId) = request.time >= kickoffAt`, independent of `status`. A
LIVE fixture is by definition past kickoff, so its bets are already locked and
already publicly readable — LIVE changes nothing about bet privacy or locking.

Rules-unit-tests added (`fixtures.test.ts`), all passing: LIVE accepted with a
non-negative running score; LIVE score repeatedly mutable; LIVE with null scores
denied; LIVE with a negative score denied; non-admin denied a LIVE write;
kickoffAt still immutable on a `SCHEDULED -> LIVE` transition; FINISHED still
requires non-null int scores; an unknown status value denied. Suite: **49 → 57
passing** (fixtures file 6 → 14).

## 4. Schedule-aware sync design (follow-up workflow task)

GitHub Actions cron entries are static, so the workflow runs on a flat cadence
and makes itself *schedule-aware* by checking Firestore first and only spending
API quota when a match is genuinely live.

**Cadence: `*/10 * * * *` (every 10 minutes).** Each run:

1. **Firestore-only live-window check** (Admin SDK read — free, no external API):
   is any fixture in its live window `[kickoffAt, kickoffAt + 2.5 h]`? The 2.5 h
   buffer covers 90 min + half-time + generous stoppage, and extra time +
   penalties for knockout matches.
2. If **none** live → exit. Zero API calls. (This is the vast majority of runs.)
3. If something **is** live → **one** `fixtures?live=all` call (or
   `live={leagueIds}` to trim payload), which returns *all* concurrent live
   matches in a single request. Write each tracked fixture's running score with
   `status: 'LIVE'`. When a fixture that was LIVE drops out of the live feed,
   one targeted `fixtures?ids=...` call (batching ids) fetches its final score
   and sets `FINISHED`.

**API request budget (the binding 100/day constraint):**

- 10-min cadence during a live window = **6 requests/hour**.
- Typical day (one ~2.5 h window, e.g. an Israeli league match night): ~15 live
  polls + ~2 finish-confirmations + ~4 schedule refreshes ≈ **~21 req/day**.
- Worst case (a heavy World Cup matchday of near-continuous, overlapping
  matches spanning ~9 h): 6 × 9 = 54 live polls + ~3 finish-confirmations + ~4
  schedule refreshes ≈ **~61 req/day** — inside 100 with ~40% headroom.
- The per-minute free limit is irrelevant here: 6 req/hour never approaches it.

If a future World Cup day is busier than modeled, the mitigations (in order) are:
widen the cron to 15 min, drop schedule-refresh frequency, or move to the first
paid tier — a founder call, flagged, not silently assumed.

**GitHub Actions minutes math (verified terms):** GitHub's billing docs confirm
**standard GitHub-hosted runners are free and unlimited for public
repositories** (private repos get a monthly quota — 2,000 min/mo on the Free
plan — then pay per minute). The `goalmates` repo is now public specifically for
this.

- 10-min cadence = 144 runs/day ≈ **~4,380 runs/month**.
- A real-mode run (checkout + setup-node + cached `pnpm install` + short script)
  ≈ ~1–1.5 min → ~4,400–6,600 min/month.
- On the **public** repo: **$0, unlimited**.
- For contrast, that same load on a **private** Free-tier repo (2,000 min/mo)
  would be ~2.5–3× over the cap and would cost money — which is exactly why the
  public-repo decision is what unlocks this cadence.

**Workflow-shape note for the follow-up implementer:** the current
`fixture-sync.yml` default path boots a throwaway Firestore emulator (JVM,
~1–2 min) every run to prove idempotency with no real project. Booting that
144×/day is wasteful (still free, but pointless). Recommended: keep the frequent
10-min cron driving the **real-project** step; make the no-real-project path a
fast no-op exit; and keep the emulator idempotency dry-run on a low cadence (or
`push`/`workflow_dispatch` only). This is workflow implementation — out of scope
for this PR.

## 5. `FixtureSyncProvider` interface extension (follow-up)

**No method-signature change needed.** `syncFixtures(competitionId):
Promise<FixtureUpdate[]>` already returns `status` + `homeScore`/`awayScore` per
fixture; LIVE is simply a new `status` value carrying non-null in-progress
scores. The only type-level changes (a later provider task lands these in
`packages/shared/src/fixtures/types.ts`):

- `FixtureSyncStatus`: add `'LIVE'` (mirrors `FixtureStatus`).
- `FixtureUpdate.homeScore/awayScore` doc comments: non-null when LIVE (running)
  or FINISHED (final); null when SCHEDULED.

**Swappable-stub pattern preserved.** A `StubLiveFixtureSyncProvider` (or an
extension of the existing `StubFixtureSyncProvider`) can emit a synthetic LIVE
score — e.g. for a seed fixture whose kickoff offset places it inside the live
window, return `status: 'LIVE'` with an incrementing score that changes between
calls — so the mobile LIVE UI and the sync script's LIVE branch are fully
buildable and testable **with zero real API key**, exactly as today. The
`RealFixtureSyncProvider` (reading `FIXTURE_API_KEY`, calling API-Football) is
the founder-gated swap at the single construction site in
`scripts/sync-fixtures.ts`, unchanged from `architecture-v1.md` §8's plan.

`scripts/sync-fixtures.ts`'s `applyFixtureUpdate` will need a LIVE branch
(write the running score every poll; allow `LIVE -> FINISHED`; keep the
never-touch-FINISHED fixed point) — follow-up, not this PR.

## 6. Mobile UI implications (design only — separate task)

- **FixtureDetailScreen**: when `status === 'LIVE'`, show a **"LIVE" badge**
  (e.g. a pulsing red dot) and the **current score**, with a note that it
  updates on refresh / next poll. No betting affordance (the fixture is past
  kickoff → locked). Points are not shown for a LIVE fixture (points exist only
  at full-time).
- **GroupDetailScreen** currently buckets fixtures into SCHEDULED ("open") and
  FINISHED only — a LIVE fixture would fall through both filters and vanish. The
  follow-up must add a **"Live now"** grouping (or surface LIVE at the top of
  the list with a live badge). No typecheck break exists today (the `===`
  comparisons are still valid on the widened union); this is a behavior gap the
  UI task must close.
- Leaderboard: unaffected — LIVE contributes 0 points until FINISHED (§2).

## 7. Manual admin override stays

Unchanged and confirmed still working. `submitFinalScore`
(`apps/mobile/src/lib/fixtures.ts`) still writes `status: 'FINISHED'` +
scores, and the rules still permit a `competitionAdmins` grant holder to edit a
FINISHED fixture's score — because the rules never froze it (§3). So if the sync
job is temporarily wrong or the API is down, an admin can still correct or enter
a result by hand, exactly as before. **No admin-path rule or screen changes.**
The sync script's never-touch-FINISHED fixed point means a manual correction
survives subsequent syncs (unchanged from `architecture-v1.md` §8).
