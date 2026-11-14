'use strict';

/* ==========================================================================
   SeqGen Web — 时序图编辑器（本地版，全功能免费无限制）
   --------------------------------------------------------------------------
   数据模型
     doc = {
       title, span,                         // span = 时间轴长度（单位）
       ruler: {prefix, suffix, start, increment},
       rows: [ row ],
       annotations: [ ann ],
       breaks: [ break ],
       theme, seq
     }
   row(clock)  {id,type:'clock',  name,color,height, period,phase,duty,invert,ideal,
                riseArrows,fallArrows,differential,riseGuide,fallGuide}
   row(signal) {id,type:'signal', name,color,height, initState, edges:[{t,state}],
                ideal,riseArrows,fallArrows,differential,allowGlitch}
   row(bus)    {id,type:'bus',    name,color,height, initValue, edges:[{t,value}], ideal}
   row(sep)    {id,type:'separator', name,color, label, rule}
   ann         {id,type:'text'|'arrow'|'bracket', ...}
   break       {id,t,scope:'row'|'all',rowId,color}
   ========================================================================== */

/* ============================ 0. 基础工具 ============================ */
const NS = 'http://www.w3.org/2000/svg';
const FONT = 'Consolas, "Courier New", monospace';

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

function mk(tag, attrs, parent) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v === undefined || v === null) continue;
      if (k === 'text') e.textContent = v;
      else if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
  }
  if (parent) parent.appendChild(e);
  return e;
}

function sv(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v === undefined || v === null) continue;
      if (k === 'text') e.textContent = v;
      else e.setAttribute(k, v);
    }
  }
  if (parent) parent.appendChild(e);
  return e;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = (p) => p + Math.random().toString(36).slice(2, 8);
function fmtNum(v) {
  const n = Math.round(v * 100) / 100;
  return String(n);
}
function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = mk('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1200);
}

/**
 * 保存文件：优先弹系统「另存为」对话框（可自选目录 + 文件名），
 * 浏览器不支持或调用失败时退回普通下载。
 * 成功返回 FileSystemFileHandle（可留作下次「保存」直接覆盖），否则 null。
 */
async function saveBlobAs(blob, name, desc, mime) {
  const m = /\.([A-Za-z0-9]+)$/.exec(name);
  const ext = m ? m[1] : '';
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const opts = { suggestedName: name };
      if (ext) opts.types = [{ description: desc || ext.toUpperCase(), accept: { [mime]: ['.' + ext] } }];
      const handle = await window.showSaveFilePicker(opts);
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      toast('已保存：' + handle.name);
      return handle;
    } catch (err) {
      if (err && err.name === 'AbortError') { toast('已取消'); return null; }
      console.warn('保存对话框不可用，改走下载：', err);
    }
  }
  downloadBlob(blob, name);
  toast('已下载：' + name);
  return null;
}

let toastTimer = null;
function toast(msg, isErr, ms) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, ms || 2000);
}

/* 拖动时跟随光标的时间提示 */
let tipEl = null;
function showDragTip(text, x, y) {
  if (!tipEl) {
    tipEl = mk('div', { id: 'drag-tip' });
    document.body.appendChild(tipEl);
  }
  tipEl.textContent = text;
  tipEl.style.left = (x + 14) + 'px';
  tipEl.style.top = (y - 32) + 'px';
  tipEl.classList.add('show');
}
function hideDragTip() {
  if (tipEl) tipEl.classList.remove('show');
}

/* ============================ 1. 主题 ============================ */
const THEME = {
  dark: {
    bg: '#0f0f1a',
    ruler: '#151a2e',
    grid: '#20203a',
    gridMinor: '#1a1a2e',
    text: '#e9e9f2',
    dim: '#8b8ba7',
    faint: '#42425e',
    accent: '#4fbdba',
    accentSoft: 'rgba(79,189,186,0.12)',
    sel: '#f39c12',
    rowHover: 'rgba(79,189,186,0.045)',
    rowSel: 'rgba(79,189,186,0.07)',
    noteBg: '#16213e',
    noteBorder: '#2d2d44',
    labelBg: '#1a1a2e'
  },
  light: {
    bg: '#ffffff',
    ruler: '#f6f8fb',
    grid: '#dfe6f0',
    gridMinor: '#eef2f8',
    text: '#1f2430',
    dim: '#5d6879',
    faint: '#b7c0cd',
    accent: '#0f8a86',
    accentSoft: 'rgba(15,138,134,0.09)',
    sel: '#d98200',
    rowHover: 'rgba(15,138,134,0.045)',
    rowSel: 'rgba(15,138,134,0.06)',
    noteBg: '#ffffff',
    noteBorder: '#ccd5e0',
    labelBg: '#fafbfd'
  },
  graphite: {
    bg: '#15171b',
    ruler: '#1b1f25',
    grid: '#282d35',
    gridMinor: '#1f232a',
    text: '#e7e9ee',
    dim: '#8f97a3',
    faint: '#4a515c',
    accent: '#3ddc97',
    accentSoft: 'rgba(61,220,151,0.12)',
    sel: '#ffab3d',
    rowHover: 'rgba(61,220,151,0.045)',
    rowSel: 'rgba(61,220,151,0.07)',
    noteBg: '#1c1f25',
    noteBorder: '#2e333c',
    labelBg: '#22262e'
  },
  navy: {
    bg: '#0a1020',
    ruler: '#0f1729',
    grid: '#1b2742',
    gridMinor: '#131d33',
    text: '#e4e9f5',
    dim: '#8290ab',
    faint: '#41506b',
    accent: '#4d8cf5',
    accentSoft: 'rgba(77,140,245,0.13)',
    sel: '#ffb545',
    rowHover: 'rgba(77,140,245,0.05)',
    rowSel: 'rgba(77,140,245,0.08)',
    noteBg: '#111a2e',
    noteBorder: '#22304d',
    labelBg: '#16203a'
  },
  carbon: {
    bg: '#08080a',
    ruler: '#0e0e11',
    grid: '#1a1a1f',
    gridMinor: '#121216',
    text: '#ededf1',
    dim: '#8a8a95',
    faint: '#43434c',
    accent: '#f0b429',
    accentSoft: 'rgba(240,180,41,0.12)',
    sel: '#4fd1c5',
    rowHover: 'rgba(240,180,41,0.045)',
    rowSel: 'rgba(240,180,41,0.07)',
    noteBg: '#101013',
    noteBorder: '#26262c',
    labelBg: '#16161a'
  }
};
let T = THEME.dark;

/** 浅色主题下压暗波形颜色，保证白底对比度 */
function shade(hex, p) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.round(r * (1 - p)); g = Math.round(g * (1 - p)); b = Math.round(b * (1 - p));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
function wc(c) {
  if (!c || typeof c !== 'string' || c.charAt(0) !== '#') return c;
  if (!S || S.theme !== 'light') return c;
  return shade(c, 0.34);
}

/* ============================ 2. 尺寸常量 ============================ */
const LABEL_W = 152;   // 左侧行名列宽
const RULER_H = 30;    // 顶部标尺高
const PAD_TOP = 10;
const PAD_BOTTOM = 40;
const GAP = 16;        // 行间距
const ROW_H = 46;
const SEP_H = 26;
let PXPU = 8;          // 每个时间单位的像素（由「每格宽度 ÷ 刻度增量」算出，见 applyScale）
const FT = 0.04;       // 斜率边沿的半宽 = 一格宽度的这个比例（见 edgeFtPx）
const MAX_CONTENT_W = 12000;  // 画布最大宽度，超过就自动压缩比例，避免 SVG 过大卡死
const INC_MAX = 100000;       // 刻度增量上限（够放超大时间跨度，同时避免无意义的极端值）

const cx = (t) => LABEL_W + t * PXPU;
const tx = (x) => (x - LABEL_W) / PXPU;

/* ============================ 3. 文档模型 ============================ */
let S = null;
let sel = null;
let tool = 'select';
let zoom = 1;
let contentH = 360;
let pending = null;       // 绘制中的标注
let pointerPos = null;
let edgeDragActive = false; // 正在拖动边沿（拖动时用跟随光标的数值提示，避免重复标签）
let attachPreview = null;   // 拖动标注端点时高亮将要吸附的波形 {rowId, t, y}
// 自实现双击判定：pointerdown 会 render() 重建节点，
// 导致 mousedown/mouseup 目标不一致，浏览器不再派发 click/dblclick。
let lastDown = { t: 0, x: 0, y: 0, key: '' };
function isDoubleDown(e, key) {
  const now = Date.now();
  const same = now - lastDown.t < 420 &&
    Math.abs(e.clientX - lastDown.x) < 7 &&
    Math.abs(e.clientY - lastDown.y) < 7 &&
    lastDown.key === key;
  lastDown = same ? { t: 0, x: 0, y: 0, key: '' } : { t: now, x: e.clientX, y: e.clientY, key };
  return same;
}

const LS_KEY = 'seqgen-web:v1';

const PALETTE = ['#4fbdba', '#6aa9ff', '#f0a35e', '#a58ef0', '#6ee7a8', '#e56b6f', '#e8c46a', '#74d3f0'];

function blankDoc() {
  return {
    v: 1,
    title: '未命名时序图',
    span: 120,
    ruler: { prefix: '', suffix: ' ns', start: 0, increment: 10 },
    rows: [],
    annotations: [],
    breaks: [],
    theme: 'dark',
    seq: 1
  };
}

function nid(prefix) {
  S.seq = (S.seq || 1) + 1;
  return prefix + S.seq;
}

function newRow(type) {
  const id = nid('r');
  const color = PALETTE[(S.rows.length) % PALETTE.length];
  if (type === 'clock') {
    return {
      id, type, name: 'CLK', color: '#4fbdba', height: ROW_H,
      period: 20, phase: 0, duty: 50, invert: false, ideal: true,
      riseArrows: false, fallArrows: false, differential: false,
      riseGuide: false, fallGuide: false
    };
  }
  if (type === 'signal') {
    return {
      id, type, name: 'SIG', color, height: ROW_H,
      initState: '0', edges: [], ideal: false,
      riseArrows: false, fallArrows: false, differential: false, allowGlitch: false
    };
  }
  if (type === 'bus') {
    return {
      id, type, name: 'BUS', color, height: ROW_H,
      initValue: '--', edges: [], ideal: false
    };
  }
  return { id, type: 'separator', name: '', color: '#8b8ba7', label: 'GROUP', rule: 'dashed', height: SEP_H };
}

function sampleDoc() {
  const d = blankDoc();
  d.title = '示例：SPI 写时序';
  d.span = 120;
  d.ruler = { prefix: '', suffix: ' ns', start: 0, increment: 10 };
  d.rows = [];
  d.annotations = [];
  d.breaks = [];
  d.seq = 1;
  S = d; // 供 newRow 使用
  const add = (type, props) => { const r = newRow(type); Object.assign(r, props); d.rows.push(r); return r; };

  const clk = add('clock', { name: 'CLK', period: 20, duty: 50, phase: 0, riseGuide: true, color: '#4fbdba' });
  const cs = add('signal', { name: 'CS_N', initState: '1', color: '#6aa9ff', edges: [{ t: 20, state: '0' }, { t: 100, state: '1' }] });
  add('bus', {
    name: 'MOSI', color: '#f0a35e', initValue: '--',
    edges: [{ t: 20, value: '0xA5' }, { t: 40, value: '0x3C' }, { t: 60, value: '0x7E' }, { t: 80, value: '0x10' }, { t: 100, value: '--' }]
  });
  add('bus', {
    name: 'MISO', color: '#a58ef0', initValue: '--',
    edges: [{ t: 30, value: '0x5A' }, { t: 60, value: '0x3C' }, { t: 90, value: '--' }]
  });
  const rdy = add('signal', {
    name: 'RDY', initState: '0', color: '#6ee7a8',
    edges: [{ t: 24, state: '1' }, { t: 36, state: '0' }, { t: 48, state: 'Z' }, { t: 68, state: '1' }, { t: 78, state: '0' }]
  });
  const sepRow = add('separator', { label: '时序参数', rule: 'dashed', color: '#8b8ba7' });

  d.annotations = [
    {
      id: 'an1', type: 'bracket', mode: 'time', label: '',
      a1: { rowId: cs.id, t: 20, dy: -25 },
      a2: { rowId: cs.id, t: 24, dy: -25 },
      color: '#f0a35e'
    },
    {
      id: 'an2', type: 'text', text: 'SPI 写时序示例 · 数据在 CLK 上升沿被采样',
      a1: { rowId: sepRow.id, t: 44, dy: 22 }, x: 0, y: 0, size: 11, color: '#7a879b'
    }
  ];
  return d;
}

/* ============================ 4. 历史 ============================ */
let undoStack = [], redoStack = [], lastKey = null, lastTime = 0, saveTimer = null;

function beginChange(key) {
  const now = Date.now();
  // 仅对连续输入类操作合并历史记录（key 以 ~ 开头）
  if (key && key.charAt(0) === '~' && key === lastKey && now - lastTime < 900) { lastTime = now; return; }
  undoStack.push(JSON.stringify(S));
  if (undoStack.length > 300) undoStack.shift();
  redoStack.length = 0;
  lastKey = key || null;
  lastTime = now;
  updateUndoButtons();
  scheduleSave();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(S));
  S = JSON.parse(undoStack.pop());
  lastKey = null;
  afterRestore();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(S));
  S = JSON.parse(redoStack.pop());
  lastKey = null;
  afterRestore();
}
function afterRestore() {
  fixSel();
  render();
  renderProps();
  updateUndoButtons();
  scheduleSave();
}
function updateUndoButtons() {
  $('#btn-undo').disabled = undoStack.length === 0;
  $('#btn-redo').disabled = redoStack.length === 0;
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { }
  }, 500);
}

/* ============================ 5. 布局与几何 ============================ */
function rowH(r) { return r.type === 'separator' ? SEP_H : (r.height || ROW_H); }
function rowById(id) { return S.rows.find(r => r.id === id) || null; }
function rowIndex(id) { return S.rows.findIndex(r => r.id === id); }
function rowMid(r) { return r._y + rowH(r) / 2; }

function layout() {
  let y = RULER_H + PAD_TOP;
  for (const r of S.rows) {
    r._y = y;
    y += rowH(r) + GAP;
  }
  contentH = Math.max(y + PAD_BOTTOM, 320);
}
function contentW() {
  return LABEL_W + S.span * PXPU + 56;
}

/**
 * 由「每格宽度（px）」和「刻度增量」换算出 PXPU。
 * 关键是两件事分开：格子宽度由 gridPx 决定（改增量不影响它），增量只决定一格代表多少时间单位。
 * 老文档没有 gridPx 字段时，init 里会按原来的 8px/单位 反推；这里再兜一层，保证任何新建文档也有定值。
 */
function applyScale() {
  const inc = Math.max(0.05, +S.ruler.increment || 10);
  if (!S.ruler.gridPx) S.ruler.gridPx = 80;   // 兜底：没有就固定 80，之后改增量不会再改变格子宽度
  const gp = clamp(+S.ruler.gridPx, 6, 400);
  const wanted = gp / inc;
  // 总长度很大时压缩比例，否则内容宽度会爆炸（SVG 过大会卡顿、导出也吃内存）
  const cap = MAX_CONTENT_W / Math.max(1, S.span);
  PXPU = Math.max(0.02, Math.min(wanted, cap));
}

/**
 * 改标尺比例（增量 / 每格宽度 / 总长度）后的统一处理：
 * 重算 PXPU，并按新旧比例映射自由摆放的标注坐标，否则标注会和波形错位。
 */
function applyScaleChange(mutate) {
  const oldPx = PXPU;
  mutate();
  applyScale();
  if (oldPx > 0 && Math.abs(PXPU - oldPx) > 1e-9) {
    const k = PXPU / oldPx;
    const fx = (x) => LABEL_W + ((x || 0) - LABEL_W) * k;
    (S.annotations || []).forEach(a => {
      if (a.type === 'text') { if (!a.a1) a.x = fx(a.x); }
      else {
        if (!a.a1) a.x1 = fx(a.x1);
        if (!a.a2) a.x2 = fx(a.x2);
      }
    });
  }
  render();
}

function firstSrc(row) {
  if (!row.first) row.first = {};
  return row.first;
}

function stepSegments(row) {
  const isBus = row.type === 'bus';
  const key = isBus ? 'value' : 'state';
  const init = isBus ? (row.initValue || '') : (row.initState || '0');
  const out = [];
  let t0 = 0, v = init, src = null;
  const first = firstSrc(row);

  const push = (a, b, val, s) => {
    if (b - a <= 0.02) return;
    const o = s || first;
    out.push({
      t0: a, t1: b, v: val, src: s,
      text: o.text != null && o.text !== '' ? o.text : (isBus ? val : ''),
      align: o.align,
      fontSize: o.fontSize,
      textColor: o.textColor,
      color: o.color,
      fill: o.fill
    });
  };

  const es = [...row.edges].sort((a, b) => a.t - b.t);
  for (const e of es) {
    const t = clamp(e.t, 0, S.span);
    push(t0, t, v, src);
    t0 = t;
    v = e[key];
    src = e;
  }
  push(t0, S.span, v, src);
  if (!out.length) push(0, S.span, v, null);
  return out;
}

/** 边沿是否绘制为理想（垂直）边沿 */
function idealOf(row, seg) {
  if (seg && seg.src && seg.src.ideal != null) return !!seg.src.ideal;
  return !!row.ideal;
}

function stateAt(row, t) {
  const segs = stepSegments(row);
  for (const s of segs) if (t >= s.t0 && t <= s.t1) return s.v;
  return segs[segs.length - 1].v;
}

