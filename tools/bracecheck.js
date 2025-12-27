const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node tools/bracecheck.js <file>');
  process.exit(2);
}

const s = fs.readFileSync(file, 'utf8');

let line = 1;
let col = 0;
let mode = 'code'; // code | linecomment | blockcomment | string | template
let quote = null;
let esc = false;

const stack = [];

function push(ch) {
  stack.push({ ch, line, col });
}

function pushTemplateExpr() {
  stack.push({ ch: '{', line, col, templateExpr: true });
}

function pop(ch) {
  const top = stack[stack.length - 1];
  if (!top) return;
  const ok =
    (top.ch === '{' && ch === '}') ||
    (top.ch === '(' && ch === ')') ||
    (top.ch === '[' && ch === ']');
  if (ok) {
    const popped = stack.pop();
    if (popped && popped.templateExpr) {
      // Return to template scanning mode after closing ${...}
      mode = 'template';
      quote = '`';
      esc = false;
    }
  }
}

for (let i = 0; i < s.length; i++) {
  const c = s[i];
  col++;
  if (c === '\n') {
    line++;
    col = 0;
  }

  if (mode === 'linecomment') {
    if (c === '\n') mode = 'code';
    continue;
  }
  if (mode === 'blockcomment') {
    if (c === '*' && s[i + 1] === '/') {
      mode = 'code';
      i++;
      col++;
    }
    continue;
  }
  if (mode === 'string') {
    if (esc) {
      esc = false;
      continue;
    }
    if (c === '\\') {
      esc = true;
      continue;
    }
    if (quote === '`') {
      mode = 'template';
      // reprocess this character under template mode
      i--;
      col--;
      continue;
    }
    if (c === quote) {
      mode = 'code';
      quote = null;
    }
    continue;
  }

  if (mode === 'template') {
    if (esc) {
      esc = false;
      continue;
    }
    if (c === '\\') {
      esc = true;
      continue;
    }
    if (c === '`') {
      mode = 'code';
      quote = null;
      continue;
    }
    // Enter template expression: ${ ... }
    if (c === '$' && s[i + 1] === '{') {
      // switch to code mode and track that this { must return to template
      mode = 'code';
      quote = null;
      i++;
      col++;
      pushTemplateExpr();
      continue;
    }
    continue;
  }

  // code
  if (c === '/' && s[i + 1] === '/') {
    mode = 'linecomment';
    i++;
    col++;
    continue;
  }
  if (c === '/' && s[i + 1] === '*') {
    mode = 'blockcomment';
    i++;
    col++;
    continue;
  }
  if (c === '"' || c === "'" || c === '`') {
    mode = 'string';
    quote = c;
    esc = false;
    continue;
  }

  if (c === '{' || c === '(' || c === '[') push(c);
  if (c === '}' || c === ')' || c === ']') pop(c);
}

if (stack.length) {
  console.log('Unclosed tokens:', stack.length);
  console.log('Last unclosed:', stack[stack.length - 1]);
  process.exit(1);
}

console.log('Balanced');
