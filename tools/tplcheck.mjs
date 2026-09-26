// Template checker: every name a template uses must come from its setup() return / props.
// Also lists setup return keys that nothing uses (dead code candidates).
// usage (from an empty folder): npm i parse5@7 acorn@8 acorn-walk@8 @vue/compiler-dom@3.5.13, then node tplcheck.mjs <repo>
// A name the template uses that setup() doesn't return renders as undefined (a silent bug); expect "problems: 0".
import fs from 'node:fs';
import { parse, serialize } from 'parse5';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { compile } from '@vue/compiler-dom';

const repo = process.argv[2];
const html = fs.readFileSync(repo + '/index.html', 'utf8');
const js = fs.readFileSync(repo + '/app.js', 'utf8');

const find = (node, pred) => {
    if (pred(node)) return node;
    for (const c of node.childNodes || []) { const r = find(c, pred); if (r) return r; }
    if (node.content) { const r = find(node.content, pred); if (r) return r; }
    return null;
};
const doc = parse(html);
const appEl = find(doc, n => n.attrs?.some(a => a.name === 'id' && a.value === 'app'));
const mainTpl = serialize(appEl);

const ast = acorn.parse(js, { ecmaVersion: 2023, sourceType: 'script', locations: true });

const keysOfObject = (obj) => {
    const out = [];
    for (const p of obj.properties) {
        if (p.type === 'SpreadElement') { out.push('...' + js.slice(p.argument.start, p.argument.end)); continue; }
        if (p.key.type === 'Identifier') out.push(p.key.name);
        else if (p.key.type === 'Literal') out.push(String(p.key.value));
    }
    return out;
};
const lastReturnObject = (fnBody) => {
    // the top-level return statement of the function body
    const rets = fnBody.body.filter(s => s.type === 'ReturnStatement' && s.argument?.type === 'ObjectExpression');
    return rets[rets.length - 1]?.argument || null;
};
const propOf = (obj, name) => obj.properties.find(p => p.type === 'Property' && ((p.key.type === 'Identifier' && p.key.name === name) || (p.key.type === 'Literal' && p.key.value === name)));

const components = [];
let mainSetup = null;
walk.simple(ast, {
    VariableDeclarator(node) {
        if (node.init?.type !== 'ObjectExpression') return;
        const tpl = propOf(node.init, 'template');
        if (!tpl) return;
        const props = propOf(node.init, 'props');
        const setup = propOf(node.init, 'setup');
        let keys = [];
        if (props) keys.push(...(props.value.type === 'ObjectExpression' ? keysOfObject(props.value) : props.value.elements.map(e => e.value)));
        if (setup) {
            const fn = setup.value.type === 'FunctionExpression' || setup.value.type === 'ArrowFunctionExpression' ? setup.value : setup;
            const body = fn.body || setup.value.body;
            const ro = lastReturnObject(body);
            if (ro) keys.push(...keysOfObject(ro));
        }
        const methods = propOf(node.init, 'methods');
        if (methods) keys.push(...keysOfObject(methods.value));
        const computedP = propOf(node.init, 'computed');
        if (computedP) keys.push(...keysOfObject(computedP.value));
        let text = tpl.value.type === 'TemplateLiteral' ? tpl.value.quasis.map(q => q.value.cooked).join('${}') : tpl.value.value;
        if (typeof text !== 'string' || !/^\s*</.test(text)) return;   // a source object with a template: 'mihon' setting, not a component
        components.push({ name: node.id.name, keys, tpl: text, line: node.loc.start.line });
    },
    CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'createApp' && node.arguments[0]?.type === 'ObjectExpression') {
            const setup = propOf(node.arguments[0], 'setup');
            mainSetup = setup.value;
        }
    },
});
const mainReturn = lastReturnObject(mainSetup.body);
const mainKeys = keysOfObject(mainReturn);
components.unshift({ name: 'MAIN (#app in index.html)', keys: mainKeys, tpl: mainTpl, line: 0 });

const INSTANCE = new Set(['$emit', '$refs', '$el', '$event', '$attrs', '$slots', '$props', '$data', '$options', '$nextTick', '$forceUpdate', '$watch', '$parent', '$root']);
let problems = 0;
const usedMain = new Set();
for (const c of components) {
    const errors = [];
    let code = '';
    try {
        code = compile(c.tpl, { prefixIdentifiers: true, hoistStatic: false, cacheHandlers: false, onError: e => errors.push(e), onWarn: e => errors.push(e) }).code;
    } catch (e) { errors.push(e); }
    for (const e of errors) { problems++; console.log(`[${c.name}] COMPILE: ${e.message}${e.loc ? ' @ ' + JSON.stringify(e.loc.start) + ' ' + JSON.stringify(c.tpl.slice(e.loc.start.offset, e.loc.start.offset + 120)) : ''}`); }
    const used = new Set([...code.matchAll(/_ctx\.([A-Za-z_$][\w$]*)/g)].map(m => m[1]));
    const keys = new Set(c.keys);
    for (const u of used) {
        if (!keys.has(u) && !INSTANCE.has(u)) { problems++; console.log(`[${c.name}] NOT RETURNED: ${u}`); }
    }
    if (c.name.startsWith('MAIN')) used.forEach(u => usedMain.add(u));
    else console.log(`[${c.name}] ok-check: ${used.size} names used, ${keys.size} available`);
}
// dead-code candidates: returned from main setup but used neither in the template nor anywhere else in app.js
const retStart = mainReturn.start, retEnd = mainReturn.end;
const jsNoReturn = js.slice(0, retStart) + js.slice(retEnd);
const allTpl = components.map(c => c.tpl).join('\n');
const unused = [];
for (const k of mainKeys) {
    if (k.startsWith('...')) continue;
    if (usedMain.has(k)) continue;
    const re = new RegExp('(^|[^\\w$.])' + k.replace(/\$/g, '\\$') + '(?![\\w$])', 'g');
    const inJs = (jsNoReturn.match(re) || []).length;   // includes its own declaration
    const inTpl = (allTpl.match(re) || []).length;
    unused.push(`${k} (js refs incl. declaration: ${inJs}, template text refs: ${inTpl})`);
}
console.log('\nReturned from setup but not used by the #app template (' + unused.length + '):');
console.log(unused.join('\n'));
console.log('\nproblems:', problems);