function levelOf(state, hi, lo, mid) {
  switch (state) {
    case '1': return hi;
    case '0': return lo;
    case 'Z': return mid;
    case 'WH': return hi + (lo - hi) * 0.3;
    case 'WL': return hi + (lo - hi) * 0.7;
    case 'HL': return mid;
    case 'GV': return hi;
    case 'GC': return lo;
    default: return lo;
  }
}

function clockParams(row) {
  const p = Math.max(0.5, +row.period || 20);
  const duty = clamp(+row.duty || 50, 1, 99) / 100;
  const off = ((+row.phase || 0) / 360) * p;
  return { p, duty, off };
}

/** 列出时钟的高电平区间 */
function clockIntervals(row) {
  const { p, duty, off } = clockParams(row);
  const out = [];
  const kStart = Math.floor((-off) / p) - 1;
  const kEnd = Math.ceil((S.span - off) / p) + 1;
  for (let k = kStart; k <= kEnd; k++) {
    const start = off + k * p;
    let hs = row.invert ? start + duty * p : start;
    let he = row.invert ? start + p : start + duty * p;
    if (he > 0 && hs < S.span) out.push([Math.max(0, hs), Math.min(S.span, he)]);
  }
  return out;
}

/** 时钟所有边沿时刻 */
function clockEdges(row) {
  const list = [];
  clockIntervals(row).forEach(([a, b]) => { list.push({ t: a, rising: true }); list.push({ t: b, rising: false }); });
  return list.filter(e => e.t > 0.001 && e.t < S.span - 0.001).sort((a, b) => a.t - b.t);
}

function rowEdgeTimes(row) {
  if (row.type === 'clock') return clockEdges(row).map(e => e.t);
  if (row.type === 'separator') return [];
  return row.edges.map(e => e.t).filter(t => t >= 0 && t <= S.span);
}

function snapT(t) { return Math.round(clamp(t, 0, S.span) * 2) / 2; }

/* ============================ 6. 渲染 ============================ */
const canvasEl = document.getElementById('canvas');

/** 主题菜单里的当前项打勾（缓存一下，避免每帧都操作 DOM） */
let themeMenuCache = '';
function syncThemeMenu() {
  const cur = S.theme || 'dark';
  if (themeMenuCache === cur) return;
  themeMenuCache = cur;
  $$('#menu-theme [data-theme]').forEach(b => {
    b.classList.toggle('on', b.getAttribute('data-theme') === cur);
  });
}

function render() {
  T = THEME[S.theme] || THEME.dark;
  document.documentElement.setAttribute('data-theme', S.theme || 'dark');
  syncThemeMenu();
  applyScale();
  layout();

  const W = contentW(), H = contentH;
  canvasEl.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  canvasEl.setAttribute('width', Math.round(W * zoom));
  canvasEl.setAttribute('height', Math.round(H * zoom));
  canvasEl.innerHTML = '';

  sv('rect', { x: 0, y: 0, width: W, height: H, fill: T.bg }, canvasEl);

  const defs = sv('defs', {}, canvasEl);
  const clip = sv('clipPath', { id: 'clipWave' }, defs);
  sv('rect', { x: LABEL_W, y: 0, width: W, height: H }, clip);
  S.rows.forEach(r => {
    const p = sv('pattern', {
      id: 'hatch-' + r.id, width: 7, height: 7,
      patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)'
    }, defs);
    sv('line', { x1: 0, y1: 0, x2: 0, y2: 7, stroke: r.color, 'stroke-width': 1.6, opacity: 0.55 }, p);
    const p2 = sv('pattern', {
      id: 'cross-' + r.id, width: 8, height: 8,
      patternUnits: 'userSpaceOnUse'
    }, defs);
    sv('line', { x1: 0, y1: 0, x2: 0, y2: 8, stroke: r.color, 'stroke-width': 1.2, opacity: 0.5 }, p2);
    sv('line', { x1: 0, y1: 0, x2: 8, y2: 0, stroke: r.color, 'stroke-width': 1.2, opacity: 0.5 }, p2);
  });

  drawGrid(W, H);

  const gRows = sv('g', {}, canvasEl);
  S.rows.forEach(r => drawRow(gRows, r));

  drawBreaks(canvasEl);
  drawAnnotations(canvasEl);
  drawAttachPreview(canvasEl);
  drawPreview(canvasEl);

  $('#empty-hint').classList.toggle('show', S.rows.length === 0);
  updateStatus();
}

function drawGrid(W, H) {
  sv('rect', { x: 0, y: 0, width: W, height: RULER_H, fill: T.ruler }, canvasEl);
  sv('line', { x1: 0, y1: RULER_H + 0.5, x2: W, y2: RULER_H + 0.5, stroke: T.grid, 'stroke-width': 1 }, canvasEl);

  const step0 = Math.max(0.05, +S.ruler.increment || 10);
  let step = step0;
  while (S.span / step > 600) step *= 2;
  const stepPx = step * PXPU * zoom;
  const minorPx = stepPx / 2;

  // 格子窄的时候标签会挤在一起，按最宽的那个标签算一下要隔几格标一次
  const widest = (S.ruler.prefix || '') + fmtNum(S.ruler.start + S.span) + (S.ruler.suffix || '');
  const labelGap = textWidth(widest, 10) + 10;
  const every = Math.max(1, Math.ceil(labelGap / Math.max(1, stepPx)));

  // 细网格
  if (minorPx >= 7) {
    for (let i = 0; ; i++) {
      const t = i * step + step / 2;
      if (t > S.span) break;
      const x = cx(t);
      sv('line', { x1: x, y1: RULER_H, x2: x, y2: H, stroke: T.gridMinor, 'stroke-width': 1 }, canvasEl);
    }
  }
  // 主网格 + 刻度
  const showLabels = S.ruler.showLabels !== false;
  for (let i = 0; ; i++) {
    const t = i * step;
    if (t > S.span + 0.0001) break;
    const x = cx(t);
    sv('line', { x1: x, y1: RULER_H, x2: x, y2: H, stroke: T.grid, 'stroke-width': 1 }, canvasEl);
    sv('line', { x1: x, y1: RULER_H - 5, x2: x, y2: RULER_H, stroke: T.faint, 'stroke-width': 1 }, canvasEl);
    if (showLabels && stepPx * every >= 40 && i % every === 0) {
      const label = (S.ruler.prefix || '') + fmtNum(S.ruler.start + i * step) + (S.ruler.suffix || '');
      sv('text', {
        x, y: 17, fill: T.dim, 'font-size': 10, 'font-family': FONT,
        'text-anchor': 'middle', 'pointer-events': 'none'
      }, canvasEl).textContent = label;
    }
  }

  // 行名列分隔线
  sv('line', { x1: LABEL_W + 0.5, y1: 0, x2: LABEL_W + 0.5, y2: H, stroke: T.grid, 'stroke-width': 1 }, canvasEl);
  sv('rect', { x: 0, y: RULER_H, width: LABEL_W, height: H - RULER_H, fill: T.labelBg, opacity: 0.55 }, canvasEl);

  // 标尺点击区域
  const hit = sv('rect', { x: 0, y: 0, width: W, height: RULER_H, fill: 'transparent' }, canvasEl);
  hit.setAttribute('data-ruler', '1');
  hit.style.cursor = 'pointer';
}

/* ---------------------------- 行 ---------------------------- */
function drawRow(parent, row) {
  const h = rowH(row), top = row._y;
  const hi = top + 9, lo = top + h - 9, mid = (hi + lo) / 2;
  const rowSel = !!(sel && sel.rowId === row.id);
  const g = sv('g', { class: 'row' + (rowSel ? ' sel' : '') }, parent);
  const isSelRow = sel && (sel.kind === 'row' && sel.rowId === row.id);
  const isSelSeg = sel && sel.kind === 'seg' && sel.rowId === row.id;

  // 行背景（命中 + 悬停）
  const bg = sv('rect', {
    x: 0, y: top, width: contentW(), height: h,
    fill: isSelRow ? (T.rowSel || T.accentSoft) : 'transparent'
  }, g);
  bg.setAttribute('data-row', row.id);
  bg.style.cursor = 'default';

  if (row.type !== 'separator') {
    const wave = sv('g', { 'clip-path': 'url(#clipWave)' }, g);
    if (row.type === 'clock') drawClockWave(wave, row, hi, lo, mid);
    else if (row.type === 'bus') drawBusWave(wave, row, hi, lo, mid);
    else drawSignalWave(wave, row, hi, lo, mid);

    if (row.differential) {
      const mir = sv('g', {
        'clip-path': 'url(#clipWave)',
        transform: 'translate(0,' + (2 * mid) + ') scale(1,-1)',
        opacity: 0.4, 'stroke-dasharray': '4 4'
      }, g);
      if (row.type === 'clock') drawClockWave(mir, row, hi, lo, mid);
      else if (row.type === 'bus') drawBusWave(mir, row, hi, lo, mid);
      else drawSignalWave(mir, row, hi, lo, mid);
    }

    // 边沿拖拽手柄
    if (row.type !== 'clock') {
      row.edges.forEach((e, i) => {
        if (e.t < 0 || e.t > S.span) return;
        const x = cx(e.t);
        const isSelEdge = sel && sel.kind === 'edge' && sel.rowId === row.id && sel.index === i;
        const mark = sv('line', {
          x1: x, y1: hi - 3, x2: x, y2: lo + 3,
          stroke: T.accent, 'stroke-width': 1, opacity: 0,
          'class': 'edge-mark' + (isSelEdge ? ' sel' : ''),
          'pointer-events': 'none'
        }, g);
        // 可拖动的节点圆点（导出时会被剔除）
        // 平时不显示，鼠标移到该行或选中该行时才出现，避免图面被一堆圆点占满。
        // 总线行的交叉标记本身是个 X，圆点用空心描边，免得把 X 中间挖出缺口。
        const cyDot = row.type === 'bus' ? mid
          : (levelOf(stateAt(row, Math.max(0, e.t - 0.01)), hi, lo, mid) +
            levelOf(e.state, hi, lo, mid)) / 2;
        sv('circle', {
          cx: x, cy: cyDot, r: isSelEdge ? 4.4 : 3.4,
          fill: isSelEdge ? T.sel : (row.type === 'bus' ? 'none' : T.bg),
          stroke: isSelEdge ? T.sel : T.accent,
          'stroke-width': isSelEdge ? 2 : 1.6,
          'class': 'edge-dot' + (isSelEdge ? ' sel' : ''),
          'pointer-events': 'none'
        }, g);
        const hit = sv('rect', {
          x: x - 7, y: top + 1, width: 14, height: h - 2, fill: 'transparent',
          'data-edge': i
        }, g);
        hit.setAttribute('data-row', row.id);
        hit.style.cursor = 'ew-resize';
      });
    }
  } else {
    drawSeparator(g, row, mid);
  }

  // 行名
  const labelSel = sel && sel.kind === 'row' && sel.rowId === row.id;
  const nameText = row.type === 'separator' ? (row.label || '') : row.name;
  const t = sv('text', {
    x: 12, y: mid + 4.5,
    fill: labelSel ? T.accent : (row.type === 'separator' ? T.dim : T.text),
    'font-size': row.type === 'separator' ? 10.5 : 12.5,
    'font-family': FONT,
    'letter-spacing': row.type === 'separator' ? 1.4 : 0,
    'font-weight': labelSel ? 600 : 400
  }, g);
  t.textContent = truncate(nameText, 17);
  t.setAttribute('data-row', row.id);
  t.setAttribute('data-name', '1');
  t.style.cursor = 'text';

  // 选中态边框
  if (isSelRow) {
    sv('rect', {
      x: 2, y: top - 2, width: contentW() - 4, height: h + 4,
      fill: 'none', stroke: T.accent, 'stroke-width': 1, 'stroke-dasharray': '4 3', rx: 4, opacity: 0.6,
      'pointer-events': 'none'
    }, g);
  }
  if (isSelSeg) {
    const segs = stepSegments(row);
    const s = segs[sel.index];
    if (s) {
      sv('rect', {
        x: cx(s.t0) + 0.5, y: top + 1, width: Math.max(1, cx(s.t1) - cx(s.t0) - 1), height: h - 2,
        fill: 'none', stroke: T.sel, 'stroke-width': 1.2, 'stroke-dasharray': '3 3', opacity: 0.85,
        'pointer-events': 'none'
      }, g);
    }
  }
  if (sel && sel.kind === 'edge' && sel.rowId === row.id && !edgeDragActive) {
    const e = row.edges[sel.index];
    if (e) {
      sv('circle', { cx: cx(e.t), cy: hi - 6, r: 3.2, fill: T.sel, 'pointer-events': 'none' }, g);
      const tag = sv('g', { 'pointer-events': 'none' }, g);
      const label = fmtNum(e.t) + (S.ruler.suffix || '');
      const w = label.length * 6.2 + 10;
      sv('rect', {
        x: cx(e.t) - w / 2, y: top - 15, width: w, height: 14,
        fill: T.sel, rx: 3, opacity: 0.95
      }, tag);
      sv('text', {
        x: cx(e.t), y: top - 4.5, fill: T.bg, 'font-size': 9.5, 'font-family': FONT,
        'text-anchor': 'middle'
      }, tag).textContent = label;
    }
  }
}

function truncate(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function drawSeparator(g, row, mid) {
  const x0 = LABEL_W + 6, x1 = contentW() - 20;
  if (row.rule !== 'none') {
    sv('line', {
      x1: x0, y1: mid, x2: x1, y2: mid,
      stroke: wc(row.color), 'stroke-width': 1,
      'stroke-dasharray': row.rule === 'dashed' ? '5 4' : 'none',
      opacity: 0.5
    }, g);
  }
  if (row.label) {
    const w = row.label.length * 7 + 12;
    sv('rect', { x: x0, y: mid - 8, width: w, height: 16, fill: T.bg }, g);
    sv('text', {
      x: x0 + 6, y: mid + 3.5, fill: wc(row.color), 'font-size': 10,
      'font-family': FONT, 'letter-spacing': 1.2
    }, g).textContent = row.label;
  }
}

function textWidth(str, size) {
  let w = 0;
  for (const ch of String(str || '')) {
    const code = ch.codePointAt(0);
    w += (code > 0x2e80) ? size : size * 0.58;
  }
  return w;
}

/**
 * 斜率边沿的半宽（模型坐标）。
 * 以前按固定的 0.8 个时间单位算，可是每单位像素会随「刻度增量 / 每格宽度」变化：
 * 增量调到 1 时 0.8 单位会被拉成 60 多像素的缓坡，看着完全不像跳变。
 * 现在按「一格宽度的固定比例」算，任何刻度密度下都是同样陡的斜边。
 */
function edgeFtPx() {
  const inc = Math.max(0.05, +S.ruler.increment || 10);
  const cellPx = PXPU * inc;          // 一格实际占多少像素
  return clamp(cellPx * FT, 0.8, 12); // 上下限挡住极密/极疏的刻度
}

/* ---------------------------- 信号 ---------------------------- */
function drawSignalWave(g, row, hi, lo, mid) {
  const segs = stepSegments(row);
  const ftPx = edgeFtPx();

  segs.forEach((s, i) => {
    const X0 = cx(s.t0), X1 = cx(s.t1);
    const y = levelOf(s.v, hi, lo, mid);
    // 只有真的发生电平跳变的地方才要留出斜边宽度；
    // 相邻两段电平相同时若也留缝，就会在波形上留下一个没有任何连线的空洞。
    const yL = i > 0 ? levelOf(segs[i - 1].v, hi, lo, mid) : y;
    const yR = i < segs.length - 1 ? levelOf(segs[i + 1].v, hi, lo, mid) : y;
    const padL = (i > 0 && !idealOf(row, s) && Math.abs(yL - y) >= 0.4) ? ftPx : 0;
    const padR = (i < segs.length - 1 && !idealOf(row, segs[i + 1]) && Math.abs(yR - y) >= 0.4) ? ftPx : 0;
    const a = X0 + padL, b = Math.max(a + 0.5, X1 - padR);
    const color = wc(s.color || row.color);

    // 段填充
    if (s.fill && s.fill !== 'none') {
      if (s.fill === 'solid') {
        sv('rect', { x: a, y: hi, width: Math.max(0.5, b - a), height: lo - hi, fill: color, opacity: 0.16 }, g);
      } else if (s.fill === 'hatch') {
        sv('rect', { x: a, y: hi, width: Math.max(0.5, b - a), height: lo - hi, fill: 'url(#hatch-' + row.id + ')', opacity: 0.75 }, g);
      } else if (s.fill === 'cross') {
        sv('rect', { x: a, y: hi, width: Math.max(0.5, b - a), height: lo - hi, fill: 'url(#cross-' + row.id + ')', opacity: 0.75 }, g);
      }
    }

    if (s.v === 'HL') {
      sv('rect', {
        x: a, y: hi, width: Math.max(0.5, b - a), height: lo - hi,
        fill: 'url(#hatch-' + row.id + ')', stroke: 'none'
      }, g);
      sv('line', { x1: a, y1: hi, x2: b, y2: hi, stroke: color, 'stroke-width': 1.4 }, g);
      sv('line', { x1: a, y1: lo, x2: b, y2: lo, stroke: color, 'stroke-width': 1.4 }, g);
    } else if (s.v === 'Z' || s.v === 'WH' || s.v === 'WL') {
      sv('line', {
        x1: a, y1: y, x2: b, y2: y, stroke: color,
        'stroke-width': s.v === 'Z' ? 1.3 : 1.9,
        'stroke-dasharray': '5 4',
        opacity: s.v === 'Z' ? 0.85 : 0.5
      }, g);
    } else if (s.v === 'GV' || s.v === 'GC') {
      const base = s.v === 'GV' ? hi : lo;
      const peak = s.v === 'GV' ? lo : hi;
      const cxm = (a + b) / 2;
      const half = Math.min((b - a) / 2, 0.6 * PXPU);
      const d = 'M ' + a + ' ' + base +
        ' L ' + (cxm - half) + ' ' + base +
        ' L ' + cxm + ' ' + peak +
        ' L ' + (cxm + half) + ' ' + base +
        ' L ' + b + ' ' + base;
      sv('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round' }, g);
    } else {
      sv('line', { x1: a, y1: y, x2: b, y2: y, stroke: color, 'stroke-width': 2 }, g);
    }

    // 段内文字
    if (s.text) {
      const tx0 = a + 4, tx1 = b - 4;
      if (tx1 - tx0 > 6) {
        const anchor = s.align === 'left' ? 'start' : s.align === 'right' ? 'end' : 'middle';
        const txPos = s.align === 'left' ? tx0 : s.align === 'right' ? tx1 : (a + b) / 2;
        sv('text', {
          x: txPos, y: mid + 4, fill: wc(s.textColor || row.color),
          'font-size': s.fontSize || 10.5, 'font-family': FONT, 'text-anchor': anchor,
          'pointer-events': 'none'
        }, g).textContent = s.text;
      }
    }

    // 段点击区
    const hit = sv('rect', {
      x: X0, y: row._y + 1, width: Math.max(1, X1 - X0), height: rowH(row) - 2,
      fill: 'transparent', 'data-seg': i
    }, g);
    hit.setAttribute('data-row', row.id);
  });

  // 连接边沿
  for (let i = 1; i < segs.length; i++) {
    const prev = segs[i - 1], cur = segs[i];
    const X = cx(cur.t0);
    const y1 = levelOf(prev.v, hi, lo, mid), y2 = levelOf(cur.v, hi, lo, mid);
    if (Math.abs(y1 - y2) < 0.4) continue;
    const color = wc(cur.color || row.color);
    if (idealOf(row, cur)) {
      sv('line', { x1: X, y1, x2: X, y2, stroke: color, 'stroke-width': 2 }, g);
    } else {
      sv('line', {
        x1: X - ftPx, y1, x2: X + ftPx, y2: y2,
        stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round'
      }, g);
    }
    // 上升/下降箭头
    const rising = y2 < y1;
    if ((rising && row.riseArrows) || (!rising && row.fallArrows)) {
      const ax = X, ay = (y1 + y2) / 2;
      const dir = rising ? -1 : 1;
      sv('polygon', {
        points: ax + ',' + ay + ' ' + (ax - 3.4) + ',' + (ay + dir * 6) + ' ' + (ax + 3.4) + ',' + (ay + dir * 6),
        fill: color,
        'pointer-events': 'none'
      }, g);
    }
  }
}

