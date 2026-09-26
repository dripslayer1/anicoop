// Structural checks on index.html's in-DOM Vue template (what the browser's parser does to it).
// usage (from an empty folder): npm i parse5@7, then node htmlcheck.mjs <repo>. Expect only the two intentional
// "v-if and v-for on the same <template>" lines (feed polls / debates use v-for as a local variable).
import fs from 'node:fs';
import { parse } from 'parse5';

const repo = process.argv[2];
const html = fs.readFileSync(repo + '/index.html', 'utf8');
const lineOf = (off) => html.slice(0, off).split('\n').length;
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const doc = parse(html, { sourceCodeLocationInfo: true });
const out = [];
const ids = new Map();
const walk = (n, fn) => { fn(n); for (const c of n.childNodes || []) walk(c, fn); if (n.content) walk(n.content, fn); };
walk(doc, (n) => {
    if (!n.tagName) return;
    const loc = n.sourceCodeLocation;
    const attrs = Object.fromEntries((n.attrs || []).map(a => [a.name, a.value]));
    const line = loc ? lineOf(loc.startOffset) : '?';
    // 1. implicitly closed / created elements (the parser restructured the markup)
    if (n.namespaceURI === 'http://www.w3.org/1999/xhtml' && !VOID.has(n.tagName) && loc && !loc.endTag && !['html', 'head', 'body', 'tbody', 'colgroup'].includes(n.tagName)) out.push(`${line}: <${n.tagName}> has no closing tag in the source (the browser closed it somewhere else)`);
    if (!loc && !['html', 'head', 'body', 'tbody'].includes(n.tagName)) out.push(`? : <${n.tagName}> was created by the parser (not in the source) under <${n.parentNode?.tagName}>`);
    // 2. v-if + v-for on one element
    if ('v-for' in attrs && ('v-if' in attrs)) out.push(`${line}: v-if and v-for on the same <${n.tagName}> (v-if runs first in Vue 3)`);
    // 3. v-for without key (template v-for keys go on the template in Vue 3)
    if ('v-for' in attrs && !(':key' in attrs) && !('v-bind:key' in attrs) && n.tagName !== 'template') out.push(`${line}: v-for without :key on <${n.tagName}>`);
    // 4. duplicate static ids
    if (attrs.id) { if (ids.has(attrs.id)) out.push(`${line}: duplicate id="${attrs.id}" (also line ${ids.get(attrs.id)})`); else ids.set(attrs.id, line); }
    // 5. buttons inside buttons / links inside buttons
    if (n.tagName === 'button') { let p = n.parentNode; while (p) { if (p.tagName === 'button' || p.tagName === 'a') { out.push(`${line}: <button> inside <${p.tagName}>`); break; } p = p.parentNode; } }
    // 6. img without alt
    if (n.tagName === 'img' && !('alt' in attrs) && !(':alt' in attrs)) out.push(`${line}: <img> without alt`);
});
// 7. raw-source checks: self-closing custom components, uppercase attribute names on elements
const COMPONENTS = ['poster-card', 'quick-add', 'track-row', 'user-avatar', 'score-input', 'teleport', 'transition', 'transition-group', 'component', 'keep-alive'];
for (const m of html.matchAll(/<([a-z][\w-]*)\b[^<>]*?\/>/g)) if (!VOID.has(m[1]) && !['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'stop', 'use', 'g'].includes(m[1])) out.push(`${lineOf(m.index)}: self-closing <${m[1]} …/> (in-DOM templates need a closing tag)`);
walk(doc, (n) => {
    if (!n.tagName || !n.sourceCodeLocation?.attrs || n.namespaceURI !== 'http://www.w3.org/1999/xhtml') return;
    for (const [name, l] of Object.entries(n.sourceCodeLocation.attrs)) {
        const raw = html.slice(l.startOffset, l.endOffset).split('=')[0];
        if (/[A-Z]/.test(raw)) out.push(`${lineOf(l.startOffset)}: attribute "${raw}" has capitals (the browser lowercases it to "${name}")`);
    }
});
console.log(out.join('\n') || 'no problems');
console.log('\n' + out.length + ' findings');
