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

function normalizeImports(source) {
  const groups = new Map();
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || !node.importClause?.namedBindings || !ts.isNamedImports(node.importClause.namedBindings)) continue;
    const groupKey = `${node.moduleSpecifier.text}:${node.importClause.isTypeOnly}:${node.importClause.name?.text || ''}`;
    groups.set(groupKey, [...(groups.get(groupKey) || []), node]);
  }
  const replacement = new Map(), skip = new Set();
  for (const nodes of groups.values()) {
    if (nodes.length < 2) continue;
    const first = nodes[0], clause = first.importClause;
    const imports = [...new Set(nodes.flatMap(n => n.importClause.namedBindings.elements.map(el => el.getText())))];
    replacement.set(first, `import ${clause.isTypeOnly ? 'type ' : ''}${clause.name ? clause.name.text + ', ' : ''}{ ${imports.join(', ')} } from ${first.moduleSpecifier.getText()};`);
    nodes.slice(1).forEach(node => skip.add(node));
  }
  return parse(source.statements.filter(n => !skip.has(n)).map(n => replacement.get(n) || n.getFullText()).join('\n'));
}

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
  if (result.status < 0 || result.status === null) throw new Error(result.stderr || 'merge-file failed');
  const output = result.stdout.replace(/^<<<<<<< ours\n([\s\S]*?)^\|\|\|\|\|\|\| base\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>> theirs\n/gm, (whole, left, ancestor, right) => {
    const category = text => {
      const source = parse(`const category = { ${text} };`);
      if (source.parseDiagnostics.length) return null;
      const props = source.statements[0].declarationList.declarations[0].initializer.properties;
      if (props.length !== 3 || !props.every(ts.isPropertyAssignment)) return null;
      const fields = Object.fromEntries(props.map(p => [p.name.getText(), p.initializer]));
      if (!fields.label || !fields.description || !fields.kinds || !ts.isStringLiteral(fields.label) || !ts.isStringLiteral(fields.description) || !ts.isArrayLiteralExpression(fields.kinds) || !fields.kinds.elements.every(ts.isStringLiteral)) return null;
      return { label: fields.label.text, description: fields.description.text, kinds: fields.kinds.elements.map(el => el.text) };
    };
    const lc = category(left), rc = category(right);
    if (lc && rc && lc.label === rc.label) {
      const suffix = '\u76f8\u5173\u63d0\u9192';
      if (lc.description.endsWith(suffix) && rc.description.endsWith(suffix)) {
        const topics = [...new Set([lc, rc].flatMap(c => c.description.slice(0, -suffix.length).split('\u3001')))];
        return `    label: ${JSON.stringify(lc.label)},\n    description: ${JSON.stringify(topics.join('\u3001') + suffix)},\n    kinds: ${JSON.stringify([...new Set([...lc.kinds, ...rc.kinds])])},\n`;
      }
    }
    const field = /^([ \t]*<label>字典类型<input name="dict_type" placeholder=")([^"\n]+)(" required \/><\/label>)\s*$/;
    const a = left.match(field), b = right.match(field);
    if (a && b && a[1] === b[1] && a[3] === b[3]) {
      return a[1] + [...new Set([...a[2].split(' / '), ...b[2].split(' / ')])].join(' / ') + a[3] + '\n';
    }
    if (!ancestor.trim()) {
      const l = parse(left), r = parse(right);
      const selector = node => {
        let found;
        const visit = current => {
          if (found) return;
          if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression) && ['querySelector', 'querySelectorAll'].includes(current.expression.name.text) && current.arguments[0] && ts.isStringLiteral(current.arguments[0])) found = current.arguments[0].text;
          else ts.forEachChild(current, visit);
        };
        visit(node);
        return found;
      };
      if (!l.parseDiagnostics.length && !r.parseDiagnostics.length && [...l.statements, ...r.statements].every(ts.isExpressionStatement)) {
        const a = l.statements.map(selector), b = r.statements.map(selector);
        if (a.length && b.length && [...a, ...b].every(Boolean) && !a.some(value => b.includes(value))) return left + right;
      }
      const variables = s => s.statements.filter(ts.isVariableStatement).flatMap(n => n.declarationList.declarations.map(d => d.name.getText()));
      if (!l.parseDiagnostics.length && !r.parseDiagnostics.length && [...l.statements, ...r.statements].every(n => ts.isVariableStatement(n) || ts.isIfStatement(n)) && variables(l).length + variables(r).length > 0 && !variables(l).some(name => variables(r).includes(name))) return left + right;
      const propertyNames = text => {
        const source = parse(`const merged = { ${text} };`);
        if (source.parseDiagnostics.length) return null;
        const props = source.statements[0].declarationList.declarations[0].initializer.properties;
        if (!props.length || !props.every(ts.isPropertyAssignment)) return null;
        return props.map(p => p.name.getText());
      };
      const lp = propertyNames(left), rp = propertyNames(right);
      if (lp && rp && !lp.some(name => rp.includes(name))) return left + right;
      if (!l.parseDiagnostics.length && !r.parseDiagnostics.length && l.statements.length === 1 && r.statements.length === 1 && ts.isIfStatement(l.statements[0]) && ts.isIfStatement(r.statements[0])) {
        const x = l.statements[0].expression.getText(), y = r.statements[0].expression.getText();
        if (x === '!' + y || y === '!' + x) return left + right;
      }
    }
    const tokens = tokenMerge(ancestor, left, right);
    if (tokens !== null) return tokens;
    return whole;
  });
  if (/^<<<<<<< ours$/m.test(output)) {
    const tokenize = s => (s.match(/\r?\n|[^\S\r\n]+|[\p{L}\p{N}_$]+|./gu) || []).map(t => JSON.stringify(t)).join('\n') + '\n';
    for (const [name, content] of [['base', base], ['ours', ours], ['theirs', theirs]]) fs.writeFileSync(path.join(scratch, name + '-tokens'), tokenize(content));
    const tokens = cp.spawnSync('git', ['merge-file', '-p', path.join(scratch, 'ours-tokens'), path.join(scratch, 'base-tokens'), path.join(scratch, 'theirs-tokens')], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (tokens.status === 0) return tokens.stdout.trimEnd().split('\n').map(line => JSON.parse(line)).join('');
    conflicts++;
  }
  return output;
}