/* ---------------------------- 总线 ---------------------------- */
function drawBusWave(g, row, hi, lo, mid) {
  const segs = stepSegments(row);
  const ideal = !!row.ideal;
  const color = wc(row.color);

  const busVal = (i) => String(segs[i].v == null ? '' : segs[i].v);
  const busChanged = (i, j) => busVal(i) !== busVal(j);
  segs.forEach((s, i) => {
    const X0 = cx(s.t0), X1 = cx(s.t1);
    // 上下边线在跳变处要留出 X 的高度（hw=6），端点正好落在 X 的四个角上，
    // 否则横线会被 X 的斜边压住一截，接缝处看起来有个小缺口。
    // 值没变的相邻段不留缝，否则会出现没有交叉标记填补的空洞。
    const padL = i === 0 ? 2 : (busChanged(i - 1, i) ? 6 : 0);
    const padR = i === segs.length - 1 ? 2 : (busChanged(i, i + 1) ? 6 : 0);
    const a = X0 + padL, b = Math.max(a + 1, X1 - padR);
    if (s.fill === 'solid') {
      sv('rect', { x: a, y: hi, width: b - a, height: lo - hi, fill: color, opacity: 0.16 }, g);
    } else if (s.fill === 'hatch') {
      sv('rect', { x: a, y: hi, width: b - a, height: lo - hi, fill: 'url(#hatch-' + row.id + ')', opacity: 0.7 }, g);
    } else if (s.fill === 'cross') {
      sv('rect', { x: a, y: hi, width: b - a, height: lo - hi, fill: 'url(#cross-' + row.id + ')', opacity: 0.7 }, g);
    } else {
      sv('rect', { x: a, y: hi, width: b - a, height: lo - hi, fill: color, opacity: 0.07 }, g);
    }
    sv('line', { x1: a, y1: hi, x2: b, y2: hi, stroke: color, 'stroke-width': 1.6 }, g);
    sv('line', { x1: a, y1: lo, x2: b, y2: lo, stroke: color, 'stroke-width': 1.6 }, g);

    if (s.v) {
      sv('text', {
        x: (a + b) / 2, y: mid + 4.2, fill: s.textColor || color,
        'font-size': s.fontSize || 11, 'font-family': FONT, 'text-anchor': 'middle',
        'pointer-events': 'none'
      }, g).textContent = s.v;
    }

    const hit = sv('rect', {
      x: X0, y: row._y + 1, width: Math.max(1, X1 - X0), height: rowH(row) - 2,
      fill: 'transparent', 'data-seg': i
    }, g);
    hit.setAttribute('data-row', row.id);
  });

  // 不确定交叉标记（只有值真的变了才画）
  for (let i = 1; i < segs.length; i++) {
    if (!busChanged(i - 1, i)) continue;
    const X = cx(segs[i].t0);
    const hw = ideal ? 0 : 6;
    if (ideal) {
      sv('line', { x1: X, y1: hi, x2: X, y2: lo, stroke: color, 'stroke-width': 1.4 }, g);
    } else {
      sv('line', { x1: X - hw, y1: hi, x2: X + hw, y2: lo, stroke: color, 'stroke-width': 1.4 }, g);
      sv('line', { x1: X - hw, y1: lo, x2: X + hw, y2: hi, stroke: color, 'stroke-width': 1.4 }, g);
    }
  }
}

/* ---------------------------- 时钟 ---------------------------- */
/** 所有行的底边（参考线画到这里为止，避免在空白处拖一条虚线） */
function rowsBottom() {
  let b = 0;
  for (const r of S.rows) b = Math.max(b, r._y + rowH(r));
  return b || (contentH - PAD_BOTTOM / 2);
}

