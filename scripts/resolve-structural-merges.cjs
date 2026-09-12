const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const ts = require('typescript');
const git = (...args) => cp.execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const scratch = path.join(git('rev-parse', '--git-dir').trim(), 'codex-integration', 'nodes');
fs.mkdirSync(scratch, { recursive: true });
let conflicts = 0;
const parse = text => ts.createSourceFile('merge.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const clean = value => (value || '').replace(/\r\n/g, '\n').trim();

function key(node) {
  if (ts.isImportDeclaration(node)) return 'import:' + node.moduleSpecifier.text;
  if (ts.isVariableStatement(node)) return 'var:' + node.declarationList.declarations.map(d => d.name.getText()).join(',');
  if (node.name) return ts.SyntaxKind[node.kind] + ':' + node.name.getText();
  if (ts.isCaseClause(node)) return 'case:' + node.expression.getText();
  if (ts.isDefaultClause(node)) return 'default';
  return ts.SyntaxKind[node.kind] + ':' + clean(node.getText());
}

function textMerge(base, ours, theirs) {
  fs.writeFileSync(path.join(scratch, 'base'), base);
  fs.writeFileSync(path.join(scratch, 'ours'), ours);
  fs.writeFileSync(path.join(scratch, 'theirs'), theirs);
  const result = cp.spawnSync('git', ['merge-file', '-p', '--diff3', '-L', 'ours', '-L', 'base', '-L', 'theirs', path.join(scratch, 'ours'), path.join(scratch, 'base'), path.join(scratch, 'theirs')], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status > 0) conflicts++;
  if (result.status < 0 || result.status === null) throw new Error(result.stderr || 'merge-file failed');
  return result.stdout;
}

function mergeImport(base, ours, theirs) {
  const clauses = [base, ours, theirs].map(n => n?.importClause);
  if (clauses.some(c => !c || !c.namedBindings || !ts.isNamedImports(c.namedBindings))) return null;
  if (new Set(clauses.map(c => `${c.isTypeOnly}:${c.name?.text || ''}`)).size !== 1) return null;
  const lists = clauses.map(c => c.namedBindings.elements);
  const merged = mergeList(...lists, n => n.name.text);
  return `import ${clauses[1].isTypeOnly ? 'type ' : ''}${clauses[1].name ? clauses[1].name.text + ', ' : ''}{ ${merged.join(', ')} } from ${ours.moduleSpecifier.getText()};`;
}

function mergeNode(base, ours, theirs) {
  const b = clean(base?.getFullText()), o = clean(ours?.getFullText()), t = clean(theirs?.getFullText());
  if (o === t || t === b) return o;
  if (o === b) return t;
  if (base && ours && theirs && ts.isImportDeclaration(base)) {
    const result = mergeImport(base, ours, theirs);
    if (result !== null) return result;
  }
  // Dispatch routes are independent named cases; merge each case as one unit.
  if ([base, ours, theirs].every(n => n && ts.isFunctionDeclaration(n) && n.body?.statements.length === 1 && ts.isSwitchStatement(n.body.statements[0]))) {
    const switches = [base, ours, theirs].map(n => n.body.statements[0]);
    const headers = [base, ours, theirs].map((n, i) => n.getText().slice(0, switches[i].caseBlock.getStart() - n.getStart() + 1));
    if (new Set(headers).size === 1) {
      return headers[1] + '\n' + mergeList(...switches.map(s => s.caseBlock.clauses)).join('\n') + '\n  }\n}';
    }
  }
  return textMerge(b + '\n', o + '\n', t + '\n');
}

function mergeList(base, ours, theirs, keyFn = key) {
  const lists = [base, ours, theirs];
  const maps = lists.map(nodes => new Map(nodes.map(n => [keyFn(n), n])));
  if (maps.some((map, i) => map.size !== lists[i].length)) throw new Error('Ambiguous duplicate syntax key; manual merge required');
  const order = ours.map(keyFn);
  const incoming = theirs.map(keyFn);
  for (let i = 0; i < incoming.length; i++) {
    if (order.includes(incoming[i])) continue;
    const next = incoming.slice(i + 1).find(k => order.includes(k));
    order.splice(next ? order.indexOf(next) : order.length, 0, incoming[i]);
  }
  return order.map(k => mergeNode(maps[0].get(k), maps[1].get(k), maps[2].get(k))).filter(Boolean);
}

for (const file of git('diff', '--name-only', '--diff-filter=U').trim().split('\n').filter(Boolean)) {
  if (!file.endsWith('.ts')) continue;
  const texts = [1, 2, 3].map(stage => git('show', `:${stage}:${file}`).replace(/\r\n/g, '\n'));
  const sources = texts.map(parse);
  if (sources.some(source => source.parseDiagnostics.length)) throw new Error(`Invalid source before merge: ${file}`);
  const before = conflicts;
  const merged = mergeList(...sources.map(source => source.statements)).join('\n\n') + '\n';
  fs.writeFileSync(file, merged);
  if (conflicts === before) {
    if (parse(merged).parseDiagnostics.length) throw new Error(`Invalid merged syntax: ${file}`);
    git('add', file);
    console.log(`Structural merge: ${file}`);
  } else console.log(`Manual conflicts: ${file}`);
}
process.exitCode = conflicts ? 1 : 0;
