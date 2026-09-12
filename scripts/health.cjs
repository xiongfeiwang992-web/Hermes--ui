const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(__dirname).filter(name => name === 'smoke.ts' || name.endsWith('-smoke.ts')).sort();
const results = [];
for (const file of files) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [require.resolve('tsx/cli'), path.join(__dirname, file)], {
    cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
  });
  const output = `${run.stdout || ''}\n${run.stderr || ''}`;
  const result = { file, ok: run.status === 0 && !run.error, exitCode: run.status, elapsedMs: Date.now() - started, output };
  results.push(result);
  console.log(`${result.ok ? 'PASS' : 'FAIL'} ${file} (${result.elapsedMs}ms)`);
  if (!result.ok) console.error(run.error?.message || output.slice(-5000));
}
const report = { generatedAt: new Date().toISOString(), node: process.version, total: results.length, passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results };
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'data', 'health-results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Health: ${report.passed}/${report.total} suites passed; ${report.failed} failed.`);
process.exitCode = report.failed ? 1 : 0;