function drawClockWave(g, row, hi, lo, mid) {
  const iv = clockIntervals(row);
  const color = wc(row.color);
  const ideal = !!row.ideal;
  const ftPx = edgeFtPx();

  // 构造电平序列
  let level = 0;
  const bounds = [];
  iv.forEach(([a, b]) => { bounds.push({ t: a, lvl: 1 }); bounds.push({ t: b, lvl: 0 }); });
  bounds.sort((p, q) => p.t - q.t);

  // 起点电平
  for (const [a, b] of iv) { if (a <= 0 && b > 0) { level = 1; break; } }

  let d = 'M ' + cx(0) + ' ' + (level ? hi : lo);
  for (const b of bounds) {
    const X = cx(b.t);
    const y1 = level ? hi : lo, y2 = b.lvl ? hi : lo;
    if (ideal) {
      d += ' L ' + X + ' ' + y1 + ' L ' + X + ' ' + y2;
    } else {
      d += ' L ' + (X - ftPx) + ' ' + y1 + ' L ' + (X + ftPx) + ' ' + y2;
    }
    level = b.lvl;
  }
  d += ' L ' + cx(S.span) + ' ' + (level ? hi : lo);

  sv('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'miter' }, g);

  // 上升/下降箭头
  bounds.forEach(b => {
    const rising = b.lvl === 1;
    if ((rising && !row.riseArrows) || (!rising && !row.fallArrows)) return;
    const X = cx(b.t), y = (hi + lo) / 2, dir = rising ? -1 : 1;
    sv('polygon', {
      points: X + ',' + y + ' ' + (X - 3.4) + ',' + (y + dir * 6) + ' ' + (X + 3.4) + ',' + (y + dir * 6),
      fill: color, 'pointer-events': 'none'
    }, g);
  });

  // 时钟的拖拽命中区（整个波形带）
  const hit = sv('rect', {
    x: cx(0), y: row._y + 1, width: Math.max(1, cx(S.span) - cx(0)), height: rowH(row) - 2,
    fill: 'transparent', 'data-clock': row.id
  }, g);
  hit.setAttribute('data-row', row.id);
  hit.style.cursor = 'grab';

  // 参考线
  if (row.riseGuide || row.fallGuide) {
    const bottom = rowsBottom();
    bounds.forEach(b => {
      const rising = b.lvl === 1;
      if ((rising && !row.riseGuide) || (!rising && !row.fallGuide)) return;
      sv('line', {
        x1: cx(b.t), y1: row._y + rowH(row), x2: cx(b.t), y2: bottom,
        stroke: color, 'stroke-width': 1, 'stroke-dasharray': '2 6', opacity: 0.24,
        'pointer-events': 'none'
      }, g);
    });
  }
}

/* ---------------------------- 标注 ---------------------------- */
function resolveAnn(a) {
  const p = { x1: a.x1 || 0, y1: a.y1 || 0, x2: a.x2 || 0, y2: a.y2 || 0 };
  if (a.a1) {
    const r = rowById(a.a1.rowId);
    if (r) { p.x1 = cx(a.a1.t); p.y1 = rowMid(r) + (a.a1.dy || 0); }
  }
  if (a.a2) {
    const r = rowById(a.a2.rowId);
    if (r) { p.x2 = cx(a.a2.t); p.y2 = rowMid(r) + (a.a2.dy || 0); }
  }
  if (a.type === 'text') {
    p.x1 = a.x || 0; p.y1 = a.y || 0;
    if (a.a1) {
      const r = rowById(a.a1.rowId);
      if (r) { p.x1 = cx(a.a1.t); p.y1 = rowMid(r) + (a.a1.dy || 0); }
    }
  }
  return p;
}

function drawAnnotations(parent) {
  const gAnn = sv('g', {}, parent);
  S.annotations.forEach(a => {
    const selected = sel && sel.kind === 'ann' && sel.id === a.id;
    const p = resolveAnn(a);
    const color = wc(a.color || T.accent);
    const ga = sv('g', {}, gAnn);

    if (a.type === 'text') {
      const lines = String(a.text || '').split('\n');
      const size = a.size || 11;
      const lh = size * 1.45;
      let maxw = 0;
      lines.forEach(l => { maxw = Math.max(maxw, l.length * size * 0.62); });
      const padx = 5, pady = 3;
      const bx = p.x1 - (a.align === 'center' ? maxw / 2 : 0) - padx;
      const by = p.y1 - size - pady + 2;
      sv('rect', {
        x: bx, y: by, width: maxw + padx * 2, height: lines.length * lh + pady * 2,
        fill: T.noteBg, stroke: selected ? T.sel : T.noteBorder, rx: 3, opacity: 0.96
      }, ga);
      const tEl = sv('text', {
        x: p.x1 - (a.align === 'center' ? maxw / 2 : 0), y: p.y1, fill: wc(a.color || T.text),
        'font-size': size, 'font-family': FONT, 'pointer-events': 'none'
      }, ga);
      lines.forEach((l, i) => {
        sv('tspan', { x: p.x1 - (a.align === 'center' ? maxw / 2 : 0), dy: i === 0 ? 0 : lh }, tEl).textContent = l;
      });
      const hit = sv('rect', {
        x: bx, y: by, width: maxw + padx * 2, height: lines.length * lh + pady * 2,
        fill: 'transparent', 'data-ann': a.id
      }, ga);
      hit.style.cursor = 'move';
      if (selected) sv('rect', {
        x: bx - 3, y: by - 3, width: maxw + padx * 2 + 6, height: lines.length * lh + pady * 2 + 6,
        fill: 'none', stroke: T.sel, 'stroke-width': 1, 'stroke-dasharray': '3 3', rx: 4, 'pointer-events': 'none'
      }, ga);
    }

    if (a.type === 'arrow') {
      let c1, c2;
      if (a.curve) {
        c1 = a.c1 || { x: p.x1 + (p.x2 - p.x1) * 0.3, y: p.y1 - 30 };
        c2 = a.c2 || { x: p.x1 + (p.x2 - p.x1) * 0.7, y: p.y2 - 30 };
      }
      const d = a.curve
        ? 'M ' + p.x1 + ' ' + p.y1 + ' C ' + c1.x + ' ' + c1.y + ', ' + c2.x + ' ' + c2.y + ', ' + p.x2 + ' ' + p.y2
        : 'M ' + p.x1 + ' ' + p.y1 + ' L ' + p.x2 + ' ' + p.y2;

      sv('path', {
        d, fill: 'none', stroke: selected ? T.sel : color,
        'stroke-width': selected ? 2 : 1.6, 'pointer-events': 'none'
      }, ga);

      const ang = a.curve
        ? Math.atan2(p.y2 - c2.y, p.x2 - c2.x)
        : Math.atan2(p.y2 - p.y1, p.x2 - p.x1);
      const ang2 = a.curve
        ? Math.atan2(p.y1 - c1.y, p.x1 - c1.x)
        : Math.atan2(p.y1 - p.y2, p.x1 - p.x2);
      if (a.endArrow !== false) arrowHead(ga, p.x2, p.y2, ang, color);
      if (a.startArrow) arrowHead(ga, p.x1, p.y1, ang2, color);

      let labelText = a.label || '';
      if (a.showDt && a.a1 && a.a2) {
        const dt = Math.abs(a.a2.t - a.a1.t);
        labelText = (a.label ? a.label + ' = ' : 'Δt = ') + fmtNum(dt) + (S.ruler.suffix || '');
      }
      if (labelText) {
        const mx = (p.x1 + p.x2) / 2 + 4, my = (p.y1 + p.y2) / 2 - 6;
        // 不铺底色块，改用描边光晕：文字压到波形上也能读，又不会挡掉后面的线
        sv('text', {
          x: mx, y: my, fill: color, 'font-size': 10, 'font-family': FONT,
          'text-anchor': 'middle', 'pointer-events': 'none',
          stroke: T.bg, 'stroke-width': 3, 'stroke-linejoin': 'round', 'paint-order': 'stroke'
        }, ga).textContent = labelText;
      }

      const hit = sv('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 12, 'data-ann': a.id }, ga);
      hit.style.cursor = 'move';

      if (selected) {
        [
          [p.x1, p.y1, 'a1'], [p.x2, p.y2, 'a2']
        ].forEach(([x, y, hk]) => {
          const c = sv('circle', {
            cx: x, cy: y, r: 4.5, fill: T.bg, stroke: T.sel, 'stroke-width': 1.5,
            'data-handle': hk, 'data-ann': a.id
          }, ga);
          c.style.cursor = 'crosshair';
        });
        if (a.curve && c1 && c2) {
          [[c1, 'c1'], [c2, 'c2']].forEach(([pt, hk]) => {
            const c = sv('circle', {
              cx: pt.x, cy: pt.y, r: 3.5, fill: T.sel, opacity: 0.7,
              'data-handle': hk, 'data-ann': a.id
            }, ga);
            c.style.cursor = 'move';
            sv('line', { x1: pt.x, y1: pt.y, x2: hk === 'c1' ? p.x1 : p.x2, y2: hk === 'c1' ? p.y1 : p.y2, stroke: T.sel, 'stroke-dasharray': '2 3', opacity: 0.5, 'pointer-events': 'none' }, ga);
          });
        }
      }
    }

    if (a.type === 'bracket') {
      const x1 = Math.min(p.x1, p.x2), x2 = Math.max(p.x1, p.x2);
      const y = p.y1;
      const col = selected ? T.sel : color;
      const dt = Math.abs(tx(p.x2) - tx(p.x1));
      let label = fmtNum(dt) + (S.ruler.suffix || '');
      if (a.mode === 'custom') {
        label = a.label || '';
        if (a.showDt) label = (label ? label + ' = ' : '') + fmtNum(dt) + (S.ruler.suffix || '');
      }
      const ext = 9, aw = 6.5, ah = 3, mid = (x1 + x2) / 2;

      // 两端向上的虚线引出线：指到被测时刻
      [x1, x2].forEach(x => {
        sv('line', {
          x1: x, y1: y + 2.5, x2: x, y2: y - ext,
          stroke: col, 'stroke-width': 1, 'stroke-dasharray': '2 2.5', opacity: 0.6,
          'pointer-events': 'none'
        }, ga);
      });

      // 若两端挂在不同波形上，再补一段竖向虚线接到另一端
      if (Math.abs(p.y1 - p.y2) > 4) {
        sv('line', {
          x1: p.x2, y1: y, x2: p.x2, y2: p.y2,
          stroke: col, 'stroke-width': 1, 'stroke-dasharray': '2 2.5', opacity: 0.6,
          'pointer-events': 'none'
        }, ga);
        sv('line', {
          x1: p.x2 - 4, y1: p.y2, x2: p.x2 + 4, y2: p.y2,
          stroke: col, 'stroke-width': 1, opacity: 0.75, 'pointer-events': 'none'
        }, ga);
      }

      // 尺寸线：标签够宽时中间断开、文字嵌在线上；否则把标签放到箭头旁边
      const lw = label ? textWidth(label, 10) + 12 : 0;
      const moved = !!(a.lx || a.ly);          // 标签被手动拖走过
      const fits = label && (x2 - x1) > lw + 2 * aw + 10;
      if (fits && !moved) {
        sv('line', { x1, y1: y, x2: mid - lw / 2, y2: y, stroke: col, 'stroke-width': 1.4, 'pointer-events': 'none' }, ga);
        sv('line', { x1: mid + lw / 2, y1: y, x2, y2: y, stroke: col, 'stroke-width': 1.4, 'pointer-events': 'none' }, ga);
      } else {
        sv('line', { x1, y1: y, x2, y2: y, stroke: col, 'stroke-width': 1.4, 'pointer-events': 'none' }, ga);
      }

      let labelBox = null;
      if (label) {
        // 默认位置：够宽就压在线上居中，否则放到箭头外侧
        let bx, by = y - 7.5;
        if (fits) bx = mid - lw / 2;
        else {
          bx = x2 + 4;
          if (bx + lw > contentW() - 8) bx = Math.max(LABEL_W + 2, x1 - 4 - lw);
        }
        // 手动拖动的偏移
        bx += a.lx || 0;
        by += a.ly || 0;
        labelBox = { x: bx, y: by, w: lw };
        // 拖离原位后补一条细引线，指明它标的是哪段
        if (moved) {
          const lcx = bx + lw / 2, lcy = by + 7.5;
          sv('line', {
            x1: lcx, y1: lcy, x2: mid, y2: y,
            stroke: col, 'stroke-width': 1, 'stroke-dasharray': '2 3', opacity: 0.5,
            'pointer-events': 'none'
          }, ga);
        }
        // 同样不铺底色块：只给文字加一圈描边光晕，波形线从字缝里透出来
        sv('text', {
          x: bx + lw / 2, y: by + 11, fill: col, 'font-size': 10, 'font-family': FONT,
          'text-anchor': 'middle', 'pointer-events': 'none',
          stroke: T.bg, 'stroke-width': 3, 'stroke-linejoin': 'round', 'paint-order': 'stroke'
        }, ga).textContent = label;
      }

      // 两端箭头，朝外指向被测点
      sv('polygon', {
        points: x1 + ',' + y + ' ' + (x1 + aw) + ',' + (y - ah) + ' ' + (x1 + aw) + ',' + (y + ah),
        fill: col, 'pointer-events': 'none'
      }, ga);
      sv('polygon', {
        points: x2 + ',' + y + ' ' + (x2 - aw) + ',' + (y - ah) + ' ' + (x2 - aw) + ',' + (y + ah),
        fill: col, 'pointer-events': 'none'
      }, ga);

      // 选中态：画一圈虚线框，颜色变了但颜色本来就接近时也能一眼看出选中
      if (selected) {
        const left = Math.min(x1, labelBox ? labelBox.x : x1) - 5;
        const right = Math.max(x2, labelBox ? labelBox.x + labelBox.w : x2) + 5;
        const top = Math.min(y - ext - 5, labelBox ? labelBox.y - 3 : y - ext - 5);
        const bot = Math.max(y + 6, labelBox ? labelBox.y + 18 : y + 6);
        sv('rect', {
          x: left, y: top, width: right - left, height: bot - top,
          fill: 'none', stroke: T.sel, 'stroke-width': 1, 'stroke-dasharray': '3 3',
          opacity: 0.85, rx: 3, 'pointer-events': 'none'
        }, ga);
      }

      const hit = sv('rect', {
        x: x1 - 6, y: y - 11, width: Math.max(2, x2 - x1) + 12, height: 22,
        fill: 'transparent', 'data-ann': a.id
      }, ga);
      hit.style.cursor = 'move';

      // 标签热区要放在整体热区之后，否则会被盖住点不到
      if (labelBox) {
        const lh2 = sv('rect', {
          x: labelBox.x - 2, y: labelBox.y - 2, width: labelBox.w + 4, height: 19,
          fill: 'transparent', 'data-ann': a.id, 'data-handle': 'label'
        }, ga);
        lh2.style.cursor = 'move';
      }
    }
  });
}

function arrowHead(g, x, y, ang, color) {
  const len = 9, spread = 0.42;
  const x1 = x - len * Math.cos(ang - spread);
  const y1 = y - len * Math.sin(ang - spread);
  const x2 = x - len * Math.cos(ang + spread);
  const y2 = y - len * Math.sin(ang + spread);
  sv('polygon', {
    points: x + ',' + y + ' ' + x1 + ',' + y1 + ' ' + x2 + ',' + y2,
    fill: color, 'pointer-events': 'none'
  }, g);
}

function drawAttachPreview(parent) {
  if (!attachPreview) return;
  const r = rowById(attachPreview.rowId);
  if (!r) return;
  const W = contentW();
  const x = cx(attachPreview.t);
  const h = rowH(r);
  sv('rect', {
    x: LABEL_W, y: r._y - 1, width: Math.max(0, W - LABEL_W), height: h + 2,
    fill: T.accent, opacity: 0.1, 'pointer-events': 'none'
  }, parent);
  sv('line', {
    x1: LABEL_W, y1: r._y - 0.5, x2: W, y2: r._y - 0.5,
    stroke: T.accent, 'stroke-width': 1, opacity: 0.35, 'pointer-events': 'none'
  }, parent);
  sv('line', {
    x1: LABEL_W, y1: r._y + h + 0.5, x2: W, y2: r._y + h + 0.5,
    stroke: T.accent, 'stroke-width': 1, opacity: 0.35, 'pointer-events': 'none'
  }, parent);
  sv('line', {
    x1: x, y1: r._y + 2, x2: x, y2: r._y + h - 2,
    stroke: T.accent, 'stroke-width': 1, 'stroke-dasharray': '2 3', opacity: 0.85, 'pointer-events': 'none'
  }, parent);
  sv('circle', {
    cx: x, cy: attachPreview.y, r: 3.4,
    fill: T.bg, stroke: T.accent, 'stroke-width': 1.6, 'pointer-events': 'none'
  }, parent);
}

function drawPreview(parent) {
  if (!pending) return;
  const a = pending.ann;
  const p = resolveAnn(a);
  const color = T.sel;
  const g = sv('g', { opacity: 0.85, 'pointer-events': 'none' }, parent);
  if (a.type === 'arrow') {
    sv('line', { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, stroke: color, 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }, g);
    if (p.x2 || p.y2) arrowHead(g, p.x2, p.y2, Math.atan2(p.y2 - p.y1, p.x2 - p.x1), color);
  } else if (a.type === 'bracket') {
    const x1 = Math.min(p.x1, p.x2), x2 = Math.max(p.x1, p.x2);
    sv('path', {
      d: 'M ' + x1 + ' ' + (p.y1 - 7) + ' L ' + x1 + ' ' + p.y1 + ' L ' + x2 + ' ' + p.y1 + ' L ' + x2 + ' ' + (p.y1 - 7),
      fill: 'none', stroke: color, 'stroke-width': 1.5, 'stroke-dasharray': '4 3'
    }, g);
  }
}

/* ---------------------------- 时间断点 ---------------------------- */
function drawBreaks(parent) {
  S.breaks.forEach(b => {
    const rows = b.scope === 'all' ? S.rows : S.rows.filter(r => r.id === b.rowId);
    const X = cx(b.t);
    const selected = sel && sel.kind === 'break' && sel.id === b.id;
    rows.forEach(r => {
      const top = r._y + 2, bot = r._y + rowH(r) - 2;
      const color = wc(b.color || r.color);
      sv('rect', { x: X - 9, y: top - 1, width: 18, height: bot - top + 2, fill: T.bg }, parent);
      // 平滑 S 形断点（三次贝塞尔），比特角折线更柔和
      const h = bot - top;
      const wave = (xc) => 'M ' + xc + ' ' + top +
        ' C ' + (xc + 4) + ' ' + (top + h * 0.17) + ', ' + (xc + 4) + ' ' + (top + h * 0.33) + ', ' + xc + ' ' + (top + h * 0.5) +
        ' C ' + (xc - 4) + ' ' + (top + h * 0.67) + ', ' + (xc - 4) + ' ' + (top + h * 0.83) + ', ' + xc + ' ' + bot;
      sv('path', {
        d: wave(X - 4.5), fill: 'none', stroke: color, 'stroke-width': 1.6,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round'
      }, parent);
      sv('path', {
        d: wave(X + 4.5), fill: 'none', stroke: color, 'stroke-width': 1.6,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round'
      }, parent);
    });
    const hit = sv('rect', {
      x: X - 9, y: RULER_H, width: 18, height: contentH - RULER_H, fill: 'transparent', 'data-break': b.id
    }, parent);
    hit.style.cursor = 'ew-resize';
    if (selected) {
      sv('line', {
        x1: X, y1: RULER_H, x2: X, y2: contentH - PAD_BOTTOM / 2,
        stroke: T.sel, 'stroke-width': 1, 'stroke-dasharray': '2 3', 'pointer-events': 'none'
      }, parent);
    }
  });
}

function updateStatus() {
  const info = $('#status-info');
  info.textContent = S.rows.length + ' 行 · ' + S.annotations.length + ' 标注 · ' + Math.round(zoom * 100) + '%';
  $('#zoom-label').textContent = Math.round(zoom * 100) + '%';
  const hints = {
    select: '拖动波形上的圆点调边沿 · 双击波形翻转电平 · 右键改状态',
    text: '点击画布放置文本',
    arrow: '点击起点，再点击终点',
    bezier: '点击起点，再点击终点（曲线）',
    bracket: '点击两点生成区间标注',
    break: '点击某行插入时间断点（Shift = 全部行）'
  };
  $('#status-hint').textContent = hints[tool] || '';
  const names = { select: '选择工具', text: '文本工具', arrow: '箭头工具', bezier: '曲线工具', bracket: '区间工具', break: '断点工具' };
  $('#status-tool').textContent = names[tool] || '';
}

/* ============================ 7. 选择与属性面板 ============================ */
function select(s) {
  sel = s;
  fixSel();
  render();
  renderProps();
}

function fixSel() {
  if (!sel) return;
  if (sel.kind === 'row' || sel.kind === 'seg' || sel.kind === 'edge') {
    const r = rowById(sel.rowId);
    if (!r) { sel = null; return; }
    if (r.type === 'separator' && sel.kind !== 'row') sel = { kind: 'row', rowId: r.id };
    if (sel.kind === 'edge' && !r.edges[sel.index]) sel = { kind: 'row', rowId: r.id };
    if (sel.kind === 'seg') {
      const segs = stepSegments(r);
      if (!segs[sel.index]) sel = { kind: 'row', rowId: r.id };
    }
  } else if (sel.kind === 'ann') {
    if (!S.annotations.some(a => a.id === sel.id)) sel = null;
  } else if (sel.kind === 'break') {
    if (!S.breaks.some(b => b.id === sel.id)) sel = null;
  }
}

const propsBody = $('#props-body');

function pGroup(title) {
  const g = mk('div', { class: 'p-group' }, propsBody);
  if (title) mk('div', { class: 'p-title', text: title }, g);
  const b = mk('div', { class: 'p-body' }, g);
  return b;
}
function pField(parent, label, node) {
  const w = mk('label', { class: 'p-field' }, parent);
  mk('span', { class: 'p-label', text: label }, w);
  w.appendChild(node);
  return w;
}
function pRow(parent) { return mk('div', { class: 'p-row' }, parent); }

function fText(val, onInput, placeholder) {
  const i = mk('input', { type: 'text', value: val == null ? '' : val });
  if (placeholder) i.placeholder = placeholder;
  i.addEventListener('input', () => onInput(i.value));
  return i;
}
function fNum(val, onInput, opts) {
  opts = opts || {};
  const i = mk('input', { type: 'number', value: fmtNum(val == null ? 0 : val) });
  if (opts.step != null) i.step = opts.step;
  if (opts.min != null) i.min = opts.min;
  if (opts.max != null) i.max = opts.max;
  i.addEventListener('input', () => {
    const v = parseFloat(i.value);
    if (!isNaN(v)) onInput(v);
  });
  return i;
}
function fCheck(label, checked, onChange) {
  const w = mk('label', { class: 'p-check' });
  const i = mk('input', { type: 'checkbox' });
  i.checked = !!checked;
  i.addEventListener('change', () => onChange(i.checked));
  w.appendChild(i);
  mk('span', { text: label }, w);
  return w;
}
function fColor(val, onChange) {
  const wrap = mk('div', { class: 'p-color' });
  const i = mk('input', { type: 'color', value: val || '#4fbdba' }, wrap);
  const hex = mk('input', { type: 'text', value: String(val || '#4fbdba').toUpperCase() }, wrap);
  hex.readOnly = true;
  i.addEventListener('input', () => { hex.value = i.value.toUpperCase(); onChange(i.value); });
  hex.addEventListener('click', () => i.click());
  return wrap;
}
function fSelect(options, val, onChange) {
  const s = mk('select');
  options.forEach(o => {
    const op = mk('option', { value: o[0], text: o[1] }, s);
    if (String(o[0]) === String(val)) op.selected = true;
  });
  s.addEventListener('change', () => onChange(s.value));
  return s;
}
function pBtn(parent, label, fn, cls) {
  const b = mk('button', { class: 'p-btn' + (cls ? ' ' + cls : ''), text: label }, parent);
  b.addEventListener('click', fn);
  return b;
}

const STATE_OPTS = [
  ['1', '1 — 高电平'],
  ['0', '0 — 低电平'],
  ['Z', 'Z — 高阻'],
  ['WH', 'WH — 弱高'],
  ['WL', 'WL — 弱低'],
  ['HL', 'HL — 高低冲突'],
  ['GV', 'GV — 毛刺（下陷）'],
  ['GC', 'GC — 毛刺（上冲）']
];

function renderProps() {
  propsBody.innerHTML = '';
  if (!sel) { renderDocProps(); return; }

  if (sel.kind === 'ruler') { renderRulerProps(); return; }
  if (sel.kind === 'row') { renderRowProps(rowById(sel.rowId)); return; }
  if (sel.kind === 'seg') { renderSegProps(rowById(sel.rowId), sel.index); return; }
  if (sel.kind === 'edge') { renderEdgeProps(rowById(sel.rowId), sel.index); return; }
  if (sel.kind === 'ann') { renderAnnProps(S.annotations.find(a => a.id === sel.id)); return; }
  if (sel.kind === 'break') { renderBreakProps(S.breaks.find(b => b.id === sel.id)); return; }
}

function selTitle(kind, name) {
  const t = mk('div', { class: 'p-sel-title' }, propsBody);
  mk('span', { class: 'p-sel-kind', text: kind }, t);
  t.appendChild(document.createTextNode(name || ''));
}
const KIND_NAME = { row: 'ROW', seg: 'SEGMENT', edge: 'EDGE', ann: 'ANNOTATION', break: 'BREAK', ruler: 'RULER' };

function renderDocProps() {
  const t = mk('div', { class: 'p-sel-title' }, propsBody);
  mk('span', { class: 'p-sel-kind', text: 'CANVAS' }, t);
  t.appendChild(document.createTextNode('画布设置'));

  let b = pGroup('文档');
  pField(b, '标题', fText(S.title, v => { beginChange('~title'); S.title = v; scheduleSave(); }));

  b = pGroup('时间轴');
  const r1 = pRow(b);
  pField(r1, '总长度', fNum(S.span, v => {
    beginChange('~span');
    applyScaleChange(() => { S.span = clamp(v, 10, 100000); clampAll(); });
    scheduleSave();
  }, { min: 10, step: 10 }));
  pField(r1, '刻度增量', fNum(S.ruler.increment, v => {
    beginChange('~inc');
    applyScaleChange(() => { S.ruler.increment = clamp(v, 0.1, INC_MAX); });
    scheduleSave();
  }, { min: 0.1, step: 1 }));

  const r2 = pRow(b);
  pField(r2, '前缀', fText(S.ruler.prefix, v => { beginChange('~pfx'); S.ruler.prefix = v; render(); scheduleSave(); }));
  pField(r2, '后缀', fText(S.ruler.suffix, v => { beginChange('~sfx'); S.ruler.suffix = v; render(); scheduleSave(); }));

  b.appendChild(fCheck('显示刻度文字', S.ruler.showLabels !== false, v => {
    beginChange('ruler-labels'); S.ruler.showLabels = v; render(); scheduleSave();
  }));

  b = pGroup('快捷键');
  const keys = mk('div', { class: 'p-keys' }, b);
  [['撤销 / 重做', 'Ctrl+Z / Ctrl+Y'], ['保存工程', 'Ctrl+S'], ['另存为', 'Ctrl+Shift+S'],
  ['复制图片', 'Ctrl+Shift+C'], ['删除所选', 'Delete'], ['缩放', 'Ctrl+滚轮 / Ctrl+±'],
  ['缩放到 100%', 'Ctrl+0'],
  ['取消 / 退出工具', 'Esc']].forEach(([k, v]) => {
    const d = mk('div', {}, keys);
    mk('span', { text: k }, d);
    mk('b', { text: v }, d);
  });

  b = pGroup('编辑方式');
  mk('div', {
    class: 'p-note',
    text: '· 拖动波形上的圆点：移动边沿时刻（鼠标移到该行或选中该行时才显示圆点）\n· 双击波形：在此处翻转电平（插入一个跳变）\n· 双击行名：重命名；双击总线：编辑该段的值\n· 右键波形段：直接选电平状态（0/1/Z/WH/WL/HL/GV/GC）\n· 区间标注的文字可以单独拖动，拖走后自动补一条引线\n· 右键边沿：切换理想/斜率边沿、删除'
  }, b);

  b = pGroup('说明');
  mk('div', {
    class: 'p-note',
    text: '本版本为完整本地实现：不限行数、不限标注、PNG / SVG / PDF 导出全部免费。\n导出与保存工程会弹出系统「另存为」对话框，可自选目录和文件名（Chrome / Edge 支持；其他浏览器走默认下载）。\n工程同时自动保存在浏览器本地，Ctrl+S 会直接存回上次选定的文件。'
  }, b);
}

function renderRulerProps() {
  selTitle('RULER', '时间标尺');
  let b = pGroup('标尺');
  const r1 = pRow(b);
  pField(r1, '前缀', fText(S.ruler.prefix, v => { beginChange('~pfx'); S.ruler.prefix = v; render(); scheduleSave(); }));
  pField(r1, '后缀', fText(S.ruler.suffix, v => { beginChange('~sfx'); S.ruler.suffix = v; render(); scheduleSave(); }));
  const r2 = pRow(b);
  pField(r2, '起始值', fNum(S.ruler.start, v => { beginChange('start'); S.ruler.start = v; render(); scheduleSave(); }, { step: 1 }));
  pField(r2, '增量', fNum(S.ruler.increment, v => {
    beginChange('~inc');
    applyScaleChange(() => { S.ruler.increment = clamp(v, 0.1, INC_MAX); });
    scaleNote();
    scheduleSave();
  }, { min: 0.1, step: 1 }));
  b.appendChild(fCheck('显示刻度文字', S.ruler.showLabels !== false, v => {
    beginChange('ruler-labels'); S.ruler.showLabels = v; render(); scheduleSave();
  }));

  b = pGroup('时间轴');
  let noteEl = null;
  const scaleNote = () => {
    if (!noteEl) return;
    const inc = Math.max(0.05, +S.ruler.increment || 10);
    const cellPx = PXPU * inc;
    const cells = Math.max(1, S.span / inc);
    const capped = cellPx < (+S.ruler.gridPx || 0) - 1;
    noteEl.textContent = '每格 ' + cellPx.toFixed(cellPx >= 10 ? 0 : 1) + 'px × ' +
      (cells % 1 ? cells.toFixed(1) : cells) + ' 格 ≈ 画布 ' + Math.round(contentW()) + 'px' +
      (capped ? '（总长度过大，比例已自动压缩）' : '');
  };
  pField(b, '总长度（单位）', fNum(S.span, v => {
    beginChange('~span');
    applyScaleChange(() => { S.span = clamp(v, 10, 100000); clampAll(); });
    scaleNote(); scheduleSave();
  }, { min: 10, step: 10 }));
  pField(b, '每格宽度（px）', fNum(S.ruler.gridPx || 80, v => {
    beginChange('~gridpx');
    applyScaleChange(() => { S.ruler.gridPx = clamp(Math.round(v), 6, 400); });
    scaleNote(); scheduleSave();
  }, { min: 6, max: 400, step: 2 }));
  noteEl = mk('div', { class: 'p-note' }, b);
  noteEl.id = 'ruler-scale-note';
  scaleNote();
  mk('div', { class: 'p-note', text: '增量决定一格代表多少时间单位，格子宽度由「每格宽度」决定——改增量时格子宽度不变，整张图会按格数伸缩。' }, b);
}

function renderRowProps(row) {
  if (!row) return;
  selTitle('ROW', row.name || row.label || '(未命名)');
  const isSep = row.type === 'separator';

  let b = pGroup('基本');
  if (isSep) {
    pField(b, '分组标签', fText(row.label, v => { beginChange('~label'); row.label = v; render(); scheduleSave(); }));
    pField(b, '线型', fSelect([['dashed', '虚线'], ['solid', '实线'], ['none', '无']], row.rule, v => {
      beginChange('rule'); row.rule = v; render(); scheduleSave();
    }));
    pField(b, '颜色', fColor(row.color, v => { beginChange('~color'); row.color = v; render(); scheduleSave(); }));
  } else {
    pField(b, '名称', fText(row.name, v => { beginChange('~name'); row.name = v; render(); scheduleSave(); }));
    pField(b, '颜色', fColor(row.color, v => { beginChange('~color'); row.color = v; render(); scheduleSave(); }));
  }

  if (row.type === 'clock') {
    b = pGroup('时钟参数');
    const r1 = pRow(b);
    pField(r1, '周期', fNum(row.period, v => { beginChange('~period'); row.period = clamp(v, 0.5, 1000); render(); scheduleSave(); }, { min: 0.5, step: 1 }));
    pField(r1, '占空比 %', fNum(row.duty, v => { beginChange('~duty'); row.duty = clamp(v, 1, 99); render(); scheduleSave(); }, { min: 1, max: 99, step: 1 }));
    pField(b, '相位（0–360°）', (() => {
      const i = fNum(row.phase, v => { beginChange('~phase'); row.phase = clamp(v, -360, 360); render(); scheduleSave(); }, { min: -360, max: 360, step: 5 });
      i.id = 'f-phase';
      return i;
    })());

    b = pGroup('显示');
    b.appendChild(fCheck('反相（Invert）', row.invert, v => { beginChange('inv'); row.invert = v; render(); scheduleSave(); }));
    b.appendChild(fCheck('理想边沿', row.ideal, v => { beginChange('ideal'); row.ideal = v; render(); scheduleSave(); }));
    b.appendChild(fCheck('上升沿参考线', row.riseGuide, v => { beginChange('rg'); row.riseGuide = v; render(); scheduleSave(); }));
    b.appendChild(fCheck('下降沿参考线', row.fallGuide, v => { beginChange('fg'); row.fallGuide = v; render(); scheduleSave(); }));
    b.appendChild(fCheck('上升沿箭头', row.riseArrows, v => { beginChange('ra'); row.riseArrows = v; render(); scheduleSave(); }));
    b.appendChild(fCheck('下降沿箭头', row.fallArrows, v => { beginChange('fa'); row.fallArrows = v; render(); scheduleSave(); }));
    b.appendChild(fCheck('差分（虚线镜像）', row.differential, v => { beginChange('dif'); row.differential = v; render(); scheduleSave(); }));
  }

  if (row.type === 'signal') {
    b = pGroup('显示');
    b.appendChild(fCheck('理想边沿', row.ideal, v => { beginChange('ideal'); row.ideal = v; render(); scheduleSave(); }));
    b.appendChild(fCheck('上升沿箭头', row.riseArrows, v => { beginChange('ra'); row.riseArrows = v; render(); scheduleSave(); }));
    b.appendChild(fCheck('下降沿箭头', row.fallArrows, v => { beginChange('fa'); row.fallArrows = v; render(); scheduleSave(); }));
    b.appendChild(fCheck('差分（虚线镜像）', row.differential, v => { beginChange('dif'); row.differential = v; render(); scheduleSave(); }));
    b.appendChild(fCheck('允许毛刺尖峰', row.allowGlitch, v => { beginChange('gl'); row.allowGlitch = v; render(); scheduleSave(); }));

    b = pGroup('操作');
    const bt = mk('div', { class: 'p-btns' }, b);
    pBtn(bt, '反转 0↔1', () => {
      beginChange('invert-vals');
      row.initState = invertState(row.initState);
      row.edges.forEach(e => { e.state = invertState(e.state); });
      render(); scheduleSave();
    });
  }

  if (row.type === 'bus') {
    b = pGroup('总线');
    pField(b, '初始值', fText(row.initValue, v => { beginChange('~initv'); row.initValue = v; render(); scheduleSave(); }));
    b.appendChild(fCheck('理想边沿（不画交叉标记）', row.ideal, v => { beginChange('ideal'); row.ideal = v; render(); scheduleSave(); }));
    b = pGroup('操作');
    const bt = mk('div', { class: 'p-btns' }, b);
    pBtn(bt, '按周期切分', () => {
      beginChange('split');
      const step = Math.max(1, S.ruler.increment);
      row.edges = [];
      const vals = [];
      for (let t = 0; t < S.span; t += step) vals.push({ t, value: '--' });
      row.edges = vals.filter(v => v.t > 0);
      render(); scheduleSave();
    });
  }

  if (!isSep) {
    b = pGroup('行');
    pField(b, '行高', fNum(row.height || ROW_H, v => { beginChange('h'); row.height = clamp(v, 24, 160); render(); scheduleSave(); }, { min: 24, max: 160, step: 2 }));
    const bt = mk('div', { class: 'p-btns' }, b);
    pBtn(bt, '上移', () => moveRow(row, -1));
    pBtn(bt, '下移', () => moveRow(row, 1));
    pBtn(bt, '复制', () => {
      beginChange('dup');
      const copy = deepCopy(row);
      copy.id = nid('r');
      copy.name = row.name + '_copy';
      S.rows.splice(rowIndex(row.id) + 1, 0, copy);
      render(); renderProps(); scheduleSave();
    });
  }

  b = pGroup('');
  const bt2 = mk('div', { class: 'p-btns' }, b);
  pBtn(bt2, '删除此行', () => deleteRow(row), 'danger');
}

function invertState(s) {
  if (s === '1') return '0';
  if (s === '0') return '1';
  if (s === 'WH') return 'WL';
  if (s === 'WL') return 'WH';
  return s;
}

function moveRow(row, dir) {
  const i = rowIndex(row.id);
  const j = i + dir;
  if (j < 0 || j >= S.rows.length) return;
  beginChange('move');
  const tmp = S.rows[i];
  S.rows[i] = S.rows[j];
  S.rows[j] = tmp;
  render(); scheduleSave();
}

function deleteRow(row) {
  beginChange('del-row');
  S.rows = S.rows.filter(r => r.id !== row.id);
  S.breaks = S.breaks.filter(b => b.rowId !== row.id);
  S.annotations.forEach(a => {
    if (a.a1 && a.a1.rowId === row.id) a.a1 = null;
    if (a.a2 && a.a2.rowId === row.id) a.a2 = null;
  });
  sel = null;
  render(); renderProps(); scheduleSave();
}

function renderSegProps(row, idx) {
  if (!row) return;
  const segs = stepSegments(row);
  const s = segs[idx];
  if (!s) return;
  const isBus = row.type === 'bus';
  selTitle('SEGMENT', (row.name || '') + ' · ' + fmtNum(s.t0) + '–' + fmtNum(s.t1));

  let b = pGroup('内容');
  if (!isBus) {
    pField(b, '电平状态', fSelect(STATE_OPTS, s.v, v => {
      beginChange('seg-state');
      applySegmentState(row, s, v);
      render(); renderProps(); scheduleSave();
    }));
  }
  pField(b, isBus ? '总线值' : '段内文字', fText(s.text, v => {
    beginChange('seg-text' + idx);
    setSegmentProp(row, s, 'text', v);
    render(); scheduleSave();
  }, isBus ? '任意文本，如 0xA5' : '可选'));

  b = pGroup('文字');
  const r1 = pRow(b);
  pField(r1, '对齐', fSelect([['left', '左'], ['center', '中'], ['right', '右']], s.align || 'center', v => {
    beginChange('seg-align'); setSegmentProp(row, s, 'align', v); render(); scheduleSave();
  }));
  pField(r1, '字号', fNum(s.fontSize || (isBus ? 11 : 10.5), v => {
    beginChange('~seg-fs'); setSegmentProp(row, s, 'fontSize', clamp(v, 6, 40)); render(); scheduleSave();
  }, { min: 6, max: 40, step: 0.5 }));
  pField(b, '文字颜色', fColor(s.textColor || row.color, v => {
    beginChange('~seg-tc'); setSegmentProp(row, s, 'textColor', v); render(); scheduleSave();
  }));

  b = pGroup('外观');
  pField(b, '线条颜色', fColor(s.color || row.color, v => {
    beginChange('~seg-c'); setSegmentProp(row, s, 'color', v); render(); scheduleSave();
  }));
  pField(b, '填充', fSelect([['none', '无'], ['solid', '纯色'], ['hatch', '斜线'], ['cross', '交叉线']], s.fill || 'none', v => {
    beginChange('seg-fill'); setSegmentProp(row, s, 'fill', v); render(); scheduleSave();
  }));

  b = pGroup('时间');
  const r2 = pRow(b);
  pField(r2, '起点', fNum(s.t0, v => {
    beginChange('~seg-t0');
    const i = row.edges.findIndex(e => Math.abs(e.t - s.t0) < 0.001);
    if (i >= 0) { row.edges[i].t = clamp(v, 0, S.span); row.edges.sort((a, b2) => a.t - b2.t); }
    render(); renderProps(); scheduleSave();
  }, { step: 0.5 }));
  pField(r2, '终点', fNum(s.t1, v => {
    beginChange('~seg-t1');
    const i = row.edges.findIndex(e => Math.abs(e.t - s.t1) < 0.001);
    if (i >= 0) { row.edges[i].t = clamp(v, 0, S.span); row.edges.sort((a, b2) => a.t - b2.t); }
    render(); renderProps(); scheduleSave();
  }, { step: 0.5 }));

  b = pGroup('');
  const bt = mk('div', { class: 'p-btns' }, b);
  pBtn(bt, '删除左边沿', () => {
    const i = row.edges.findIndex(e => Math.abs(e.t - s.t0) < 0.001);
    if (i >= 0) {
      beginChange('del-edge');
      row.edges.splice(i, 1);
      sel = { kind: 'row', rowId: row.id };
      render(); renderProps(); scheduleSave();
    }
  }, 'danger');
}

/** 修改段属性时，把属性写回「该段的起始边沿」或行级默认 */
function setSegmentProp(row, seg, key, val) {
  const src = seg.src;
  if (row.type === 'bus' && key === 'text') {
    if (src) src.value = val; else row.initValue = val;
    return;
  }
  if (src) src[key] = val;
  else firstSrc(row)[key] = val;
}

/** 修改段电平：写回起始边沿（首段写到行初始状态） */
function applySegmentState(row, seg, state) {
  if (seg.src) seg.src.state = state;
  else row.initState = state;
}

function renderEdgeProps(row, idx) {
  if (!row) return;
  const e = row.edges[idx];
  if (!e) return;
  selTitle('EDGE', (row.name || '') + ' · t = ' + fmtNum(e.t));

  let b = pGroup('时间');
  const inp = fNum(e.t, v => {
    beginChange('edge-t' + idx);
    const min = idx > 0 ? row.edges[idx - 1].t + 0.1 : 0;
    const max = idx < row.edges.length - 1 ? row.edges[idx + 1].t - 0.1 : S.span;
    e.t = clamp(v, min, max);
    render(); scheduleSave();
  }, { step: 0.5, min: 0, max: S.span });
  inp.id = 'f-edge-time';
  pField(b, '位置', inp);

  b = pGroup('边沿');
  const idealMode = e.ideal == null ? 'inherit' : (e.ideal ? 'yes' : 'no');
  pField(b, '理想边沿', fSelect([['inherit', '继承行设置'], ['yes', '强制理想'], ['no', '强制斜率']], idealMode, v => {
    beginChange('edge-ideal');
    e.ideal = v === 'inherit' ? null : v === 'yes';
    render(); scheduleSave();
  }));
  if (row.type === 'signal') {
    pField(b, '段电平（此后）', fSelect(STATE_OPTS, e.state || '0', v => {
      beginChange('edge-state'); e.state = v; render(); scheduleSave();
    }));
  } else {
    pField(b, '总线值（此后）', fText(e.value, v => { beginChange('~edge-val'); e.value = v; render(); scheduleSave(); }));
  }

  b = pGroup('');
  const bt = mk('div', { class: 'p-btns' }, b);
  pBtn(bt, '删除边沿', () => {
    beginChange('del-edge');
    row.edges.splice(idx, 1);
    sel = { kind: 'row', rowId: row.id };
    render(); renderProps(); scheduleSave();
  }, 'danger');
}

function renderAnnProps(a) {
  if (!a) return;
  selTitle('ANNOTATION', a.type === 'text' ? '文本' : a.type === 'arrow' ? (a.curve ? '曲线' : '箭头') : '区间');
  let b;

  if (a.type === 'text') {
    b = pGroup('文本');
    const ta = mk('textarea');
    ta.value = a.text || '';
    ta.addEventListener('input', () => { beginChange('~ann-text'); a.text = ta.value; render(); scheduleSave(); });
    b.appendChild(ta);
    pField(b, '字号', fNum(a.size || 11, v => { beginChange('~ann-size'); a.size = clamp(v, 6, 48); render(); scheduleSave(); }, { min: 6, max: 48, step: 0.5 }));
    pField(b, '颜色', fColor(a.color || T.text, v => { beginChange('~ann-color'); a.color = v; render(); scheduleSave(); }));
  }

  if (a.type === 'arrow') {
    b = pGroup('箭头');
    pField(b, '标签', fText(a.label, v => { beginChange('~ann-label'); a.label = v; render(); scheduleSave(); }));
    b.appendChild(fCheck('起点箭头', !!a.startArrow, v => { beginChange('ann-sa'); a.startArrow = v; render(); scheduleSave(); }));
    b.appendChild(fCheck('终点箭头', a.endArrow !== false, v => { beginChange('ann-ea'); a.endArrow = v; render(); scheduleSave(); }));
    b.appendChild(fCheck('自动时间差', !!a.showDt, v => { beginChange('ann-dt'); a.showDt = v; render(); scheduleSave(); }));
    b.appendChild(fCheck('曲线模式', !!a.curve, v => { beginChange('ann-curve'); a.curve = v; render(); scheduleSave(); }));
    b.appendChild(fCheck('端点吸附边沿', a.snap !== false, v => { beginChange('ann-snap'); a.snap = v; render(); scheduleSave(); }));
    pField(b, '颜色', fColor(a.color || T.accent, v => { beginChange('~ann-color'); a.color = v; render(); scheduleSave(); }));
  }

  if (a.type === 'bracket') {
    b = pGroup('区间');
    pField(b, '标签模式', fSelect([['time', '自动显示时间'], ['custom', '自定义文字']], a.mode || 'time', v => {
      beginChange('ann-mode'); a.mode = v; render(); renderProps(); scheduleSave();
    }));
    if (a.mode === 'custom') {
      pField(b, '标签文字', fText(a.label, v => { beginChange('~ann-label'); a.label = v; render(); scheduleSave(); }));
      b.appendChild(fCheck('自动附加时间', !!a.showDt, v => { beginChange('ann-dt'); a.showDt = v; render(); scheduleSave(); }));
    }
    pField(b, '颜色', fColor(a.color || '#f0a35e', v => { beginChange('~ann-color'); a.color = v; render(); scheduleSave(); }));
    if (a.lx || a.ly) {
      const bar = mk('div', { class: 'p-btns' }, b);
      pBtn(bar, '标签归位', () => {
        beginChange('ann-label-reset');
        a.lx = 0; a.ly = 0;
        render(); scheduleSave();
      });
    }
  }

  b = pGroup('');
  const bt = mk('div', { class: 'p-btns' }, b);
  pBtn(bt, '删除标注', () => {
    beginChange('del-ann');
    S.annotations = S.annotations.filter(x => x.id !== a.id);
    sel = null;
    render(); renderProps(); scheduleSave();
  }, 'danger');
}

function renderBreakProps(br) {
  if (!br) return;
  selTitle('BREAK', '时间断点');
  let b = pGroup('断点');
  pField(b, '时间位置', fNum(br.t, v => { beginChange('~br-t'); br.t = clamp(v, 0, S.span); render(); scheduleSave(); }, { step: 0.5 }));
  pField(b, '范围', fSelect([['row', '单行'], ['all', '全部行']], br.scope, v => {
    beginChange('br-scope'); br.scope = v; render(); renderProps(); scheduleSave();
  }));
  pField(b, '颜色', fColor(br.color || T.accent, v => { beginChange('br-color'); br.color = v; render(); scheduleSave(); }));

  b = pGroup('');
  const bt = mk('div', { class: 'p-btns' }, b);
  if (br.scope === 'row') {
    pBtn(bt, '扩展为全部行', () => { beginChange('br-all'); br.scope = 'all'; render(); renderProps(); scheduleSave(); });
  }
  pBtn(bt, '删除断点', () => {
    beginChange('del-br');
    S.breaks = S.breaks.filter(x => x.id !== br.id);
    sel = null;
    render(); renderProps(); scheduleSave();
  }, 'danger');
}

/* ============================ 8. 交互 ============================ */
function toModel(e) {
  const r = canvasEl.getBoundingClientRect();
  const x = (e.clientX - r.left) / zoom;
  const y = (e.clientY - r.top) / zoom;
  return { x, y, t: tx(x) };
}

function rowAtY(y) {
  for (const r of S.rows) if (y >= r._y && y <= r._y + rowH(r)) return r;
  return null;
}

function startDrag(ev, onMove, onEnd) {
  ev.preventDefault();
  const x0 = ev.clientX, y0 = ev.clientY;
  let moved = false;
  const move = (e2) => {
    const dx = (e2.clientX - x0) / zoom;
    const dy = (e2.clientY - y0) / zoom;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
    onMove(dx, dy, e2);
  };
  const up = (e2) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    document.body.style.cursor = '';
    if (onEnd) onEnd(moved, e2);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function hitEdge(x, y, excludeAnn) {
  let best = null;
  for (const r of S.rows) {
    if (r.type === 'separator') continue;
    if (y < r._y - 6 || y > r._y + rowH(r) + 6) continue;
    for (const t of rowEdgeTimes(r)) {
      const d = Math.abs(cx(t) - x);
      if (d < 9 && (!best || d < best.d)) best = { d, rowId: r.id, t, y: rowMid(r) };
    }
  }
  return best;
}

/** 鼠标下方最近的一条波形行（含行间空隙的一半，允许略微拖出带子也能吸附） */
function hitRowAt(x, y) {
  if (x < LABEL_W - 10) return null;
  let best = null, bestD = Infinity;
  for (const r of S.rows) {
    if (r.type === 'separator') continue;
    const top = r._y, bot = r._y + rowH(r);
    const d = y < top ? top - y : (y > bot ? y - bot : 0);
    if (d < bestD) { bestD = d; best = r; }
  }
  return (best && bestD <= GAP / 2 + 2) ? best : null;
}

function makeAttach(x, y) {
  const hit = hitEdge(x, y);
  if (hit) {
    const r = rowById(hit.rowId);
    return { rowId: hit.rowId, t: hit.t, dy: Math.round(y - rowMid(r)) };
  }
  // 不在边沿附近时，直接吸附到鼠标所在的那条波形上（横向取吸附后的时刻），
  // 这样标注的一端可以落在另一条波形的任意位置。
  const r = hitRowAt(x, y);
  if (!r) return null;
  const mid = rowMid(r);
  const lim = Math.max(4, rowH(r) / 2 - 4);
  return { rowId: r.id, t: snapT(tx(x)), dy: clamp(Math.round(y - mid), -lim, lim) };
}

/** 把 attach 结果换算成实际坐标 */
function attachPoint(att, flat) {
  if (!att) return null;
  const r = rowById(att.rowId);
  if (!r) return null;
  return { x: cx(att.t), y: rowMid(r) + (flat ? 0 : att.dy) };
}

/* ---------- 画布事件 ---------- */
canvasEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  openContextMenu(e);
});

canvasEl.addEventListener('pointerdown', (e) => {
  if (e.button === 1) { startPan(e); return; }
  if (e.button !== 0) return;
  closeMenus();
  const m = toModel(e);
  const target = e.target;

  // 绘制工具
  if (tool !== 'select') {
    handleToolDown(e, m, target);
    return;
  }

  // 双击判定（必须自己做：select/render 会重建节点，
  // 浏览器因 mousedown 与 mouseup 目标不一致而不派发 click/dblclick）
  const annHit = target.closest('[data-ann]');
  const rowHit = target.closest('[data-row]');
  const dblKey = annHit ? 'ann:' + annHit.getAttribute('data-ann')
    : rowHit ? 'row:' + rowHit.getAttribute('data-row')
      : 'none';
  if (isDoubleDown(e, dblKey)) {
    if (doDoubleClick(e)) { e.preventDefault(); return; }
  }

  // 手动柄优先
  const handleEl = target.closest('[data-handle]');
  if (handleEl) {
    const a = S.annotations.find(x => x.id === handleEl.getAttribute('data-ann'));
    if (a) {
      const hk = handleEl.getAttribute('data-handle');
      // 标签热区本身不带选中，点它时先选中，否则用户不知道选中了没有
      if (hk === 'label' && !(sel && sel.kind === 'ann' && sel.id === a.id)) {
        select({ kind: 'ann', id: a.id });
      }
      startHandleDrag(e, a, hk, m);
      return;
    }
  }

  const annEl = target.closest('[data-ann]');
  if (annEl) {
    const a = S.annotations.find(x => x.id === annEl.getAttribute('data-ann'));
    if (a) { select({ kind: 'ann', id: a.id }); startAnnDrag(e, a, m); return; }
  }

  const brEl = target.closest('[data-break]');
  if (brEl) {
    const b = S.breaks.find(x => x.id === brEl.getAttribute('data-break'));
    if (b) { select({ kind: 'break', id: b.id }); startBreakDrag(e, b); return; }
  }

  const edgeEl = target.closest('[data-edge]');
  if (edgeEl) {
    const row = rowById(edgeEl.getAttribute('data-row'));
    const idx = +edgeEl.getAttribute('data-edge');
    if (row) { startEdgeDrag(e, row, idx); return; }
  }

  const clockEl = target.closest('[data-clock]');
  if (clockEl) {
    const row = rowById(clockEl.getAttribute('data-row'));
    if (row) { select({ kind: 'row', rowId: row.id }); maybeClockDrag(e, row); return; }
  }

  const segEl = target.closest('[data-seg]');
  if (segEl) {
    const row = rowById(segEl.getAttribute('data-row'));
    const idx = +segEl.getAttribute('data-seg');
    if (row) { select({ kind: 'seg', rowId: row.id, index: idx }); return; }
  }

  const rowEl = target.closest('[data-row]');
  if (rowEl) {
    const row = rowById(rowEl.getAttribute('data-row'));
    if (row) { select({ kind: 'row', rowId: row.id }); return; }
  }

  if (target.closest('[data-ruler]')) { select({ kind: 'ruler' }); return; }

  select(null);
});

/**
 * 双击处理：信号行翻转电平、总线行插入段、行名改名、文本标注编辑。
 * 由 pointerdown 里的双击判定调用（见 isDoubleDown）。
 */
function doDoubleClick(e) {
  const target = e.target;
  const rowEl = target.closest('[data-row]');
  if (rowEl) {
    const row = rowById(rowEl.getAttribute('data-row'));
    if (!row) return false;
    if (target.closest('[data-name]')) { startNameEdit(e, row); return true; }
    if (row.type === 'separator' || row.type === 'clock') return false;
    const m = toModel(e);

    if (row.type === 'signal') {
      // 双击 = 在此处翻转电平（不管点在上半还是下半，都插入一个跳变）
      const tt = snapT(m.t);
      const cur = stateAt(row, Math.max(0, tt - 0.01));
      addTransition(row, m.t, cur === '1' ? '0' : '1');
      return true;
    } else if (row.type === 'bus') {
      const t = snapT(m.t);
      beginChange('add-bus');
      row.edges.push({ t, value: '' });
      row.edges.sort((a, b) => a.t - b.t);
      const segs = stepSegments(row);
      const idx = segs.findIndex(s => Math.abs(s.t0 - t) < 0.001);
      sel = { kind: 'seg', rowId: row.id, index: idx >= 0 ? idx : 0 };
      render(); renderProps(); scheduleSave();
      const seg = stepSegments(row)[sel.index];
      if (seg) openSegEditor(row, seg, '');
      return true;
    }
    return false;
  }
  const annEl = target.closest('[data-ann]');
  if (annEl) {
    const a = S.annotations.find(x => x.id === annEl.getAttribute('data-ann'));
    if (a && a.type === 'text') { select({ kind: 'ann', id: a.id }); startTextEdit(a); return true; }
  }
  return false;
}

function addTransition(row, t, state) {
  const tt = snapT(t);
  if (row.edges.some(e => Math.abs(e.t - tt) < 0.02)) return;
  const cur = stateAt(row, Math.max(0, tt - 0.01));
  if (cur === state) return;
  beginChange('add-edge');
  row.edges.push({ t: tt, state });
  row.edges.sort((a, b) => a.t - b.t);
  const idx = row.edges.findIndex(e => Math.abs(e.t - tt) < 0.001);
  sel = { kind: 'edge', rowId: row.id, index: idx };
  render(); renderProps(); scheduleSave();
}

function startEdgeDrag(ev, row, idx) {
  ev.preventDefault();
  ev.stopPropagation();
  select({ kind: 'edge', rowId: row.id, index: idx });
  const e = row.edges[idx];
  let started = false;
  const t0 = e.t;
  const minT = idx > 0 ? row.edges[idx - 1].t + 0.1 : 0;
  const maxT = idx < row.edges.length - 1 ? row.edges[idx + 1].t - 0.1 : S.span;
  startDrag(ev, (dx, dy, e2) => {
    if (!started) { started = true; edgeDragActive = true; beginChange('edge-drag' + row.id + idx); }
    const raw = t0 + dx / PXPU;
    const nt = e2.altKey ? Math.round(raw * 10) / 10 : snapT(raw);
    e.t = clamp(nt, minT, maxT);
    render();
    showDragTip('t = ' + fmtNum(e.t) + (S.ruler.suffix || ''), e2.clientX, e2.clientY);
    const inp = document.getElementById('f-edge-time');
    if (inp) inp.value = fmtNum(e.t);
  }, () => {
    hideDragTip();
    if (started) { edgeDragActive = false; render(); }
    scheduleSave(); updateStatus();
  });
}

function maybeClockDrag(ev, row) {
  const p = Math.max(0.5, +row.period || 20);
  const phase0 = +row.phase || 0;
  let started = false;
  startDrag(ev, (dx) => {
    if (!started && Math.abs(dx) < 3) return;
    if (!started) { started = true; beginChange('phase-drag' + row.id); }
    row.phase = clamp(phase0 + (dx / PXPU) / p * 360, -360, 360);
    render();
    const inp = document.getElementById('f-phase');
    if (inp) inp.value = fmtNum(row.phase);
  }, () => {
    if (!started) return;
    scheduleSave();
    renderProps();
  });
}

function startAnnDrag(ev, a, m) {
  const start = { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, x: a.x, y: a.y };
  const p = resolveAnn(a);
  let started = false;
  startDrag(ev, (dx, dy) => {
    if (!started) {
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      started = true;
      beginChange('ann-drag' + a.id);
    }
    if (a.type === 'text') { a.x = p.x1 + dx; a.y = p.y1 + dy; a.a1 = null; }
    else if (a.type === 'arrow') {
      a.x1 = p.x1 + dx; a.y1 = p.y1 + dy; a.x2 = p.x2 + dx; a.y2 = p.y2 + dy;
      a.a1 = null; a.a2 = null;
      if (a.curve) {
        a.c1 = { x: (a.c1 ? a.c1.x : p.x1 + (p.x2 - p.x1) * 0.3) + dx, y: (a.c1 ? a.c1.y : p.y1 - 30) + dy };
        a.c2 = { x: (a.c2 ? a.c2.x : p.x1 + (p.x2 - p.x1) * 0.7) + dx, y: (a.c2 ? a.c2.y : p.y2 - 30) + dy };
      }
    } else if (a.type === 'bracket') {
      a.x1 = p.x1 + dx; a.y1 = p.y1 + dy; a.x2 = p.x2 + dx; a.y2 = p.y2 + dy;
      a.a1 = null; a.a2 = null;
    }
    render();
  }, (moved, e2) => {
    if (!moved) return;
    if (a.snap !== false) resnapAnn(a, e2);
    scheduleSave();
    renderProps();
  });
}

function resnapAnn(a, ev) {
  if (a.type === 'text') {
    const at = makeAttach(a.x, a.y);
    a.a1 = at;
    if (at) { const r = rowById(at.rowId); a.x = cx(at.t); a.y = rowMid(r) + at.dy; }
    return;
  }
  if (a.type === 'arrow') {
    const p = resolveAnn(a);
    a.a1 = makeAttach(p.x1, p.y1);
    a.a2 = makeAttach(p.x2, p.y2);
  }
  if (a.type === 'bracket') {
    const p = resolveAnn(a);
    a.a1 = makeAttach(p.x1, p.y1);
    a.a2 = makeAttach(p.x2, p.y1);
    if (a.a1) a.y1 = rowMid(rowById(a.a1.rowId)) + a.a1.dy;
  }
}

function startHandleDrag(ev, a, hk, m) {
  ev.preventDefault(); ev.stopPropagation();
  const p = resolveAnn(a);
  let started = false;
  const origin = hk === 'a1' ? { x: p.x1, y: p.y1 }
    : hk === 'a2' ? { x: p.x2, y: p.y2 }
      : hk === 'label' ? { x: a.lx || 0, y: a.ly || 0 }
        : (a[hk] ? { x: a[hk].x, y: a[hk].y } : { x: m.x, y: m.y });

  startDrag(ev, (dx, dy, e2) => {
    if (!started) { started = true; beginChange('handle' + a.id + hk); }
    const nx = origin.x + dx, ny = origin.y + dy;
    if (hk === 'label') {
      // 只移动标签文字，尺寸线不动
      a.lx = Math.round(nx);
      a.ly = Math.round(ny);
      render();
      return;
    }
    if (hk === 'a1') {
      a.a1 = null; a.x1 = nx; a.y1 = ny;
      if (a.type === 'bracket') a.y1 = ny;
    } else if (hk === 'a2') {
      a.a2 = null; a.x2 = nx; a.y2 = ny;
    } else {
      a[hk] = { x: nx, y: ny };
    }
    // 端点拖到别的波形上时，高亮那条波形，提示会吸附过去
    if (hk === 'a1' || hk === 'a2') {
      const mm = toModel(e2);
      const att = makeAttach(mm.x, mm.y);
      const pt = attachPoint(att, a.type === 'bracket');
      attachPreview = (att && pt) ? { rowId: att.rowId, t: att.t, y: pt.y } : null;
    }
    render();
  }, () => {
    attachPreview = null;
    if (hk === 'a1') {
      const hit = makeAttach(a.x1, a.y1);
      if (hit) { a.a1 = hit; }
    } else if (hk === 'a2') {
      const hit = makeAttach(a.x2, a.y2);
      if (hit) { a.a2 = hit; }
    }
    render(); renderProps(); scheduleSave();
  });
}

function startBreakDrag(ev, b) {
  ev.preventDefault(); ev.stopPropagation();
  const t0 = b.t;
  let started = false;
  startDrag(ev, (dx) => {
    if (!started) { started = true; beginChange('br-drag' + b.id); }
    b.t = clamp(snapT(t0 + dx / PXPU), 0, S.span);
    render();
  }, () => { renderProps(); scheduleSave(); });
}

function startPan(ev) {
  ev.preventDefault();
  const sc = $('#canvas-scroll');
  const sx = sc.scrollLeft, sy = sc.scrollTop;
  const x0 = ev.clientX, y0 = ev.clientY;
  canvasEl.classList.add('panning');
  const move = (e) => {
    sc.scrollLeft = sx - (e.clientX - x0);
    sc.scrollTop = sy - (e.clientY - y0);
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    canvasEl.classList.remove('panning');
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/* ---------- 工具绘制 ---------- */
function handleToolDown(e, m, target) {
  if (tool === 'text') {
    beginChange('add-text');
    const a = {
      id: nid('a'), type: 'text', text: '文本', size: 11, color: T.dim,
      x: m.x, y: m.y, a1: makeAttach(m.x, m.y)
    };
    S.annotations.push(a);
    setTool('select');
    select({ kind: 'ann', id: a.id });
    scheduleSave();
    startTextEdit(a, true);
    return;
  }

  if (tool === 'break') {
    const row = rowAtY(m.y);
    if (!row) { toast('请点击某一行以放置断点', true); return; }
    beginChange('add-break');
    const br = { id: nid('b'), t: snapT(m.t), scope: e.shiftKey ? 'all' : 'row', rowId: row.id };
    S.breaks.push(br);
    select({ kind: 'break', id: br.id });
    scheduleSave();
    return;
  }

  if (tool === 'arrow' || tool === 'bezier' || tool === 'bracket') {
    if (pending) { finishPending(); return; }
    const att = makeAttach(m.x, m.y);
    const r0 = att ? rowById(att.rowId) : null;
    const startPt = (att && r0) ? { x: cx(att.t), y: rowMid(r0) + att.dy } : { x: m.x, y: m.y };
    pending = {
      ann: {
        id: nid('a'),
        type: tool === 'bracket' ? 'bracket' : 'arrow',
        curve: tool === 'bezier',
        label: '', startArrow: false, endArrow: true, snap: true,
        x1: startPt.x, y1: startPt.y, x2: startPt.x, y2: startPt.y,
        a1: att, a2: null, mode: 'time',
        color: tool === 'bracket' ? '#f0a35e' : T.sel
      }
    };
    pending.handler = (ev2) => {
      if (!pending) return;
      const mm = toModel(ev2);
      const a = pending.ann;
      a.x2 = mm.x;
      if (a.type === 'bracket') { a.y1 = mm.y; a.y2 = mm.y; }
      else { a.y2 = mm.y; }
      const att2 = makeAttach(mm.x, mm.y);
      a.a2 = att2;
      if (att2) {
        const rr = rowById(att2.rowId);
        a.x2 = cx(att2.t);
        if (a.type === 'bracket') { a.y1 = a.y2 = mm.y; }
        else { a.y2 = rowMid(rr) + att2.dy; }
      }
      const pt2 = attachPoint(att2, a.type === 'bracket');
      attachPreview = (att2 && pt2) ? { rowId: att2.rowId, t: att2.t, y: pt2.y } : null;
      render();
    };
    window.addEventListener('pointermove', pending.handler);
    render();
    return;
  }
}

function cancelPending() {
  if (!pending) return;
  window.removeEventListener('pointermove', pending.handler);
  pending = null;
  attachPreview = null;
  render();
}

function finishPending() {
  if (!pending) return;
  const a = pending.ann;
  window.removeEventListener('pointermove', pending.handler);
  pending = null;
  attachPreview = null;
  const ok = a.type === 'bracket'
    ? Math.abs(a.x2 - a.x1) >= 6
    : Math.hypot(a.x2 - a.x1, a.y2 - a.y1) >= 8;
  if (!ok) { render(); return; }
  if (a.type === 'bracket') a.y1 = a.y2;
  beginChange('add-ann');
  S.annotations.push(a);
  setTool('select');
  select({ kind: 'ann', id: a.id });
  scheduleSave();
}

/* ---------- 行内编辑 ---------- */
function openInline(opts) {
  closeInline();
  const wrap = $('#canvas-wrap');
  const wr = wrap.getBoundingClientRect();
  const inp = document.createElement(opts.multiline ? 'textarea' : 'input');
  if (!opts.multiline) inp.type = 'text';
  inp.id = 'inline-editor';
  inp.value = opts.value || '';
  const left = opts.rect.left - wr.left + wrap.scrollLeft;
  const top = opts.rect.top - wr.top;
  inp.style.left = left + 'px';
  inp.style.top = top + 'px';
  inp.style.width = Math.max(40, opts.rect.width) + 'px';
  inp.style.height = Math.max(22, opts.rect.height) + 'px';
  inp.style.fontSize = (opts.fontSize || 12) + 'px';
  if (opts.align) inp.style.textAlign = opts.align;
  wrap.appendChild(inp);
  inp.focus();
  inp.select();

  let done = false;
  const commit = (save) => {
    if (done) return;
    done = true;
    const v = inp.value;
    inp.remove();
    if (save) opts.onCommit(v);
  };
  inp.addEventListener('blur', () => commit(true));
  inp.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter' && (!opts.multiline || ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); commit(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
  });
  return inp;
}
function closeInline() {
  const e = document.getElementById('inline-editor');
  if (e) e.remove();
}

function openSegEditor(row, seg, initial) {
  const rect = {
    left: canvasEl.getBoundingClientRect().left + cx(seg.t0) * zoom,
    top: canvasEl.getBoundingClientRect().top + (row._y + 6) * zoom,
    width: Math.max(60, (cx(seg.t1) - cx(seg.t0)) * zoom),
    height: (rowH(row) - 12) * zoom
  };
  const idx = stepSegments(row).indexOf(seg);
  openInline({
    rect, value: initial != null ? initial : (seg.text || (row.type === 'bus' ? seg.v : '')),
    fontSize: (row.type === 'bus' ? 11 : 10.5) * zoom,
    onCommit: (v) => {
      beginChange('seg-text' + idx);
      setSegmentProp(row, seg, 'text', v);
      if (row.type === 'bus') {
        const i = row.edges.findIndex(e => Math.abs(e.t - seg.t0) < 0.001);
        if (i >= 0) row.edges[i].value = v;
        else row.initValue = v;
      }
      render(); renderProps(); scheduleSave();
    }
  });
}

function startTextEdit(a, isNew) {
  const p = resolveAnn(a);
  const size = (a.size || 11) * zoom;
  const lines = String(a.text || '').split('\n');
  let maxw = 0;
  lines.forEach(l => { maxw = Math.max(maxw, l.length * size * 0.62); });
  openInline({
    rect: {
      left: canvasEl.getBoundingClientRect().left + (p.x1 - 4) * zoom,
      top: canvasEl.getBoundingClientRect().top + (p.y1 - size) * zoom,
      width: Math.max(120, maxw + 20),
      height: Math.max(26, lines.length * size * 1.45 + 6)
    },
    value: isNew ? '' : a.text,
    multiline: true,
    fontSize: size,
    onCommit: (v) => {
      beginChange('~ann-text');
      a.text = v;
      if (isNew && !v.trim()) S.annotations = S.annotations.filter(x => x.id !== a.id);
      render(); renderProps(); scheduleSave();
    }
  });
}

function startNameEdit(e, row) {
  e.preventDefault(); e.stopPropagation();
  const r = canvasEl.getBoundingClientRect();
  openInline({
    rect: {
      left: r.left + 8 * zoom,
      top: r.top + (row._y + rowH(row) / 2 - 11) * zoom,
      width: 136 * zoom, height: 22 * zoom
    },
    value: row.type === 'separator' ? row.label : row.name,
    fontSize: 12.5 * zoom,
    onCommit: (v) => {
      beginChange('~name');
      if (row.type === 'separator') row.label = v;
      else row.name = v;
      render(); renderProps(); scheduleSave();
    }
  });
}

/* ---------- 右键菜单 ---------- */
function openContextMenu(e) {
  const m = toModel(e);
  const target = e.target;
  const menu = $('#ctxmenu');
  menu.innerHTML = '';
  menu.classList.add('open');

  const addItem = (label, fn, opts) => {
    opts = opts || {};
    const b = mk('button', { class: opts.danger ? 'danger' : '' }, menu);
    if (opts.swatch) mk('span', { class: 'sw', style: 'background:' + opts.swatch });
    mk('span', { text: label }, b);
    if (opts.key) mk('span', { class: 'cm-key', text: opts.key }, b);
    b.addEventListener('click', () => { menu.classList.remove('open'); fn(); });
  };
  const addSep = () => mk('div', { class: 'cm-sep' }, menu);
  const addTitle = (t) => mk('div', { class: 'cm-title', text: t }, menu);

  const segEl = target.closest('[data-seg]');
  const edgeEl = target.closest('[data-edge]');
  const annEl = target.closest('[data-ann]');
  const brEl = target.closest('[data-break]');
  const rowEl = target.closest('[data-row]');

  if (annEl) {
    const a = S.annotations.find(x => x.id === annEl.getAttribute('data-ann'));
    if (a) {
      select({ kind: 'ann', id: a.id });
      addTitle('标注');
      addItem('编辑文字', () => { if (a.type === 'text') startTextEdit(a); });
      addItem('删除标注', () => {
        beginChange('del-ann');
        S.annotations = S.annotations.filter(x => x.id !== a.id);
        sel = null; render(); renderProps(); scheduleSave();
      }, { danger: true, key: 'Del' });
    }
  } else if (brEl) {
    const b = S.breaks.find(x => x.id === brEl.getAttribute('data-break'));
    if (b) {
      select({ kind: 'break', id: b.id });
      addTitle('时间断点');
      addItem('扩展到全部行', () => { beginChange('br'); b.scope = 'all'; render(); renderProps(); scheduleSave(); });
      addItem('删除断点', () => {
        beginChange('del-br'); S.breaks = S.breaks.filter(x => x.id !== b.id); sel = null; render(); renderProps(); scheduleSave();
      }, { danger: true });
    }
  } else if (segEl) {
    const row = rowById(segEl.getAttribute('data-row'));
    const idx = +segEl.getAttribute('data-seg');
    if (row) {
      const segs = stepSegments(row);
      const seg = segs[idx];
      select({ kind: 'seg', rowId: row.id, index: idx });
      addTitle(row.name + ' · ' + fmtNum(seg.t0) + '–' + fmtNum(seg.t1));
      if (row.type === 'signal') {
        STATE_OPTS.forEach(([v, label]) => {
          addItem(label, () => {
            beginChange('seg-state');
            applySegmentState(row, seg, v);
            render(); renderProps(); scheduleSave();
          }, { swatch: v === '1' ? row.color : v === '0' ? 'transparent' : undefined });
        });
      } else if (row.type === 'bus') {
        addItem('编辑总线值', () => openSegEditor(row, seg, ''));
      }
      addSep();
      addItem('在此时刻复制边沿', () => {
        beginChange('dup-edge');
        const t = seg.t0;
        if (row.edges.some(x => Math.abs(x.t - t) < 0.01)) return;
        row.edges.push({ t, state: seg.v, value: seg.v });
        row.edges.sort((a, b) => a.t - b.t);
        render(); scheduleSave();
      });
      addItem('删除此行', () => deleteRow(row), { danger: true });
    }
  } else if (edgeEl) {
    const row = rowById(edgeEl.getAttribute('data-row'));
    const idx = +edgeEl.getAttribute('data-edge');
    if (row) {
      select({ kind: 'edge', rowId: row.id, index: idx });
      addTitle('边沿 · ' + fmtNum(row.edges[idx].t));
      addItem('设为理想边沿', () => { beginChange('e'); row.edges[idx].ideal = true; render(); scheduleSave(); });
      addItem('设为斜率边沿', () => { beginChange('e'); row.edges[idx].ideal = false; render(); scheduleSave(); });
      addSep();
      addItem('删除边沿', () => {
        beginChange('del-edge'); row.edges.splice(idx, 1); sel = { kind: 'row', rowId: row.id }; render(); renderProps(); scheduleSave();
      }, { danger: true, key: 'Del' });
    }
  } else if (rowEl) {
    const row = rowById(rowEl.getAttribute('data-row'));
    if (row) {
      select({ kind: 'row', rowId: row.id });
      addTitle(row.name || row.label || '行');
      addItem('重命名', () => startNameEdit(e, row));
      if (row.type === 'signal') {
        addItem('反转 0↔1', () => {
          beginChange('inv');
          row.initState = invertState(row.initState);
          row.edges.forEach(x => { x.state = invertState(x.state); });
          render(); scheduleSave();
        });
      }
      addSep();
      addItem('上移', () => moveRow(row, -1));
      addItem('下移', () => moveRow(row, 1));
      addItem('删除此行', () => deleteRow(row), { danger: true });
    }
  } else {
    addTitle('画布');
    addItem('添加时钟', () => addRow('clock'));
    addItem('添加信号', () => addRow('signal'));
    addItem('添加总线', () => addRow('bus'));
    addSeparatorItem();
    addSep();
    addItem('适应宽度', () => fitWidth());
  }

  function addSeparatorItem() { addItem('添加分隔行', () => addRow('separator')); }

  // 定位
  menu.style.left = '0px';
  menu.style.top = '0px';
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let x = e.clientX, y = e.clientY;
  if (x + mw > window.innerWidth - 8) x = window.innerWidth - mw - 8;
  if (y + mh > window.innerHeight - 8) y = window.innerHeight - mh - 8;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('#ctxmenu')) $('#ctxmenu').classList.remove('open');
}, true);

