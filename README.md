# GoalMates

GoalMates is a for-fun soccer prediction league for friends — points only, no real money. Players join groups with a join code, and each group runs competitions over real soccer fixtures. Before kickoff, every player places a score prediction (a "bet") on each fixture; bets lock at kickoff and stay hidden from the rest of the group until then. Scoring is simple: 3 points for the exact score, 1 point for the right direction (win/draw/lose), 0 for wrong. A leaderboard ranks the group by total points, with exact-hit count and correct-direction count as tiebreakers and bragging rights.

## Local dev quickstart

> Placeholder — apps land in upcoming PRs.

```bash
# Node version is pinned in .nvmrc; pnpm is the package manager
source "$NVM_DIR/nvm.sh" && nvm use
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```
