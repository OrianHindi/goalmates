// Metro config for a pnpm monorepo, solving the problem flagged (but left
// unsolved) in docs/architecture-v1.md's monorepo note: `@goalmates/shared`'s
// package.json `exports` point straight at `.ts` source, not a compiled
// `dist/`, so Metro needs (1) to see outside this app's own folder at all,
// (2) to follow pnpm's symlinked node_modules layout, and (3) to honor
// package.json "exports" so `@goalmates/shared/scoring` etc. resolve.
// Verified for real against `expo start --web` (see PR description) —
// this is not an assumed-safe config.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the whole workspace, not just this app folder, so Metro's file
// watcher (and therefore module resolution + Fast Refresh) notices
// packages/shared source files at all.
config.watchFolders = [workspaceRoot];

// pnpm hoists some deps to the workspace root's node_modules; look there
// too, in addition to this app's own node_modules.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// pnpm's node_modules entries are symlinks into its content-addressable
// store (.pnpm/...) -- Metro must follow them to reach packages/shared's
// real source files instead of treating the symlink as opaque.
config.resolver.unstable_enableSymlinks = true;

// @goalmates/shared's package.json "exports" map (./scoring, ./firestore,
// ./auth, ./seed, ./fixtures, all pointing at .ts source) must be honored
// by Metro's resolver, not just Node's own resolution algorithm.
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