/* ---------- 行操作 ---------- */
function addRow(type) {
  beginChange('add-row');
  const r = newRow(type);
  if (type === 'signal') r.name = 'SIG' + (S.rows.filter(x => x.type === 'signal').length + 1);
  if (type === 'bus') r.name = 'BUS' + (S.rows.filter(x => x.type === 'bus').length + 1);
  if (type === 'clock') r.name = 'CLK' + (S.rows.filter(x => x.type === 'clock').length + 1);
  S.rows.push(r);
  sel = { kind: 'row', rowId: r.id };
  render(); renderProps(); scheduleSave();
}

function clampAll() {
  S.rows.forEach(r => {
    if (r.edges) r.edges = r.edges.filter(e => e.t >= 0 && e.t <= S.span);
  });
  S.breaks = S.breaks.filter(b => b.t >= 0 && b.t <= S.span);
}

/* ============================ 9. 工具切换 / 缩放 ============================ */
function setTool(t) {
  tool = t;
  closeInline();
  $$('#toolbar [id^="tool-"]').forEach(b => b.classList.toggle('active', b.id === 'tool-' + t));
  canvasEl.setAttribute('class', t === 'select' ? '' : 'tool-' + t);
  if (pending) cancelPending();
  updateStatus();
}

/** 缩放档位：放大/缩小按这些固定档走，保证能精确落在 100% */
const ZOOM_STEPS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.75, 0.9, 1, 1.25, 1.5, 2, 3, 4];