function tokenMerge(base, ours, theirs) {
  const tokenize = s => (s.match(/\r?\n|[^\S\r\n]+|[\p{L}\p{N}_$]+|./gu) || []).map(t => JSON.stringify(t)).join('\n') + '\n';
  for (const [name, text] of [['base', base], ['ours', ours], ['theirs', theirs]]) fs.writeFileSync(path.join(scratch, name + '-fragment'), tokenize(text));
  const run = cp.spawnSync('git', ['merge-file', '-p', path.join(scratch, 'ours-fragment'), path.join(scratch, 'base-fragment'), path.join(scratch, 'theirs-fragment')], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return run.status === 0 ? run.stdout.trimEnd().split('\n').filter(Boolean).map(line => JSON.parse(line)).join('') : null;
}

function mergeImport(base, ours, theirs) {
  const clauses = [base, ours, theirs].map(n => n?.importClause);
  if (clauses.filter(Boolean).some(c => !c.namedBindings || !ts.isNamedImports(c.namedBindings))) return null;
  if (new Set(clauses.filter(Boolean).map(c => `${c.isTypeOnly}:${c.name?.text || ''}`)).size !== 1) return null;
  const lists = clauses.map(c => c ? c.namedBindings.elements : []);
  const merged = mergeList(...lists, n => n.name.text);
  return `import ${clauses[1].isTypeOnly ? 'type ' : ''}${clauses[1].name ? clauses[1].name.text + ', ' : ''}{ ${merged.join(', ')} } from ${ours.moduleSpecifier.getText()};`;
}

function mergeNode(base, ours, theirs) {
  const b = clean(base?.getFullText()), o = clean(ours?.getFullText()), t = clean(theirs?.getFullText());
  if (o === t || t === b) return o;
  if (o === b) return t;
  if (ours && theirs && ts.isImportDeclaration(ours) && ts.isImportDeclaration(theirs)) {
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
  const sources = texts.map(parse).map(normalizeImports);
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
