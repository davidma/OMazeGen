// Page logic for O-Maze Setter: settings, course list, previews and exports.
(function () {
  const $ = id => document.getElementById(id);
  const STORE = 'omaze-settings-v2';
  const SPACING = 2;   // default metres between posts, for tape lengths and the squareness check
  // Course keys are 1, 2, 3… in the order courses were added, so the same course list
  // and seed always give the same routes, and removing one course leaves the rest alone.
  const newKey = () => 1 + Math.max(0, ...courses.map(c => c.key || 0));
  const LEVELS = { 1: 'easy', 2: 'fairly easy', 3: 'moderate', 4: 'hard', 5: 'difficult' };
  const FIELDS = ['w', 'h', 'spacing', 'controls', 'dummies', 'firstCode', 'easiestShare', 'loops', 'minShortcut',
                  'extraGaps', 'branchiness', 'seed', 'event', 'lines', 'codes', 'extras', 'coords'];
  const clampInt = (v, lo, hi, dflt) => { v = Math.round(+v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt; };
  const fmt = n => (Math.round(n * 10) / 10).toLocaleString();
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const randomSeed = () => String(Math.floor(Math.random() * 1e9));

  let courses = OMaze.DEFAULTS.courses.map((c, i) => ({ ...c, key: i + 1 }));
  let view = 0;        // index of the course shown on the Map tab, or 'master'
  let current = null;  // latest generated maze

  // ---- Settings -------------------------------------------------------------
  const get = k => ($(k).type === 'checkbox' ? $(k).checked : $(k).value);
  // ---- Share links ------------------------------------------------------------
  // A share link carries every setting and the course list (name, level, key and
  // re-roll count) as base64url JSON in ?s=. Generation is deterministic, so that is
  // enough to rebuild the exact maze, flags and courses. It also carries the generator
  // version, because a later change to the generator would rebuild old links differently.
  const toB64 = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fromB64 = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
  function shareState() {
    const f = {};
    for (const k of FIELDS) f[k] = get(k);
    return { v: OMaze.VERSION, f, c: courses.map(c => [c.name, +c.difficulty, c.key, c.variant || 0]) };
  }
  function shareUrl() {
    const base = location.href.split(/[?#]/)[0];
    return `${base}?s=${toB64(JSON.stringify(shareState()))}`;
  }
  function readShare(param) {
    const d = JSON.parse(fromB64(param));
    if (!d || typeof d.f !== 'object' || !Array.isArray(d.c) || !d.c.length) throw new Error('bad share data');
    return {
      version: d.v,
      fields: d.f,
      courses: d.c.map(([name, difficulty, key, variant], i) => ({
        name: String(name || `Course ${i + 1}`), difficulty: +difficulty || 3, key: +key || i + 1, variant: +variant || 0,
      })),
    };
  }
  function notify(text) {
    $('notice').textContent = text;
    $('notice').hidden = !text;
  }

  function load() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) {}
    const query = new URLSearchParams(location.search);
    // A share link replaces the saved settings entirely.
    if (query.has('s')) {
      try {
        const shared = readShare(query.get('s'));
        saved = { ...shared.fields, courses: shared.courses };
        notify(shared.version === OMaze.VERSION
          ? 'Loaded the shared maze and courses. Your own settings were replaced; changes you make now are saved as usual.'
          : 'This link was made with a different version of O-Maze Setter, so the maze and courses may not match what was shared. The settings were loaded as they were.');
      } catch (e) {
        notify("This share link is damaged or incomplete, so your own saved settings were loaded instead. Ask for the link again.");
      }
      history.replaceState(null, '', location.href.replace(/[?&]s=[^&#]*/, '').replace(/\?(#|$)/, '$1'));
    }
    for (const k of FIELDS) {
      const v = query.has(k) ? query.get(k) : saved[k];
      if (v == null) continue;
      if ($(k).type === 'checkbox') $(k).checked = v === true || v === 'true' || v === '1';
      else $(k).value = v;
    }
    if (Array.isArray(saved.courses) && saved.courses.length) courses = saved.courses;
    if (query.has('courses')) courses = query.get('courses').split(',').map((d, i) => ({ name: `Course ${i + 1}`, difficulty: +d }));
    courses.forEach(c => { if (!c.key) c.key = newKey(); });
    if (!$('seed').value) $('seed').value = randomSeed();
  }
  function save() {
    try {
      const s = { courses };
      for (const k of FIELDS) s[k] = get(k);
      localStorage.setItem(STORE, JSON.stringify(s));
    } catch (e) {}
  }
  function settings() {
    return {
      w: clampInt(get('w'), 3, 60, 11),
      h: clampInt(get('h'), 3, 60, 9),
      spacing: Math.max(0.5, +get('spacing') || SPACING),
      controls: clampInt(get('controls'), 0, 200, 14),
      dummies: clampInt(get('dummies'), 0, 200, 2),
      firstCode: clampInt(get('firstCode'), 1, 999, 201),
      easiestShare: Math.min(1, Math.max(0.1, +get('easiestShare') || 0.5)),
      loops: +get('loops'),
      minShortcut: +get('minShortcut'),
      extraGaps: +get('extraGaps'),
      branchiness: +get('branchiness'),
      seed: clampInt(get('seed'), 0, 4294967295, 1),
      event: String(get('event')).trim() || 'O-Maze',
      lines: get('lines'), codes: get('codes'), extras: get('extras'), coords: get('coords'),
    };
  }

  // ---- Course list ----------------------------------------------------------
  function renderCourseList() {
    const list = $('course-list');
    list.innerHTML = '';
    courses.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'course-row';
      row.innerHTML = `
        <input class="plain" type="text" id="course-name-${i}" aria-label="Course ${i + 1} name" value="${esc(c.name)}">
        <select id="course-level-${i}" aria-label="Course ${i + 1} difficulty">
          ${[1, 2, 3, 4, 5].map(l => `<option value="${l}"${l === +c.difficulty ? ' selected' : ''}>Level ${l}</option>`).join('')}
        </select>
        <button type="button" class="icon reroll" aria-label="New route for ${esc(c.name)}" title="New route for this course">↻</button>
        <button type="button" class="icon remove" aria-label="Remove ${esc(c.name)}" title="Remove this course"${courses.length === 1 ? ' disabled' : ''}>×</button>`;
      row.querySelector('input').addEventListener('change', e => { c.name = e.target.value.trim() || `Course ${i + 1}`; run(); });
      row.querySelector('select').addEventListener('change', e => { c.difficulty = +e.target.value; run(); });
      row.querySelector('.reroll').addEventListener('click', () => { c.variant = (c.variant || 0) + 1; view = i; run(); });
      row.querySelector('.remove').addEventListener('click', () => {
        courses.splice(i, 1);
        if (view !== 'master' && view >= courses.length) view = courses.length - 1;
        renderCourseList();
        run();
      });
      list.appendChild(row);
    });
  }
  $('add-course').addEventListener('click', () => {
    const last = courses[courses.length - 1];
    courses.push({ name: `Course ${courses.length + 1}`, difficulty: last ? last.difficulty : 3, key: newKey() });
    renderCourseList();
    run();
  });

  // ---- Generate and render ----------------------------------------------------
  function run() {
    const s = settings();
    $('loops-out').textContent = Math.round(s.loops * 100) + '% of inner tape';
    $('minShortcut-out').textContent = s.minShortcut + ' squares';
    $('extraGaps-out').textContent = s.extraGaps;
    $('branchiness-out').textContent = s.branchiness <= 0.2 ? 'long, winding' : s.branchiness >= 0.8 ? 'short, branchy' : 'mixed';
    $('easiestShare-out').textContent = Math.round(s.easiestShare * 100) + '% of controls';
    save();

    const m = OMaze.generate({
      width: s.w, height: s.h, seed: s.seed,
      loops: s.loops, minShortcut: s.minShortcut, extraGaps: s.extraGaps, branchiness: s.branchiness,
      controls: s.controls, dummies: s.dummies, firstCode: s.firstCode, easiestShare: s.easiestShare,
      courses,
    });
    current = m;

    const usable = m.controls.filter(c => !c.dummy).length;
    const hint = [];
    if (m.controls.length < s.controls) hint.push(`This maze has room for ${m.controls.length} controls.`);
    if (s.dummies >= s.controls && s.controls > 0) hint.push('At least one control must be usable on a course.');
    if (m.controls.length) hint.unshift(`Codes ${s.firstCode}–${s.firstCode + m.controls.length - 1}.`);
    $('controls-hint').textContent = hint.join(' ');
    const perLevel = [1, 2, 3, 4, 5].map(L => usable ? Math.min(usable, Math.max(1, Math.round(usable * (s.easiestShare + (1 - s.easiestShare) * (L - 1) / 4)))) : 0);
    $('share-hint').textContent = usable ? `Levels 1 to 5 visit ${perLevel.join(', ')} of the ${usable} usable controls. All courses share the same flags.` : '';

    const problems = OMaze.validate(m);
    $('problems').textContent = problems.length ? 'Rule check failed: ' + problems.join('; ') : '';

    const sheet = OMaze.buildSheet(m);
    renderViews(m);
    renderMap(m, s);
    renderCourses(m, s);
    renderSheet(m, sheet, s);
  }

  const courseLength = co => co.legs.reduce((t, l) => t + l.length, 0);
  const straightLength = co => co.legs.reduce((t, l) => t + l.straight, 0);
  const hasChoice = l => l.alt !== Infinity && l.alt <= l.length * 1.3;
  const stopName = (m, co, i) => i === 0 ? 'Start' : i > co.stops.length ? 'Finish' : `${i}-${m.controls[co.stops[i - 1]].code}`;
  const choiceText = l => l.alt === Infinity ? 'One route' : l.alt === l.length ? 'Two equal routes' : `Alternative +${l.alt - l.length}`;

  function renderViews(m) {
    if (view !== 'master' && view >= m.courses.length) view = 0;
    const box = $('views');
    box.innerHTML = '';
    const add = (label, v) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-pressed', String(view === v));
      b.addEventListener('click', () => { view = v; renderViews(current); renderMap(current, settings()); });
      box.appendChild(b);
    };
    m.courses.forEach((co, i) => add(co.name, i));
    add('Master map', 'master');
    // The course-only toggles don't apply to the master map.
    ['lines', 'codes', 'extras'].forEach(id => { $(id).closest('label').hidden = view === 'master'; });
  }

  function renderMap(m, s) {
    $('map').innerHTML = view === 'master'
      ? OMaze.renderSvg(m, { course: null, coords: s.coords })
      : OMaze.renderSvg(m, { course: view, coords: s.coords, lines: s.lines, codes: s.codes, extras: s.extras });
  }

  function renderCourses(m, s) {
    const metres = n => ` <span class="hint">${fmt(n * s.spacing)} m</span>`;
    $('course').innerHTML = m.courses.map(co => {
      if (!co.stops.length) return `<div><h3>${esc(co.name)}</h3><p class="hint">Add controls to the maze to plan this course.</p></div>`;
      return `
      <div>
        <h3>${esc(co.name)}<small>Level ${co.difficulty}, ${LEVELS[co.difficulty]}</small></h3>
        <dl class="facts">
          <dt>Controls</dt><dd>${co.stops.map((k, i) => `${i + 1}-${m.controls[k].code}`).join(', ')}</dd>
          <dt>Length</dt><dd>${fmt(straightLength(co) * s.spacing)} m straight line, ${fmt(courseLength(co) * s.spacing)} m shortest route</dd>
          <dt>Route choice</dt><dd>${co.legs.filter(hasChoice).length} of ${co.legs.length} legs have a second route within 30%</dd>
        </dl>
        <div class="runs-wrap"><table class="runs">
          <thead><tr><th>Leg</th><th>From → to</th><th>Shortest route</th><th>Straight line</th><th>Route choice</th></tr></thead>
          <tbody>${co.legs.map((l, i) => `
            <tr>
              <td>${i + 1}</td>
              <td class="list">${stopName(m, co, i)} → ${stopName(m, co, i + 1)}</td>
              <td class="num">${l.length} squares${metres(l.length)}</td>
              <td class="num">${fmt(l.straight)} squares</td>
              <td><span class="chip ${hasChoice(l) ? 'yes' : 'no'}">${choiceText(l)}</span></td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>`;
    }).join('');
  }

  // The setting-out procedure as plain text, shared by the page and the master PDF:
  // lay out the posts, lay the tape piece by piece, then hang the controls.
  function setOut(m, sheet, s) {
    const lastCol = OMaze.colName(m.width - 1);
    const [a1, top, a10, l1] = sheet.corners;
    const diag = Math.hypot((m.width - 1) * s.spacing, (m.height - 1) * s.spacing);
    const doubled = sheet.pieces.reduce((t, p) => t + p.doubled, 0);
    const len = p => fmt(p.segments * s.spacing);
    const openings = [`start ${sheet.start}`, `finish ${sheet.finish}`, ...sheet.gaps].join(', ');
    return {
      posts: `Put in ${sheet.posts} posts in a ${m.width} × ${m.height} grid, ${s.spacing} m apart: columns A–${lastCol} ` +
        `from west to east, rows 1–${m.height} from the start side. The grid is ${fmt((m.width - 1) * s.spacing)} × ` +
        `${fmt((m.height - 1) * s.spacing)} m. Check it is square before taping: both diagonals, ${a1} to ${top} and ` +
        `${a10} to ${l1}, should measure ${fmt(diag)} m.`,
      tape: `${sheet.pieces.length} pieces of tape, ${fmt(sheet.tapeSegments * s.spacing)} m in all` +
        (sheet.pieces.length ? `, longest ${len(sheet.pieces[0])} m` : '') +
        (doubled ? `. ${fmt(doubled * s.spacing)} m of that doubles back on short out-and-back spurs, to keep the pieces long` : '') +
        `. Tie each piece round its first post, wrap it round every post it passes, and tie off at the last. ` +
        `Leave the openings untaped: ${openings}.`,
      pieces: sheet.pieces.map((p, i) => ({
        title: `Piece ${i + 1}`,
        length: `${len(p)} m`,
        route: `Start at ${p.start}, ${p.steps.join(', ')}, tie off ${p.end.startsWith('back') ? p.end : 'at ' + p.end}.` +
          (p.doubled ? ` Doubles back over ${p.doubled} segment${p.doubled > 1 ? 's' : ''}.` : ''),
      })),
      controls: 'Hang each flag where the master map shows it. Every flag is marked there with its code.',
    };
  }

  function renderSheet(m, sheet, s) {
    const so = setOut(m, sheet, s);
    $('sheet').innerHTML = `
      <div>
        <h3>1. Lay out the posts</h3>
        <p class="step">${so.posts}</p>
      </div>
      <div>
        <h3>2. Lay the tape</h3>
        <p class="step">${so.tape}</p>
        <div class="runs-wrap"><table class="runs pieces">
          <thead><tr><th>Piece</th><th>Length</th><th>Route</th></tr></thead>
          <tbody>${so.pieces.map((p, i) => `<tr><td>${i + 1}</td><td class="num">${p.length}</td><td>${p.route}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>
      <div>
        <h3>3. Hang the controls</h3>
        <p class="step">${so.controls}</p>
      </div>`;
  }

  // ---- Exports ----------------------------------------------------------------
  const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'o-maze';
  const MARGIN = 12;

  function download(filename, data, type) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function svgSize(svg) {
    const v = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    return [+v[1], +v[2]];
  }

  // Start a page in the orientation that suits the map: landscape for wide mazes.
  function addPage(doc, svg) {
    const [sw, sh] = svgSize(svg);
    const orientation = sw / sh > 1.1 ? 'landscape' : 'portrait';
    if (!doc) return new window.jspdf.jsPDF({ orientation, unit: 'mm', format: 'a4' });
    doc.addPage('a4', orientation);
    return doc;
  }

  // Draw an SVG string as large as fits in the box, centred across and pinned to
  // the top. Returns the bottom edge of the drawn map.
  async function drawSvg(doc, svg, x, y, w, h) {
    const [sw, sh] = svgSize(svg);
    const k = Math.min(w / sw, h / sh);
    const dw = sw * k, dh = sh * k;
    const el = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    $('pdf-stage').appendChild(el);
    try {
      const opts = { x: x + (w - dw) / 2, y, width: dw, height: dh };
      if (typeof doc.svg === 'function') await doc.svg(el, opts);
      else await window.svg2pdf.svg2pdf(el, doc, opts);
    } finally {
      el.remove();
    }
    doc.setLineWidth(0.2);   // the SVG conversion leaves its last stroke width set
    return y + dh;
  }

  function pageHeader(doc, title, subtitle, detail) {
    doc.setTextColor(26, 31, 28);
    doc.setFont('helvetica', 'bold').setFontSize(18).text(title, MARGIN, MARGIN + 6);
    doc.setFontSize(13).text(subtitle, MARGIN, MARGIN + 13);
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(93, 104, 98).text(detail, MARGIN, MARGIN + 19);
    return MARGIN + 25;
  }

  const footnote = (m, s) => `Seed ${m.seed} · ${m.width} × ${m.height} posts · 1 square = ${s.spacing} m · O-Maze Setter`;

  // One A4 page per course: the competitors' map, course details and control codes.
  async function coursesPdf(m, s) {
    let doc = null;
    for (let i = 0; i < m.courses.length; i++) {
      const co = m.courses[i];
      const svg = OMaze.renderSvg(m, { course: i, coords: s.coords, lines: s.lines, codes: s.codes, extras: false });
      doc = addPage(doc, svg);
      const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
      const top = pageHeader(doc, s.event, `${co.name} · Level ${co.difficulty} (${LEVELS[co.difficulty]})`,
        `${co.stops.length} controls · ${fmt(straightLength(co) * s.spacing)} m straight line · ${fmt(courseLength(co) * s.spacing)} m shortest route`);
      doc.setFont('helvetica', 'normal').setFontSize(9);
      const list = doc.splitTextToSize('Controls: ' + co.stops.map((k, n) => `${n + 1}-${m.controls[k].code}`).join('   '), W - 2 * MARGIN);
      const foot = list.length * 4.2 + 10;
      const bottom = await drawSvg(doc, svg, MARGIN, top, W - 2 * MARGIN, H - top - MARGIN - foot);
      doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(26, 31, 28).text(list, MARGIN, bottom + 6);
      doc.setFontSize(8).setTextColor(122, 131, 126).text(footnote(m, s), MARGIN, H - MARGIN + 2);
    }
    return doc;
  }

  // Simple text table that flows onto new portrait pages.
  function textTable(doc, st, title, cols, rows) {
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const lastW = W - 2 * MARGIN - cols.slice(0, -1).reduce((t, c) => t + c.w, 0);
    const header = () => {
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(93, 104, 98);
      let x = MARGIN;
      cols.forEach(c => { doc.text(c.head.toUpperCase(), x, st.y); x += c.w; });
      st.y += 2;
      doc.setDrawColor(211, 218, 213).setLineWidth(0.2).line(MARGIN, st.y, W - MARGIN, st.y);
      st.y += 4.5;
    };
    if (st.y + 20 > H - MARGIN) { doc.addPage('a4', 'portrait'); st.y = MARGIN + 6; }
    if (title) {
      doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(26, 31, 28).text(title, MARGIN, st.y);
      st.y += 7;
    }
    header();
    for (const r of rows) {
      doc.setFont('helvetica', 'normal').setFontSize(9);
      const cells = r.map((v, i) => doc.splitTextToSize(String(v), (i === cols.length - 1 ? lastW : cols[i].w) - 2));
      const lines = Math.max(...cells.map(c => c.length));
      if (st.y + lines * 4 > H - MARGIN) { doc.addPage('a4', 'portrait'); st.y = MARGIN + 6; header(); }
      doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(26, 31, 28);
      let x = MARGIN;
      cells.forEach((c, i) => { doc.text(c, x, st.y); x += cols[i].w; });
      st.y += lines * 4 + 1.2;
    }
    st.y += 6;
  }

  // Wrapped paragraph that flows onto new portrait pages.
  function paragraph(doc, st, text, size = 10) {
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    doc.setFont('helvetica', 'normal').setFontSize(size).setTextColor(26, 31, 28);
    for (const line of doc.splitTextToSize(text, W - 2 * MARGIN)) {
      if (st.y > H - MARGIN) { doc.addPage('a4', 'portrait'); st.y = MARGIN + 6; }
      doc.text(line, MARGIN, st.y);
      st.y += size * 0.45;
    }
    st.y += 4;
  }
  function heading(doc, st, text) {
    if (st.y + 20 > doc.internal.pageSize.getHeight() - MARGIN) { doc.addPage('a4', 'portrait'); st.y = MARGIN + 6; }
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(26, 31, 28).text(text, MARGIN, st.y);
    st.y += 7;
  }

  // Master map (every flag with its code), then the setting-out procedure.
  async function masterPdf(m, s) {
    const svg = OMaze.renderSvg(m, { course: null, coords: true });
    const doc = addPage(null, svg);
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const dummies = m.controls.filter(c => c.dummy).length;
    const top = pageHeader(doc, s.event, 'Master map',
      `${m.controls.length} controls hung, ${dummies} of them dummies · purple: on a course · grey: not on any course · dashed: dummy`);
    await drawSvg(doc, svg, MARGIN, top, W - 2 * MARGIN, H - top - MARGIN - 6);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(122, 131, 126).text(footnote(m, s), MARGIN, H - MARGIN + 2);

    const sheet = OMaze.buildSheet(m);
    const so = setOut(m, sheet, s);
    doc.addPage('a4', 'portrait');
    const st = { y: pageHeader(doc, s.event, 'Setting out',
      `${sheet.posts} posts · ${sheet.pieces.length} pieces of tape · ${fmt(sheet.tapeSegments * s.spacing)} m of tape`) + 2 };
    heading(doc, st, '1. Lay out the posts');
    paragraph(doc, st, so.posts);
    heading(doc, st, '2. Lay the tape');
    paragraph(doc, st, so.tape);
    textTable(doc, st, '', [{ head: 'Piece', w: 14 }, { head: 'Length', w: 18 }, { head: 'Route', w: 0 }],
      so.pieces.map((p, i) => [i + 1, p.length, p.route]));
    heading(doc, st, '3. Hang the controls');
    paragraph(doc, st, so.controls);
    return doc;
  }

  function onExport(button, label, work) {
    button.addEventListener('click', async () => {
      const status = $('export-status');
      button.disabled = true;
      status.textContent = `Preparing the ${label}…`;
      try {
        await work();
        status.textContent = `Downloaded the ${label}.`;
      } catch (e) {
        status.textContent = `Couldn't create the ${label}: ${e.message}. Reload the page and try again.`;
      } finally {
        button.disabled = false;
      }
    });
  }
  const needPdf = () => { if (!window.jspdf) throw new Error('the PDF library did not load'); };
  onExport($('export-courses'), 'course maps', async () => {
    needPdf();
    const s = settings();
    (await coursesPdf(current, s)).save(`${slug(s.event)}-courses.pdf`);
  });
  onExport($('export-master'), 'master map', async () => {
    needPdf();
    const s = settings();
    (await masterPdf(current, s)).save(`${slug(s.event)}-master.pdf`);
  });
  onExport($('export-xml'), 'IOF XML file', async () => {
    const s = settings();
    download(`${slug(s.event)}-courses.xml`, OMaze.iofXml(current, { event: s.event, spacing: s.spacing }), 'application/xml');
  });

  $('share').addEventListener('click', async () => {
    const url = shareUrl();
    const status = $('export-status');
    try {
      await navigator.clipboard.writeText(url);
      status.textContent = 'Share link copied. Anyone who opens it gets this exact maze and these courses.';
    } catch (e) {
      // Clipboard refused (some browsers, or a page opened from a file): show the link to copy by hand.
      status.textContent = 'Copy this share link: ';
      const box = document.createElement('input');
      box.className = 'plain';
      box.readOnly = true;
      box.value = url;
      box.setAttribute('aria-label', 'Share link');
      status.appendChild(box);
      box.select();
    }
  });

  // ---- Tabs and controls ---------------------------------------------------------
  const tabs = ['map', 'course', 'sheet'];
  function showTab(name) {
    for (const t of tabs) {
      $('tab-' + t).setAttribute('aria-selected', String(t === name));
      $('panel-' + t).hidden = t !== name;
    }
  }
  tabs.forEach(t => $('tab-' + t).addEventListener('click', () => showTab(t)));
  if (tabs.includes(location.hash.slice(1))) showTab(location.hash.slice(1));

  document.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
    const [id, d] = b.dataset.step.split(':');
    $(id).value = clampInt(+$(id).value + +d, 3, 60, +$(id).value);
    run();
  }));
  // A new maze starts every course from its first route again.
  $('new').addEventListener('click', () => { $('seed').value = randomSeed(); courses.forEach(c => { c.variant = 0; }); run(); });
  FIELDS.forEach(k => {
    const el = $(k);
    el.addEventListener(el.type === 'range' || el.type === 'checkbox' ? 'input' : 'change', k === 'event' ? save : run);
  });
  ['w', 'h'].forEach(id => $(id).addEventListener('input', () => { if (+$(id).value >= 3 && +$(id).value <= 60) run(); }));

  load();
  renderCourseList();
  run();

  // Headless check: ?selftest builds both PDFs and the XML and reports their sizes;
  // adding &dump also writes them into the page as base64, for inspection.
  const query = new URLSearchParams(location.search);
  if (query.has('selftest')) {
    (async () => {
      const s = settings();
      try {
        const cp = await coursesPdf(current, s), mp = await masterPdf(current, s);
        const xml = OMaze.iofXml(current, { event: s.event, spacing: s.spacing });
        const link = shareUrl(), back = readShare(new URL(link).searchParams.get("s"));
        const roundTrip = JSON.stringify(back.fields) === JSON.stringify(shareState().f) && back.courses.length === courses.length;
        $("export-status").textContent = `SELFTEST OK courses.pdf=${cp.output("arraybuffer").byteLength} master.pdf=${mp.output("arraybuffer").byteLength} xml=${xml.length} share=${roundTrip ? "ok" : "MISMATCH"} link=${link}`;
        if (query.has('dump')) {
          const pre = document.createElement('pre');
          pre.id = 'dump';
          pre.hidden = true;
          pre.textContent = [cp.output('datauristring'), mp.output('datauristring'), btoa(unescape(encodeURIComponent(xml)))].join('\n');
          document.body.appendChild(pre);
        }
      } catch (e) {
        $('export-status').textContent = `SELFTEST FAIL ${e.message}`;
      }
    })();
  }
})();