function zoomStep(dir) {
  let next;
  if (dir > 0) next = ZOOM_STEPS.find(s => s > zoom + 1e-4) || ZOOM_STEPS[ZOOM_STEPS.length - 1];
  else next = [...ZOOM_STEPS].reverse().find(s => s < zoom - 1e-4) || ZOOM_STEPS[0];
  setZoom(next);
}

function setZoom(z, clientX, clientY) {
  z = clamp(z, 0.05, 4);
  const sc = $('#canvas-scroll');
  const r = sc.getBoundingClientRect();
  const old = zoom;
  // 没给鼠标位置时（按钮/菜单/快捷键），以视口中心为锚点，缩放后视野不跑偏
  const px = clientX != null ? clientX - r.left : sc.clientWidth / 2;
  const py = clientY != null ? clientY - r.top : sc.clientHeight / 2;
  const ox = (px + sc.scrollLeft) / (contentW() * old);
  const oy = (py + sc.scrollTop) / (contentH * old);
  // 原本就贴在左边/上边时，缩放后仍贴边，避免行名被挤出可视区
  const atLeft = sc.scrollLeft <= 1, atTop = sc.scrollTop <= 1;
  zoom = z;
  render();
  sc.scrollLeft = atLeft ? 0 : Math.max(0, ox * contentW() * zoom - px);
  sc.scrollTop = atTop ? 0 : Math.max(0, oy * contentH * zoom - py);
  updateStatus();
}

