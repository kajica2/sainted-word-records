#!/usr/bin/env node
/**
 * map-repo.js — Codebase mapper for Obsidian integration
 * 
 * Usage: node map-repo.js /path/to/repo [--obsidian]
 */

const fs = require('fs');
const path = require('path');

const repoPath = process.argv[2] || process.cwd();
const obsidian = process.argv.includes('--obsidian');

const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'dist-dev', '.next', 'coverage', '_archive', '.worktrees', 'mj-output'];

function getFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (!IGNORE_DIRS.includes(item) && !item.startsWith('.')) {
        getFiles(fullPath, files);
      }
    } else {
      const ext = path.extname(item).toLowerCase();
      if (['.js', '.mjs', '.cjs', '.html', '.css'].includes(ext)) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relPath = path.relative(repoPath, filePath);
  
  const info = {
    file: relPath,
    exports: [],
    imports: [],
    globals: [],
    classes: [],
    functions: []
  };
  
  // window.X = exports
  const globalMatches = content.matchAll(/window\.(\w+)\s*=/g);
  for (const m of globalMatches) {
    info.globals.push(m[1]);
  }
  
  // Export patterns
  const exportMatches = content.matchAll(/(?:export\s+(?:default\s+)?(?:const|let|var|function|class)\s+|export\s*\{)([^}]+)/g);
  for (const m of exportMatches) {
    const names = m[1].split(',').map(s => s.trim().split(' as ')[0].trim()).filter(s => s);
    info.exports.push(...names);
  }
  
  // Import patterns
  const importMatches = content.matchAll(/import\s+(?:\{[^}]*\}|\w+|\*\s+as\s+\w+)\s+from\s+['"]([^'"]+)['"]/g);
  for (const m of importMatches) {
    info.imports.push(m[1]);
  }
  
  // Classes
  const classMatches = content.matchAll(/class\s+(\w+)/g);
  for (const m of classMatches) {
    info.classes.push(m[1]);
  }
  
  // Functions (const X = function...)
  const funcMatches = content.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:function|\([^)]*\)\s*=>)/g);
  for (const m of funcMatches) {
    if (!['require', 'module', 'exports'].includes(m[1])) {
      info.functions.push(m[1]);
    }
  }
  
  return info;
}

// Analyze
console.log('Scanning...');
const files = getFiles(repoPath);
const jsFiles = files.filter(f => /\.js$/i.test(f));
const htmlFiles = files.filter(f => /\.html$/i.test(f));

console.log(`Found ${jsFiles.length} JS files, ${htmlFiles.length} HTML files`);

const allInfos = jsFiles.map(f => {
  try {
    return analyzeFile(f);
  } catch (e) {
    return { file: f, error: e.message };
  }
});

// Build maps
const globalMap = new Map();
const exportMap = new Map();
const importMap = new Map();

for (const info of allInfos) {
  if (info.error) continue;
  
  for (const g of info.globals || []) {
    if (!globalMap.has(g)) globalMap.set(g, []);
    globalMap.get(g).push(info.file);
  }
  
  for (const e of info.exports || []) {
    if (!exportMap.has(e)) exportMap.set(e, []);
    exportMap.get(e).push(info.file);
  }
  
  for (const i of info.imports || []) {
    if (!importMap.has(i)) importMap.set(i, []);
    importMap.get(i).push(info.file);
  }
}

// Find unused exports (never imported)
const unused = [];
for (const [exp, locations] of exportMap) {
  const importers = importMap.get(exp) || [];
  if (importers.length === 0) {
    unused.push({ name: exp, in: locations });
  }
}

// Find broken imports (relative paths that don't exist)
const broken = [];
for (const [imp, locations] of importMap) {
  if (imp.startsWith('.')) {
    const baseDir = path.dirname(locations[0]);
    const resolved = path.join(repoPath, baseDir, imp);
    const exists = fs.existsSync(resolved) || 
                   fs.existsSync(resolved + '.js') || 
                   fs.existsSync(resolved + '.mjs') ||
                   fs.existsSync(path.join(resolved, 'index.js'));
    if (!exists) {
      broken.push({ import: imp, from: locations });
    }
  }
}

// Output
if (obsidian) {
  console.log('\n---\nobsidianTile:\n  type: codebase-map\n  repo: ' + path.basename(repoPath) + '\n  scanned: ' + new Date().toISOString() + '\n---\n');
  console.log('# Codebase Map: ' + path.basename(repoPath));
  console.log('\n**Stats:** ' + jsFiles.length + ' JS | ' + htmlFiles.length + ' HTML | ' + unused.length + ' unused exports | ' + broken.length + ' broken imports\n');
  
  console.log('\n## Globals (window.X)\n');
  for (const [name, locs] of globalMap) {
    console.log('- `window.' + name + '` → ' + locs.map(l => '[[' + path.basename(l) + ']]').join(', '));
  }
  
  console.log('\n## Unused Exports\n');
  for (const u of unused.slice(0, 15)) {
    console.log('- `' + u.name + '` → ' + u.in.map(l => '[[' + path.basename(l) + ']]').join(', '));
  }
  if (unused.length > 15) console.log('_...and ' + (unused.length - 15) + ' more_');
  
  console.log('\n## Broken Imports\n');
  for (const b of broken.slice(0, 10)) {
    console.log('- `' + b.import + '` → ' + b.from.map(l => '[[' + path.basename(l) + ']]').join(', '));
  }
  if (broken.length > 10) console.log('_...and ' + (broken.length - 10) + ' more_');
} else {
  console.log('\n# Codebase Map: ' + path.basename(repoPath));
  console.log('\n## Summary');
  console.log('- JS Files: ' + jsFiles.length);
  console.log('- HTML Files: ' + htmlFiles.length);
  console.log('- Unused exports: ' + unused.length);
  console.log('- Broken imports: ' + broken.length);
  
  console.log('\n## Globals');
  for (const [name, locs] of globalMap) {
    console.log('- ' + name + ': ' + locs.join(', '));
  }
  
  console.log('\n## Unused Exports');
  for (const u of unused) {
    console.log('- ' + u.name + ': ' + u.in.join(', '));
  }
  
  console.log('\n## Broken Imports');
  for (const b of broken) {
    console.log('- ' + b.import + ': ' + b.from.join(', '));
  }
}
