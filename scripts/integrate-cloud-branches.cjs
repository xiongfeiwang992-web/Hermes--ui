const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const git = (...args) => cp.execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const scratch = path.join(git('rev-parse', '--git-dir').trim(), 'codex-integration');
fs.mkdirSync(scratch, { recursive: true });
const recordFile = path.join(scratch, 'progress.json');
const record = fs.existsSync(recordFile) ? JSON.parse(fs.readFileSync(recordFile, 'utf8')) : { integrated: [], pending: null };
const save = () => fs.writeFileSync(recordFile, JSON.stringify(record, null, 2) + '\n');
const exclusions = new Set([
  'origin/cursor/setup-dev-environment-dbca',
  'origin/cursor/update-themes-4d89',
  'origin/cursor/realty-mvp-electron-5bdb',
  'origin/cursor/payment-method-dictionary-5bdb',
  'origin/cursor/desktop-shell-p2-5bdb',
]);

function finish(ref) {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const theirs = JSON.parse(git('show', `${ref}:package.json`));
  const base = JSON.parse(git('show', `${git('merge-base', 'origin/main', ref).trim()}:package.json`));
  for (const [name, value] of Object.entries(theirs.scripts)) {
    if (name === 'health' || value === base.scripts[name]) continue;
    if (pkg.scripts[name] && pkg.scripts[name] !== value && pkg.scripts[name] !== base.scripts[name]) {
      throw new Error(`Script conflict: ${name} in ${ref}`);
    }
    pkg.scripts[name] = value;
  }
  pkg.scripts.health = 'node scripts/health.cjs';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  git('add', 'package.json');
  const sha = git('rev-parse', ref).trim();
  if (git('diff', '--cached', '--name-only').trim()) {
    git('commit', '-m', `Integrate ${ref.replace('origin/cursor/', '')}`, '-m', `Source-Commit: ${sha}`);
  }
  record.integrated.push({ branch: ref, source: sha, commit: git('rev-parse', 'HEAD').trim(), title: git('log', '-1', '--format=%s', ref).trim() });
  record.pending = null;
  save();
}

if (record.pending) {
  const unresolved = git('diff', '--name-only', '--diff-filter=U').trim();
  if (unresolved) throw new Error(`Resolve and stage ${record.pending}:\n${unresolved}`);
  finish(record.pending);
}
const refs = git('for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin/cursor').trim().split('\n')
  .filter(ref => !exclusions.has(ref));
const priority = ref => /dictionary|password-max-age|community-units|hold-limit|system-settings|permission-matrix/.test(ref) ? 0 : /notify/.test(ref) ? 2 : 1;
refs.sort((a, b) => priority(a) - priority(b) || a.localeCompare(b));
for (const ref of refs) {
  if (record.integrated.some(item => item.branch === ref)) continue;
  const patch = cp.execFileSync('git', ['diff', '--binary', `origin/main...${ref}`, '--', '.', ':!docs', ':!README.md', ':!package.json'], { maxBuffer: 32 * 1024 * 1024 });
  const patchFile = path.join(scratch, 'current.patch');
  fs.writeFileSync(patchFile, patch);
  record.pending = ref;
  save();
  const result = cp.spawnSync('git', ['apply', '--3way', '--index', patchFile], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.log(JSON.stringify({ integrated: record.integrated.length, pending: ref, conflicts: git('diff', '--name-only', '--diff-filter=U').trim(), detail: result.stderr }));
    process.exit(1);
  }
  finish(ref);
  if (record.integrated.length % 10 === 0) console.log(`Integrated ${record.integrated.length}/${refs.length}`);
}
console.log(JSON.stringify({ complete: true, integrated: record.integrated.length, excluded: [...exclusions] }));