function fitWidth() {
  const sc = $('#canvas-scroll');
  const avail = sc.clientWidth - 8;
  zoom = clamp(avail / contentW(), 0.05, 2);
  render();
  sc.scrollLeft = 0;
  updateStatus();
}

canvasEl.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    setZoom(zoom * (e.deltaY > 0 ? 0.9 : 1.1), e.clientX, e.clientY);
  }
}, { passive: false });

/* ============================ 10. 导出 ============================ */
function serializeSVG() {
  const clone = canvasEl.cloneNode(true);
  const W = contentW(), H = contentH;
  clone.setAttribute('width', W);
  clone.setAttribute('height', H);
  clone.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  clone.setAttribute('xmlns', NS);
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  // 清除交互残留
  clone.querySelectorAll('.edge-dot,.edge-mark').forEach(n => n.remove());
  clone.querySelectorAll('[data-ann],[data-seg],[data-edge],[data-break],[data-row],[data-ruler],[data-clock],[data-handle]')
    .forEach(n => {
      n.removeAttribute('data-ann'); n.removeAttribute('data-seg'); n.removeAttribute('data-edge');
      n.removeAttribute('data-break'); n.removeAttribute('data-row'); n.removeAttribute('data-ruler');
      n.removeAttribute('data-clock'); n.removeAttribute('data-handle');
      if (n.getAttribute('fill') === 'transparent') n.remove();
      if (n.getAttribute('stroke') === 'transparent') n.remove();
    });
  return new XMLSerializer().serializeToString(clone);
}

