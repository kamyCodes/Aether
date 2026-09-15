const fs = require('fs');
const s = fs.readFileSync('src/styles.css', 'utf8');
let depth = 0, line = 1, inComment = false, inStr = null;
let issues = [];
for (let i = 0; i < s.length; i++) {
  const c = s[i], n = s[i + 1];
  if (c === '\n') line++;
  if (inComment) { if (c === '*' && n === '/') { inComment = false; i++; } continue; }
  if (inStr) { if (c === inStr && s[i - 1] !== '\\') inStr = null; continue; }
  if (c === '/' && n === '*') { inComment = true; i++; continue; }
  if (c === '"' || c === "'") { inStr = c; continue; }
  if (c === '{') depth++;
  if (c === '}') { depth--; if (depth < 0) { issues.push('extra } at line ' + line); depth = 0; } }
}
console.log('final depth:', depth, issues.length ? issues.join('; ') : '(no negative dips)');