function svgToCanvas(scale, cb) {
  const str = serializeSVG();
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = Math.round(contentW() * scale);
    c.height = Math.round(contentH * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    cb(c);
  };
  img.onerror = () => toast('图片生成失败', true);
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
}

function fileName(ext) {
  const base = (S.title || 'timing').replace(/[\\/:*?"<>|]/g, '_');
  return base + '-' + new Date().toISOString().slice(0, 10) + '.' + ext;
}

function exportPNG() {
  svgToCanvas(2, (c) => {
    c.toBlob(b => {
      if (b) saveBlobAs(b, fileName('png'), 'PNG 图片', 'image/png');
      else toast('PNG 生成失败', true);
    }, 'image/png');
  });
}

function exportSVG() {
  const blob = new Blob([serializeSVG()], { type: 'image/svg+xml;charset=utf-8' });
  saveBlobAs(blob, fileName('svg'), 'SVG 矢量图', 'image/svg+xml');
}

function exportPDF() {
  svgToCanvas(2, (c) => {
    const jpeg = c.toDataURL('image/jpeg', 0.94);
    const b64 = jpeg.split(',')[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const pw = +(contentW() * 0.75).toFixed(2);
    const ph = +(contentH * 0.75).toFixed(2);
    const pdf = buildPDF(bytes, c.width, c.height, pw, ph);
    saveBlobAs(new Blob([pdf], { type: 'application/pdf' }), fileName('pdf'), 'PDF 文档', 'application/pdf');
  });
}

function buildPDF(jpegBytes, imgW, imgH, pageW, pageH) {
  const enc = new TextEncoder();
  const chunks = [];
  let len = 0;
  const push = (x) => {
    const b = (typeof x === 'string') ? enc.encode(x) : x;
    chunks.push(b); len += b.length; return b.length;
  };
  const off = [];
  push('%PDF-1.4\n');

  off[1] = len;
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  off[2] = len;
  push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  off[3] = len;
  push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pageW + ' ' + pageH +
    '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n');
  off[4] = len;
  push('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + imgW + ' /Height ' + imgH +
    ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpegBytes.length + ' >>\nstream\n');
  push(jpegBytes);
  push('\nendstream\nendobj\n');

  const content = 'q\n' + pageW + ' 0 0 ' + pageH + ' 0 0 cm\n/Im0 Do\nQ\n';
  off[5] = len;
  push('5 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream\nendobj\n');

  const xrefPos = len;
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) xref += String(off[i]).padStart(10, '0') + ' 00000 n \n';
  push(xref);
  push('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n');

  const total = chunks.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  chunks.forEach(c => { out.set(c, p); p += c.length; });
  return out;
}

function copyImage() {
  svgToCanvas(2, (c) => {
    if (!navigator.clipboard || !window.ClipboardItem) { toast('当前环境不支持复制图片，请使用导出', true); return; }
    c.toBlob(b => {
      navigator.clipboard.write([new ClipboardItem({ 'image/png': b })])
        .then(() => toast('图片已复制到剪贴板'))
        .catch(() => toast('复制失败，请使用导出', true));
    }, 'image/png');
  });
}

function copySVGCode() {
  const str = serializeSVG();
  if (navigator.clipboard) {
    navigator.clipboard.writeText(str).then(() => toast('SVG 源码已复制')).catch(() => toast('复制失败', true));
  } else {
    const ta = mk('textarea', { style: 'position:fixed;left:-9999px' });
    ta.value = str; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
    toast('SVG 源码已复制');
  }
}

/* ============================ 11. 文件操作 ============================ */
let projHandle = null;   // 上次保存的工程文件句柄，用于 Ctrl+S 直接覆盖

function projectName() {
  return (S.title || 'timing').replace(/[\\/:*?"<>|]/g, '_') + '.seqgen.json';
}

async function saveProject(forcePick) {
  const data = JSON.stringify(S, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  if (!forcePick && projHandle && projHandle.createWritable) {
    try {
      const w = await projHandle.createWritable();
      await w.write(blob);
      await w.close();
      toast('已保存：' + projHandle.name);
      return;
    } catch (e) {
      projHandle = null;   // 句柄失效（文件被移动/权限收回）→ 重新选
    }
  }
  const h = await saveBlobAs(blob, projectName(), 'SeqGen 工程', 'application/json');
  if (h) projHandle = h;
}

function saveProjectAs() {
  return saveProject(true);
}

function openProject() {
  $('#file-input').click();
}
$('#file-input').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const d = JSON.parse(fr.result);
      if (!d.rows || !d.ruler) throw new Error('bad');
      S = d;
      S.annotations = S.annotations || [];
      S.breaks = S.breaks || [];
      S.seq = S.seq || 1;
      projHandle = null;
      sel = null;
      undoStack = []; redoStack = [];
      render(); renderProps(); updateUndoButtons(); scheduleSave();
      toast('已载入工程');
    } catch (err) {
      toast('文件格式无法识别', true);
    }
    e.target.value = '';
  };
  fr.readAsText(f);
});

function newProject() {
  if (S.rows.length && !confirm('新建将清空当前画布，确定继续？')) return;
  S = blankDoc();
  projHandle = null;
  sel = null;
  undoStack = []; redoStack = [];
  render(); renderProps(); updateUndoButtons(); scheduleSave();
}

function clearCanvas() {
  if (!confirm('清空画布上的所有行与标注？')) return;
  beginChange('clear');
  S.rows = []; S.annotations = []; S.breaks = [];
  sel = null;
  render(); renderProps(); scheduleSave();
}

/* ============================ 12. 绑定 UI ============================ */
function closeMenus() {
  $$('.menu').forEach(m => m.classList.remove('open'));
  $('#ctxmenu').classList.remove('open');
}

/** 把下拉菜单摆到按钮下方（视口坐标，自动避让窗口边缘） */
function placeMenu(btn, menu) {
  menu.classList.add('open');
  const r = btn.getBoundingClientRect();
  const w = menu.offsetWidth, h = menu.offsetHeight;
  let left = r.left;
  if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
  if (left < 8) left = 8;
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
  menu.style.left = Math.round(left) + 'px';
  menu.style.top = Math.round(top) + 'px';
}

function bindToolbar() {
  // 菜单
  [['#btn-file', '#menu-file'], ['#btn-export', '#menu-export'], ['#btn-zoom', '#menu-zoom'], ['#btn-theme', '#menu-theme']].forEach(([b, m]) => {
    const btn = $(b), menu = $(m);
    // 关键：工具栏是 overflow:auto 的滚动容器，会裁掉绝对/固定定位的下拉，
    // 因此把菜单挂到 body 上，彻底脱离裁剪。
    if (menu.parentElement !== document.body) document.body.appendChild(menu);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = menu.classList.contains('open');
      closeMenus();
      if (!wasOpen) placeMenu(btn, menu);
    });
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-wrap')) closeMenus();
  });
  // 工具栏横向滚动 / 窗口尺寸变化时，菜单位置会失效，直接收起
  $('#toolbar').addEventListener('scroll', closeMenus, { passive: true });
  window.addEventListener('resize', closeMenus);

  $('#menu-file').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    closeMenus();
    const a = act.getAttribute('data-act');
    if (a === 'new') newProject();
    if (a === 'open') openProject();
    if (a === 'save') saveProject();
    if (a === 'saveas') saveProjectAs();
    if (a === 'clear') clearCanvas();
    if (a === 'sample') {
      S = sampleDoc();
      sel = null; undoStack = []; redoStack = [];
      render(); renderProps(); updateUndoButtons(); scheduleSave();
    }
  });

  $('#menu-export').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    closeMenus();
    const a = act.getAttribute('data-act');
    if (a === 'png') exportPNG();
    if (a === 'svg') exportSVG();
    if (a === 'pdf') exportPDF();
    if (a === 'clipboard') copyImage();
    if (a === 'svgcode') copySVGCode();
  });

  $('#menu-zoom').addEventListener('click', (e) => {
    const act = e.target.closest('[data-zoom]');
    if (!act) return;
    closeMenus();
    const v = act.getAttribute('data-zoom');
    if (v === 'fit') fitWidth();
    else setZoom(parseFloat(v));
  });

  // 工具
  ['select', 'text', 'arrow', 'bezier', 'bracket', 'break'].forEach(t => {
    $('#tool-' + t).addEventListener('click', () => setTool(t));
  });

  // 添加行
  $('#add-clock').addEventListener('click', () => addRow('clock'));
  $('#add-signal').addEventListener('click', () => addRow('signal'));
  $('#add-bus').addEventListener('click', () => addRow('bus'));
  $('#add-sep').addEventListener('click', () => addRow('separator'));

  // 撤销重做
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);

  // 缩放
  $('#btn-zoom-in').addEventListener('click', () => zoomStep(1));
  $('#btn-zoom-out').addEventListener('click', () => zoomStep(-1));
  $('#btn-fit').addEventListener('click', fitWidth);

  // 主题
  // 配色主题
  $('#menu-theme').addEventListener('click', (e) => {
    const act = e.target.closest('[data-theme]');
    if (!act) return;
    closeMenus();
    S.theme = act.getAttribute('data-theme');
    render(); renderProps(); scheduleSave();
  });

  // 面板关闭
  $('#props-close').addEventListener('click', () => {
    $('#props').classList.toggle('hidden');
  });

  // 空画布按钮
  $$('#empty-hint [data-add]').forEach(b => {
    b.addEventListener('click', () => addRow(b.getAttribute('data-add')));
  });
  $$('#empty-hint [data-act]').forEach(b => {
    b.addEventListener('click', () => {
      S = sampleDoc(); sel = null; undoStack = []; redoStack = [];
      render(); renderProps(); updateUndoButtons(); scheduleSave();
    });
  });

  // 帮助
  $('#btn-help').addEventListener('click', showHelp);
}

function showHelp() {
  let bd = $('#help-backdrop');
  if (!bd) {
    bd = mk('div', { id: 'help-backdrop' });
    const box = mk('div', { id: 'help-box' }, bd);
    mk('h2', { text: 'SeqGen Web — 使用说明' }, box);
    mk('p', { class: 'sub', text: '本地运行的时序图编辑器 · 所有功能免费 · 无行数/标注/导出限制' }, box);

    const sec = (title, rows) => {
      mk('h3', { text: title }, box);
      rows.forEach(([k, v]) => {
        const r = mk('div', { class: 'h-row' }, box);
        mk('b', { text: k }, r);
        mk('span', { text: v }, r);
      });
    };

    sec('基础操作', [
      ['添加行', '工具栏 + Clk / + Sig / + Bus / + Sep，新行追加到底部'],
      ['插入边沿', '在信号行上双击：上半区=高电平，下半区=低电平'],
      ['移动边沿', '按住边沿左右拖动（Alt = 0.1 精度，默认 0.5 网格）'],
      ['修改属性', '点击行名打开属性面板；点击线段/边沿可单独设置'],
      ['总线取值', '双击总线行新增一侧段，直接输入数值或任意文本'],
      ['时钟相位', '拖动时钟波形左右移动，或直接在属性面板输入度数'],
      ['时间断点', '选 ⌇ 工具点击某行；按住 Shift 点击 = 全部行'],
      ['标注', 'T 文本 / ↗ 箭头 / ∿ 曲线 / ⟷ 区间（自动计算时间差）'],
      ['吸附', '箭头与区间端点靠近边沿时自动吸附，拖边沿时标注跟随'],
      ['右键', '行、线段、边沿、标注均可右键查看更多操作']
    ]);
    sec('快捷键', [
      ['撤销 / 重做', 'Ctrl + Z / Ctrl + Y'],
      ['保存 / 打开', 'Ctrl + S / Ctrl + O'],
      ['复制图片', 'Ctrl + Shift + C'],
      ['删除所选', 'Delete / Backspace'],
      ['缩放', 'Ctrl + 滚轮，或工具栏 ⊖ ⊕'],
      ['平移', '中键拖动，或滚动条'],
      ['退出工具 / 取消', 'Esc']
    ]);
    sec('导出', [
      ['PNG', '2× 分辨率位图，适合文档与网页'],
      ['SVG', '真矢量，任意缩放不失真，可导入 Visio / Illustrator'],
      ['PDF', '按 96dpi 换算页面尺寸，直接插入 LaTeX / FrameMaker'],
      ['复制', '复制 PNG 到剪贴板，可粘贴进 Word / PowerPoint']
    ]);
    sec('数据', [
      ['自动保存', '每次编辑后保存在浏览器本地（localStorage）'],
      ['工程文件', '文件 → 保存工程，导出 .seqgen.json，可备份/迁移']
    ]);

    const close = mk('button', { class: 'close', text: '开始使用' }, box);
    close.addEventListener('click', () => bd.classList.remove('open'));
    bd.addEventListener('click', (e) => { if (e.target === bd) bd.classList.remove('open'); });
    document.body.appendChild(bd);
  }
  bd.classList.add('open');
}

function bindKeys() {
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const editing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
    if (editing) return;

    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveProjectAs(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); return; }
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openProject(); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); copyImage(); return; }
    if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); newProject(); return; }

    if (e.key === 'Escape') {
      // 有下拉菜单或右键菜单打开时，Esc 只负责收起它们
      if ($$('.menu.open').length || $('#ctxmenu').classList.contains('open')) {
        closeMenus();
        return;
      }
      setTool('select');
      sel = null; render(); renderProps();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelection();
      return;
    }
    if (mod && e.key === '0') { e.preventDefault(); setZoom(1); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomStep(1); return; }
    if (e.key === '-') { e.preventDefault(); zoomStep(-1); return; }

    // 方向键微调标注
    if (sel && sel.kind === 'ann' && e.key.startsWith('Arrow')) {
      const a = S.annotations.find(x => x.id === sel.id);
      if (!a) return;
      const step = e.shiftKey ? 10 : 1;
      e.preventDefault();
      beginChange('nudge' + a.id);
      if (a.type === 'text') { a.x += (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0); a.y += (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0); }
      else {
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (a.a1 || a.a2) {
          if (a.a1) a.a1.dy += dy;
          if (a.a2) a.a2.dy += dy;
          if (a.a1) a.a1.t = clamp(a.a1.t + dx / PXPU, 0, S.span);
          if (a.a2) a.a2.t = clamp(a.a2.t + dx / PXPU, 0, S.span);
        } else {
          a.x1 += dx; a.y1 += dy; a.x2 += dx; a.y2 += dy;
        }
      }
      render(); scheduleSave();
    }

    // 总线段直接输入
    if (sel && sel.kind === 'seg' && e.key.length === 1 && !mod && !e.altKey) {
      const row = rowById(sel.rowId);
      if (row && row.type === 'bus') {
        const seg = stepSegments(row)[sel.index];
        if (seg) { e.preventDefault(); openSegEditor(row, seg, e.key); }
      }
    }
  });
}

function deleteSelection() {
  if (!sel) return;
  if (sel.kind === 'ann') {
    beginChange('del-ann');
    S.annotations = S.annotations.filter(a => a.id !== sel.id);
    sel = null;
  } else if (sel.kind === 'break') {
    beginChange('del-br');
    S.breaks = S.breaks.filter(b => b.id !== sel.id);
    sel = null;
  } else if (sel.kind === 'edge') {
    const row = rowById(sel.rowId);
    if (row && row.edges[sel.index]) {
      beginChange('del-edge');
      row.edges.splice(sel.index, 1);
      sel = { kind: 'row', rowId: row.id };
    }
  } else if (sel.kind === 'row') {
    const row = rowById(sel.rowId);
    if (row) { deleteRow(row); return; }
  } else if (sel.kind === 'seg') {
    const row = rowById(sel.rowId);
    if (row) {
      const seg = stepSegments(row)[sel.index];
      const i = row.edges.findIndex(e => Math.abs(e.t - seg.t0) < 0.001);
      if (i >= 0) {
        beginChange('del-seg');
        row.edges.splice(i, 1);
        sel = { kind: 'row', rowId: row.id };
      }
    }
  }
  render(); renderProps(); scheduleSave();
}

/* ============================ 13. 启动 ============================ */
function init() {
  let loaded = null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) loaded = JSON.parse(raw);
  } catch (e) { }

  S = (loaded && loaded.rows) ? loaded : sampleDoc();
  S.annotations = S.annotations || [];
  S.breaks = S.breaks || [];
  S.theme = S.theme || 'dark';
  S.seq = S.seq || 1;
  // 老文档没有「每格宽度」，按原来的 8px/单位 反推，显示效果保持不变
  if (!S.ruler) S.ruler = { prefix: '', suffix: 'ns', start: 0, increment: 10 };
  if (!S.ruler.gridPx) S.ruler.gridPx = Math.round(clamp((+S.ruler.increment || 10) * 8, 6, 400));

  T = THEME[S.theme] || THEME.dark;
  document.documentElement.setAttribute('data-theme', S.theme);

  bindToolbar();
  bindKeys();
  render();
  renderProps();
  updateUndoButtons();
  updateStatus();
  setTool('select');

  // 首次打开：若画布超出可视宽度，自动缩放到适合宽度
  const sc = $('#canvas-scroll');
  const avail = sc.clientWidth - 6;
  if (avail > 240 && contentW() > avail) {
    zoom = Math.max(0.5, Math.min(1, avail / contentW()));
    render();
    updateStatus();
  }

  // 首次使用提示（只出现一次）
  try {
    if (!localStorage.getItem(LS_KEY + ':onboard')) {
      localStorage.setItem(LS_KEY + ':onboard', '1');
      setTimeout(() => toast('鼠标移到某行波形上会出现圆点，拖动圆点即可调整边沿；双击波形翻转电平；右键改状态/删除', false, 7000), 800);
    }
  } catch (e) { }
}

init();
