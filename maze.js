// Orienteering maze generator.
// Grid is W x H posts (vertices); walls are tape segments between adjacent posts.
//   hw[y][x]: horizontal segment from post (x,y) to (x+1,y)   y in 0..H-1, x in 0..W-2
//   vw[y][x]: vertical segment from post (x,y) to (x,y+1)     y in 0..H-2, x in 0..W-1
// Cells ("squares") are the (W-1) x (H-1) spaces between posts. y = 0 is the top (finish side).
(function (global) {
  'use strict';

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function grid(rows, cols, value) {
    return Array.from({ length: rows }, () => new Array(cols).fill(value));
  }

  function shuffle(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  const DEFAULTS = {
    loops: 0.12,       // fraction of interior walls to try removing after the perfect maze is built
    minShortcut: 5,    // only remove a wall if it saves at least this many steps (avoids trivial loops)
    extraGaps: 2,      // extra perimeter openings besides start and finish
    branchiness: 0.5,  // 0 = long winding corridors (DFS), 1 = short branchy (Prim-like)
    controls: 14,      // total controls hung in the maze, dummies included
    dummies: 2,        // how many of those are dummies (hung, but never on a course)
    easiestShare: 0.5, // share of the other (usable) controls a level 1 course visits; level 5 visits all
    courses: [         // courses sharing the maze's controls: name and difficulty, 1 (easy) to 5 (difficult)
      { name: 'Course 1', difficulty: 1 },
      { name: 'Course 2', difficulty: 3 },
      { name: 'Course 3', difficulty: 5 },
    ],
    firstCode: 201,    // control codes run contiguously from here
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Distance from point (x,y) to segment l = [x1,y1,x2,y2].
  function segDist(x, y, l) {
    const dx = l[2] - l[0], dy = l[3] - l[1];
    const k = clamp(((x - l[0]) * dx + (y - l[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    return Math.hypot(x - l[0] - k * dx, y - l[1] - k * dy);
  }

  function generate(options) {
    const opts = Object.assign({}, DEFAULTS, options);
    const W = opts.width, H = opts.height;
    if (!(W >= 2 && H >= 2)) throw new Error('Width and height must be at least 2 posts');
    const seed = opts.seed != null ? opts.seed >>> 0 : Math.floor(Math.random() * 2 ** 32);
    const rand = mulberry32(seed);
    const randInt = n => Math.floor(rand() * n);
    const cw = W - 1, ch = H - 1;

    const hw = grid(H, cw, true);
    const vw = grid(ch, W, true);

    // Wall helpers. A wall is {h: bool, x, y}.
    const isWall = w => (w.h ? hw[w.y][w.x] : vw[w.y][w.x]);
    const setWall = (w, v) => { if (w.h) hw[w.y][w.x] = v; else vw[w.y][w.x] = v; };
    const ends = w => (w.h ? [[w.x, w.y], [w.x + 1, w.y]] : [[w.x, w.y], [w.x, w.y + 1]]);
    const degree = (x, y) =>
      (x > 0 && hw[y][x - 1] ? 1 : 0) + (x < cw && hw[y][x] ? 1 : 0) +
      (y > 0 && vw[y - 1][x] ? 1 : 0) + (y < ch && vw[y][x] ? 1 : 0);
    // Every post must keep at least one tape touching it.
    const canRemove = w => isWall(w) && ends(w).every(([x, y]) => degree(x, y) > 1);

    // 1. Perfect maze over cells (growing-tree algorithm).
    const visited = grid(ch, cw, false);
    const active = [[randInt(cw), randInt(ch)]];
    visited[active[0][1]][active[0][0]] = true;
    while (active.length) {
      const i = rand() < opts.branchiness ? randInt(active.length) : active.length - 1;
      const [x, y] = active[i];
      const nbrs = [];
      if (x > 0 && !visited[y][x - 1]) nbrs.push([x - 1, y]);
      if (x < cw - 1 && !visited[y][x + 1]) nbrs.push([x + 1, y]);
      if (y > 0 && !visited[y - 1][x]) nbrs.push([x, y - 1]);
      if (y < ch - 1 && !visited[y + 1][x]) nbrs.push([x, y + 1]);
      if (!nbrs.length) { active.splice(i, 1); continue; }
      const [nx, ny] = nbrs[randInt(nbrs.length)];
      if (nx !== x) vw[y][Math.max(x, nx)] = false;
      else hw[Math.max(y, ny)][x] = false;
      visited[ny][nx] = true;
      active.push([nx, ny]);
    }

    // 2. Fixed start (below bottom edge) and finish (above top edge), centred.
    // When the edge has an even number of segments the exact centre is a post,
    // so the gap uses the segment just left of centre.
    const gapX = Math.floor((cw - 1) / 2);
    const startGap = { h: true, x: gapX, y: ch };
    const finishGap = { h: true, x: gapX, y: 0 };
    setWall(startGap, false);
    setWall(finishGap, false);

    // 3. Extra perimeter openings (never adjacent to another opening).
    const perimeter = [];
    for (let x = 0; x < cw; x++) perimeter.push({ h: true, x, y: 0 }, { h: true, x, y: ch });
    for (let y = 0; y < ch; y++) perimeter.push({ h: false, x: 0, y }, { h: false, x: cw, y });
    const key = ([x, y]) => x + ',' + y;
    const gapPosts = new Set([...ends(startGap), ...ends(finishGap)].map(key));
    const extraGaps = [];
    for (const w of shuffle(perimeter, rand)) {
      if (extraGaps.length >= opts.extraGaps) break;
      if (!canRemove(w) || ends(w).some(p => gapPosts.has(key(p)))) continue;
      setWall(w, false);
      ends(w).forEach(p => gapPosts.add(key(p)));
      extraGaps.push(w);
    }

    // 4. Loops: remove interior walls that create a meaningful shortcut.
    const cellDistance = (ax, ay, bx, by, limit) => {
      if (ax === bx && ay === by) return 0;
      const dist = grid(ch, cw, -1);
      dist[ay][ax] = 0;
      let frontier = [[ax, ay]];
      for (let d = 1; frontier.length && d <= limit; d++) {
        const next = [];
        for (const [x, y] of frontier) {
          const moves = [];
          if (x > 0 && !vw[y][x]) moves.push([x - 1, y]);
          if (x < cw - 1 && !vw[y][x + 1]) moves.push([x + 1, y]);
          if (y > 0 && !hw[y][x]) moves.push([x, y - 1]);
          if (y < ch - 1 && !hw[y + 1][x]) moves.push([x, y + 1]);
          for (const [nx, ny] of moves) {
            if (dist[ny][nx] !== -1) continue;
            if (nx === bx && ny === by) return d;
            dist[ny][nx] = d;
            next.push([nx, ny]);
          }
        }
        frontier = next;
      }
      return Infinity;
    };
    const interior = [];
    for (let y = 1; y < ch; y++) for (let x = 0; x < cw; x++) if (hw[y][x]) interior.push({ h: true, x, y });
    for (let y = 0; y < ch; y++) for (let x = 1; x < cw; x++) if (vw[y][x]) interior.push({ h: false, x, y });
    const target = Math.round(interior.length * opts.loops);
    let removed = 0;
    for (const w of shuffle(interior, rand)) {
      if (removed >= target) break;
      if (!canRemove(w)) continue;
      const [a, b] = w.h ? [[w.x, w.y - 1], [w.x, w.y]] : [[w.x - 1, w.y], [w.x, w.y]];
      if (cellDistance(a[0], a[1], b[0], b[1], opts.minShortcut) < opts.minShortcut) continue;
      setWall(w, false);
      removed++;
    }

    const m = { width: W, height: H, seed, options: opts, hw, vw, startGap, finishGap, extraGaps };
    setCourses(m, rand);
    return m;
  }

  // ---- Movement graph --------------------------------------------------------
  // Nodes are the maze cells plus a one-cell ring outside the maze, so routes
  // that run around the outside through perimeter gaps are counted.
  function buildGraph(m) {
    const { width: W, height: H, hw, vw } = m;
    const cw = W - 1, ch = H - 1, cols = cw + 2, rows = ch + 2;
    const id = (x, y) => (y + 1) * cols + (x + 1);
    const pos = n => [(n % cols) - 1, Math.floor(n / cols) - 1];
    const inside = (x, y) => x >= 0 && x < cw && y >= 0 && y < ch;
    const adj = Array.from({ length: cols * rows }, () => []);
    const link = (a, b) => { adj[a].push(b); adj[b].push(a); };
    for (let y = -1; y <= ch; y++) {
      for (let x = -1; x <= cw; x++) {
        if (x < cw) {
          const open = !inside(x, y) && !inside(x + 1, y) ? true : !vw[y][x + 1];
          if (open) link(id(x, y), id(x + 1, y));
        }
        if (y < ch) {
          const open = !inside(x, y) && !inside(x, y + 1) ? true : !hw[y + 1][x];
          if (open) link(id(x, y), id(x, y + 1));
        }
      }
    }
    return { adj, id, pos, start: id(m.startGap.x, ch), finish: id(m.finishGap.x, -1) };
  }

  function bfs(g, src, blocked) {
    const n = g.adj.length;
    const dist = new Int32Array(n).fill(-1), prev = new Int32Array(n).fill(-1);
    dist[src] = 0;
    const queue = [src];
    for (let h = 0; h < queue.length; h++) {
      const u = queue[h];
      for (const v of g.adj[u]) {
        if (dist[v] !== -1 || (blocked && blocked.has(v))) continue;
        dist[v] = dist[u] + 1;
        prev[v] = u;
        queue.push(v);
      }
    }
    return { dist, prev };
  }

  function pathTo(prev, t) {
    const p = [];
    for (let v = t; v !== -1; v = prev[v]) p.push(v);
    return p.reverse();
  }

  // Length of the best route from a to b that avoids the squares of the shortest
  // route between its first and last decision points. Infinity = no real choice.
  function alternative(g, a, b, base) {
    const p = pathTo(base.prev, b);
    let i0 = 1;
    while (i0 < p.length - 1 && g.adj[p[i0]].length < 3) i0++;
    let i1 = p.length - 2;
    while (i1 > 0 && g.adj[p[i1]].length < 3) i1--;
    if (i0 + 1 > i1 - 1) return Infinity;
    const d = bfs(g, a, new Set(p.slice(i0 + 1, i1))).dist[b];
    return d === -1 ? Infinity : d;
  }

  // ---- Where flags hang --------------------------------------------------------
  // A flag always hangs a quarter square from a post, at a feature of the tape there:
  //   inside   in a corner between two tapes that meet at a right angle
  //   outside  diagonally across an L-shaped corner (a post with exactly two tapes), outside it
  //   tip      just past the end of a run of tape (a post with one tape), in line with it
  //   beside   beside a straight run of tape, square to it, on a side with no tape
  // Tips and beside spots sit on the open line between two squares; the flag is routed
  // through the square to its east or south (west or north at the maze edge).

  function spotsAt(m, px, py) {
    const { hw, vw } = m;
    const cw = m.width - 1, ch = m.height - 1;
    const N = !!(py > 0 && vw[py - 1][px]), S = !!(py < ch && vw[py][px]);
    const Wa = !!(px > 0 && hw[py][px - 1]), E = !!(px < cw && hw[py][px]);
    const arms = N + S + Wa + E;
    const spots = [];
    const add = (kind, dx, dy) => {
      const pt = [px + 0.25 * dx, py + 0.25 * dy];
      if (!(pt[0] > 0 && pt[0] < cw && pt[1] > 0 && pt[1] < ch)) return;
      const x = dx < 0 ? px - 1 : dx > 0 ? px : px < cw ? px : px - 1;
      const y = dy < 0 ? py - 1 : dy > 0 ? py : py < ch ? py : py - 1;
      spots.push({ kind, post: [px, py], pt, dir: [dx, dy], x, y });
    };
    for (const [dx, dy] of [[1, -1], [-1, -1], [1, 1], [-1, 1]]) {
      const v = dy < 0 ? N : S, h = dx < 0 ? Wa : E;
      if (v && h) add('inside', dx, dy);
      else if (arms === 2 && !v && !h && (dy < 0 ? S : N) && (dx < 0 ? E : Wa)) add('outside', dx, dy);
    }
    if (arms === 1) {
      const [dx, dy] = N ? [0, 1] : S ? [0, -1] : Wa ? [1, 0] : [-1, 0];
      add('tip', dx, dy);
    }
    if (Wa && E && !(N && S)) { if (!N) add('beside', 0, -1); if (!S) add('beside', 0, 1); }
    if (N && S && !(Wa && E)) { if (!Wa) add('beside', -1, 0); if (!E) add('beside', 1, 0); }
    return spots;
  }

  // ---- Course setting --------------------------------------------------------
  // All courses share one set of hung controls. The hardest course is planned first
  // and places its controls; the usable controls it doesn't visit and the dummies are
  // hung next; every other course then picks its controls, in order, from that set.
  //
  // Difficulty t (0 = level 1, 1 = level 5) shapes each course:
  //   course size      easiestShare of the usable controls at level 1, rising to all of them
  //   leg length       longer legs as t rises
  //   deception        path length vs straight-line distance: easy legs go roughly
  //                    where they look like they go; hard ones look close but aren't
  //   route choice     hard legs favour two routes of near-equal length
  //   dead ends        easy avoids controls in pockets, hard seeks them
  //   features         easy favours inside corners and tape ends; hard favours outside
  //                    corners; beside a straight run is the least used
  // The hardest course's t also sets how near the dummies sit, and allows one trap.
  const levelT = level => (clamp(level | 0, 1, 5) - 1) / 4;
  const KIND_PREF = {           // [level 1, level 5]
    inside: [0.6, 0.3],
    tip: [0.5, 0.3],
    outside: [0.1, 0.5],
    beside: [-0.3, 0],
  };
  const kindPref = (kind, t) => KIND_PREF[kind][0] * (1 - t) + KIND_PREF[kind][1] * t;

  function setCourses(m, rand) {
    const o = m.options;
    const cw = m.width - 1, ch = m.height - 1;
    const total = clamp(o.controls | 0, 0, Math.floor((cw * ch) / 2));
    const dummies = clamp(o.dummies | 0, 0, Math.max(0, total - 1));
    const usable = total - dummies;
    const share = clamp(+o.easiestShare || 0, 0, 1);
    const defs = (o.courses && o.courses.length ? o.courses : DEFAULTS.courses)
      .map((c, i) => ({
        name: String(c.name || `Course ${i + 1}`),
        difficulty: clamp(c.difficulty | 0, 1, 5),
        key: c.key | 0,                          // stable per course, so its route survives edits to others
        variant: Math.max(0, c.variant | 0),     // bumped to re-roll just this course
      }));
    const sizeFor = level => usable ? clamp(Math.round(usable * (share + (1 - share) * levelT(level))), 1, usable) : 0;
    const primary = defs.reduce((b, c, i) => (c.difficulty > defs[b].difficulty ? i : b), 0);
    const pLevel = defs[primary].difficulty, tP = levelT(pLevel);

    const g = buildGraph(m);
    const span = cw + ch;
    const fromStart = bfs(g, g.start).dist, toFinish = bfs(g, g.finish).dist;

    // Every place a flag could hang, with the square it is routed through.
    const spots = [];
    for (let py = 0; py <= ch; py++) for (let px = 0; px <= cw; px++) {
      for (const s of spotsAt(m, px, py)) spots.push(Object.assign(s, { id: g.id(s.x, s.y), sid: spots.length }));
    }

    // Map geometry in square units, for keeping the drawn course readable.
    const centre = id => { const [x, y] = g.pos(id); return [x + 0.5, y + 0.5]; };
    const finishPt = centre(g.finish);
    const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    // Penalty for a leg drawn from p to q: its line passing through another circle,
    // q sitting on one of the course's existing lines, or doubling back over the previous leg.
    const clutter = (lines, p, q, prev, others) => {
      const line = [p[0], p[1], q[0], q[1]];
      let pen = 0;
      if (others.some(c => segDist(c[0], c[1], line) < 0.7)) pen += 1.2;
      if (lines.some(l => segDist(q[0], q[1], l) < 0.7)) pen += 1.2;
      if (prev) {
        const a = Math.atan2(q[1] - p[1], q[0] - p[0]), b = Math.atan2(prev[1] - p[1], prev[0] - p[0]);
        const diff = Math.abs(((a - b + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        if (diff < Math.PI / 6) pen += 0.8;
      }
      return pen;
    };

    // Spacing: one flag per post, and every flag at least a square from every other.
    // The trap pair is the only exception (placed deliberately, closer than that).
    const usedPosts = new Set();
    const flags = [];
    const clearOf = pt => flags.every(q => dist2(q, pt) >= 1);
    const nearEnds = s => fromStart[s.id] < 2 || toFinish[s.id] < 2;
    const canUse = s => !usedPosts.has(s.post.join()) && clearOf(s.pt) && !nearEnds(s);
    const hang = s => { usedPosts.add(s.post.join()); flags.push(s.pt); };

    // The trap: at a tape corner (a post with exactly two tapes, at right angles), a
    // course control on one side of the corner and a dummy on the other, both hard
    // against the post: side by side, only one correct. At most one in the maze, only
    // when the hardest course is level 3-5 (chance 1/2, 3/4, always); courses below
    // level 3 never use its control.
    let traps = dummies > 0 && rand() < [0, 0, 0.5, 0.75, 1][pLevel - 1] ? 1 : 0;
    const partnerOf = s => (s.kind === 'inside' || s.kind === 'outside')
      ? spots.find(q => q.post[0] === s.post[0] && q.post[1] === s.post[1] && q.dir[0] === -s.dir[0] && q.dir[1] === -s.dir[1] &&
                        (q.kind === 'inside' || q.kind === 'outside') && q.kind !== s.kind) || null
      : null;
    const hungSids = new Set();
    // The partner spot is free if nothing hangs there and it is a square from every
    // flag except its own control.
    const partnerFree = s => {
      const p = partnerOf(s);
      return p && !hungSids.has(p.sid) && flags.every(q => q === s.pt || dist2(q, p.pt) >= 1) ? p : null;
    };

    // Plan one course of n controls at difficulty t. With no pool it hangs new flags
    // at free spots; with a pool it picks from flags already hung.
    function planRoute(t, n, pool, rng = rand) {
      const lo = Math.max(2, Math.round(span * (0.25 + 0.2 * t)));
      const hi = Math.max(lo + 2, Math.round(span * (0.55 + 0.75 * t)));
      const route = [], lines = [], chosen = new Set(), chosenCells = new Set();
      const source = pool || spots;
      const ok = pool ? s => !chosen.has(s.sid) : canUse;
      const fallback = pool ? ok : s => !usedPosts.has(s.post.join()) && clearOf(s.pt);
      let cur = g.start, prevPt = null;
      for (let i = 0; i < n; i++) {
        const base = bfs(g, cur);
        const here = g.pos(cur);
        const curPt = i === 0 ? centre(cur) : route[i - 1].pt;
        const placedPts = route.map(c => c.pt);
        const others = placedPts.slice(0, -1);
        const wantTrap = !pool && traps && !route.some(partnerFree);
        let cand = [];
        for (const [a, b] of [[lo, hi], [Math.ceil(lo / 2), hi * 2], [1, Infinity]]) {
          cand = source.filter(s => ok(s) && base.dist[s.id] >= a && base.dist[s.id] <= b);
          if (cand.length) break;
        }
        if (!cand.length) cand = source.filter(fallback);
        if (!cand.length) break;
        let best = null, bestScore = -Infinity;
        for (const c of shuffle(cand, rng).slice(0, 40)) {
          const d = Math.max(1, base.dist[c.id]);
          const deception = clamp((d / Math.max(1, Math.abs(here[0] - c.x) + Math.abs(here[1] - c.y)) - 1) / 2, 0, 1);
          const ratio = alternative(g, cur, c.id, base) / d;
          const choice = ratio <= 1.15 ? 1 : ratio < 1.6 ? (1.6 - ratio) / 0.45 : 0;
          const deadEnd = g.adj[c.id].length === 1 ? 1 : 0;
          let s = (-0.6 + 1.6 * t) * deception + (0.2 + 0.6 * t) * choice + (-0.4 + 0.9 * t) * deadEnd + kindPref(c.kind, t);
          if (pathTo(base.prev, c.id).slice(1, -1).some(v => chosenCells.has(v))) s -= 0.8; // runs through another control
          if (i === n - 1 && toFinish[c.id] < lo / 2) s -= 0.6;                             // last control too near finish
          s -= clutter(lines, curPt, c.pt, prevPt, others);
          if (i === n - 1) s -= clutter(lines, c.pt, finishPt, curPt, placedPts);            // closing leg to the finish
          if (wantTrap && partnerFree(c)) s += 0.6;
          s += rng() * 0.4;
          if (s > bestScore) { bestScore = s; best = c; }
        }
        if (!pool) { hang(best); hungSids.add(best.sid); }
        route.push(best);
        chosen.add(best.sid);
        chosenCells.add(best.id);
        lines.push([...curPt, ...best.pt]);
        prevPt = curPt;
        cur = best.id;
      }
      return { route, lines };
    }

    // Best spot by score(s, strict); score returns null to reject. Spacing rules apply
    // on a strict first pass; if the maze is cramped the second pass lets flags sit
    // nearer the start and finish, but never breaks the spacing rules.
    const pick = score => {
      for (const strict of [true, false]) {
        let best = null, bestScore = -Infinity;
        for (const s of spots) {
          if (strict ? !canUse(s) : usedPosts.has(s.post.join()) || !clearOf(s.pt)) continue;
          const v = score(s, strict);
          if (v !== null && v > bestScore) { bestScore = v; best = s; }
        }
        if (best) return best;
      }
      return null;
    };

    // 1. The hardest course hangs its controls.
    const main = planRoute(tP, sizeFor(pLevel), null);

    // 2. The trap dummy, across the tape corner from one of those controls.
    const dummySpots = [];
    let trapControl = null;
    if (traps) {
      const offers = main.route.filter(partnerFree);
      if (offers.length) {
        const c = offers[Math.floor(rand() * offers.length)];
        const d = partnerFree(c);
        d.trap = true;
        flags.push(d.pt);
        hungSids.add(d.sid);
        dummySpots.push(d);
        trapControl = c.sid;
      }
    }

    // 3. Usable controls the hardest course doesn't visit are still hung, for the
    //    other courses. Spread them out, clear of the hardest course's lines.
    const spareSpots = [];
    while (main.route.length + spareSpots.length < usable) {
      const best = pick(s => {
        const gap = flags.length ? Math.min(...flags.map(q => dist2(q, s.pt))) : 6;
        const onLine = main.lines.some(l => segDist(s.pt[0], s.pt[1], l) < 0.7) ? 1 : 0;
        return Math.min(gap, 6) / 6 - onLine + 0.5 * kindPref(s.kind, tP) + rand() * 0.3;
      });
      if (!best) break;
      hang(best);
      hungSids.add(best.sid);
      spareSpots.push(best);
    }

    // 4. Other dummies never share a post, and sit nearer the controls as the hardest
    //    course's level rises (about 6 squares away at level 1, 2 at level 5).
    const usableSpots = [...main.route, ...spareSpots];
    const target = 6 - 4 * tP;
    const fromControl = new Map(usableSpots.map(c => [c.sid, bfs(g, c.id).dist]));
    while (dummySpots.length < dummies) {
      const best = pick((s, strict) => {
        let near = null, mn = Infinity;
        for (const c of usableSpots) { const d = dist2(c.pt, s.pt); if (d < mn) { mn = d; near = c; } }
        // Never an easy step from a control: close by, with no tape to go round.
        if (strict && near && mn < 1.5 && fromControl.get(near.sid)[s.id] < 3) return null;
        return 1 - clamp(Math.abs((near ? mn : target) - target) / 4, 0, 1) + 0.5 * kindPref(s.kind, tP) + rand() * 0.3;
      });
      if (!best) break;
      hang(best);
      hungSids.add(best.sid);
      dummySpots.push(best);
    }

    // 5. Every other course picks from the usable controls. Each course has its own
    //    random stream (from the seed, its key and its variant), so re-rolling one
    //    course leaves the others alone. The hardest course keeps the route that hung
    //    the flags until it is re-rolled; then it too picks from the hung flags.
    const routes = defs.map((d, i) => {
      if (i === primary && !d.variant) return main.route;
      const key = d.key || i + 1;   // courses without a key fall back to their position
      const rng = mulberry32(m.seed ^ Math.imul(key, 0x9e3779b1) ^ Math.imul(d.variant + 1, 0x85ebca77));
      const pool = usableSpots.filter(s => d.difficulty >= 3 || s.sid !== trapControl);
      return planRoute(levelT(d.difficulty), Math.min(sizeFor(d.difficulty), pool.length), pool, rng).route;
    });

    // Codes are dealt at random across every hung flag.
    const hung = [...usableSpots, ...dummySpots];
    const codes = shuffle(hung.map((_, k) => (o.firstCode | 0) + k), rand);
    const index = new Map(hung.map((s, k) => [s.sid, k]));
    m.controls = hung.map((s, k) => ({
      x: s.x, y: s.y, post: s.post, pt: s.pt, kind: s.kind, code: codes[k],
      dummy: k >= usableSpots.length, trap: !!s.trap,
    }));
    m.courses = defs.map((d, i) => {
      const course = { name: d.name, difficulty: d.difficulty, stops: routes[i].map(s => index.get(s.sid)) };
      course.legs = legStats(m, g, course);
      return course;
    });
  }

  // Shortest route, straight line (between drawn map points) and best alternative, per leg.
  function legStats(m, g, course) {
    const ctrls = course.stops.map(k => m.controls[k]);
    const nodes = [g.start, ...ctrls.map(c => g.id(c.x, c.y)), g.finish];
    const centre = n => { const [x, y] = g.pos(n); return [x + 0.5, y + 0.5]; };
    const pts = [centre(g.start), ...ctrls.map(c => c.pt), centre(g.finish)];
    const legs = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      const base = bfs(g, nodes[i]);
      legs.push({
        length: base.dist[nodes[i + 1]],
        straight: Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]),
        alt: alternative(g, nodes[i], nodes[i + 1], base),
      });
    }
    return legs;
  }

  // ---- Checks ------------------------------------------------------------------
  // Returns a list of rule violations (empty = valid).
  function validate(m) {
    const problems = [];
    const { width: W, height: H, hw, vw } = m;
    const cw = W - 1, ch = H - 1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const deg = (x > 0 && hw[y][x - 1]) || (x < cw && hw[y][x]) ||
                  (y > 0 && vw[y - 1][x]) || (y < ch && vw[y][x]);
      if (!deg) problems.push(`post (${x},${y}) has no tape`);
    }
    if (hw[m.startGap.y][m.startGap.x]) problems.push('start entrance is closed');
    if (hw[m.finishGap.y][m.finishGap.x]) problems.push('finish exit is closed');
    // Every cell reachable from the start entrance.
    const seen = grid(ch, cw, false);
    const stack = [[m.startGap.x, ch - 1]];
    seen[ch - 1][m.startGap.x] = true;
    let count = 1;
    while (stack.length) {
      const [x, y] = stack.pop();
      const moves = [];
      if (x > 0 && !vw[y][x]) moves.push([x - 1, y]);
      if (x < cw - 1 && !vw[y][x + 1]) moves.push([x + 1, y]);
      if (y > 0 && !hw[y][x]) moves.push([x, y - 1]);
      if (y < ch - 1 && !hw[y + 1][x]) moves.push([x, y + 1]);
      for (const [nx, ny] of moves) if (!seen[ny][nx]) { seen[ny][nx] = true; count++; stack.push([nx, ny]); }
    }
    if (count !== cw * ch) problems.push(`${cw * ch - count} cells unreachable from start`);

    const all = m.controls;
    if (all.some(c => !(c.pt[0] > 0 && c.pt[0] < cw && c.pt[1] > 0 && c.pt[1] < ch))) problems.push('control outside maze');
    // Every flag at a real tape feature of its post: a corner, a tape end, or beside a straight run.
    for (const c of all) {
      const ok = spotsAt(m, c.post[0], c.post[1]).some(s => s.kind === c.kind && s.pt[0] === c.pt[0] && s.pt[1] === c.pt[1] && s.x === c.x && s.y === c.y);
      if (!ok) { problems.push(`control ${c.code} is not at a corner, tape end or beside tape`); break; }
    }
    const nonTrapPosts = all.filter(c => !c.trap).map(c => c.post.join());
    if (new Set(nonTrapPosts).size !== nonTrapPosts.length) problems.push('two controls share a post');
    const codes = all.map(c => c.code).sort((a, b) => a - b);
    if (codes.some((c, i) => c !== (m.options.firstCode | 0) + i)) problems.push('control codes not contiguous');

    // Traps: at most one, at a real tape corner, diagonally across from its control,
    // whose courses are all level 3 or above.
    const traps = all.filter(d => d.dummy && all.some(c => !c.dummy && c.post.join() === d.post.join()));
    if (traps.length > 1) problems.push(`${traps.length} trap dummies`);
    for (const d of traps) {
      const k = all.findIndex(c => !c.dummy && c.post.join() === d.post.join());
      const c = all[k];
      const pair = [c.kind, d.kind].sort().join();
      const opposite = c.pt[0] + d.pt[0] === 2 * d.post[0] && c.pt[1] + d.pt[1] === 2 * d.post[1];
      if (pair !== 'inside,outside' || !opposite || !d.trap) problems.push('trap dummy is not across a tape corner from its control');
      if (m.courses.some(co => co.difficulty < 3 && co.stops.includes(k))) problems.push('a course below level 3 uses the trapped control');
    }

    m.courses.forEach(co => {
      if (co.stops.some(k => !all[k] || all[k].dummy)) problems.push(`${co.name} visits a dummy`);
      if (new Set(co.stops).size !== co.stops.length) problems.push(`${co.name} visits a control twice`);
      if (co.legs.length !== co.stops.length + 1 || co.legs.some(l => !(l.length > 0))) problems.push(`${co.name} has an impossible leg`);
    });
    return problems;
  }

  // ---- Output ------------------------------------------------------------------
  // Post labels: columns A, B, … left to right; rows 1, 2, … from the start side (bottom).
  function colName(i) {
    let s = '';
    for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }
  const postLabel = (m, x, y) => colName(x) + (m.height - y);

  // ---- Tape plan ---------------------------------------------------------------
  // How to lay the tape as few, long continuous pieces, turning at posts, so it can
  // be reused afterwards. Each connected group of tape is covered by the fewest pieces
  // possible: one per pair of posts where an odd number of tapes meet (Euler trails,
  // found by joining those posts to a virtual post). Pieces go straight on at a post
  // where they can. Then any piece of SHORT_RUN segments or fewer that starts or ends
  // on another piece is laid as an out-and-back from it instead, doubling that bit of
  // tape but keeping the longer piece whole.
  const SHORT_RUN = 2;

  function tapePlan(m) {
    const { width: W, height: H, hw, vw } = m;
    const cw = W - 1, ch = H - 1, REAL = W * H;
    const vid = (x, y) => y * W + x;
    const xy = v => [v % W, Math.floor(v / W)];
    const edges = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < cw; x++) if (hw[y][x]) edges.push([vid(x, y), vid(x + 1, y)]);
    for (let y = 0; y < ch; y++) for (let x = 0; x < W; x++) if (vw[y][x]) edges.push([vid(x, y), vid(x, y + 1)]);
    const segments = edges.length;
    const adj = new Map();
    const link = (v, e) => { if (!adj.has(v)) adj.set(v, []); adj.get(v).push(e); };
    edges.forEach(([a, b], e) => { link(a, e); link(b, e); });
    const other = (e, v) => (edges[e][0] === v ? edges[e][1] : edges[e][0]);
    const step = (from, to) => { const [ax, ay] = xy(from), [bx, by] = xy(to); return (bx - ax) + ',' + (by - ay); };
    const used = new Set();

    // Hierholzer's algorithm: prefer carrying straight on, then any real tape, and
    // the virtual links (which split the circuit into pieces) last.
    const circuit = start => {
      const stack = [[start, -1]], out = [];
      while (stack.length) {
        const [v, inE] = stack[stack.length - 1];
        const open = adj.get(v).filter(e => !used.has(e));
        if (!open.length) { out.push(v); stack.pop(); continue; }
        const inDir = inE >= 0 && v < REAL && other(inE, v) < REAL ? step(other(inE, v), v) : null;
        const rank = e => { const u = other(e, v); return u >= REAL || v >= REAL ? 2 : inDir && step(v, u) === inDir ? 0 : 1; };
        const e = open.reduce((b, c) => (rank(c) < rank(b) ? c : b));
        used.add(e);
        stack.push([other(e, v), e]);
      }
      return out;
    };

    const pieces = [];
    const seen = new Set();
    let virtual = REAL;
    for (const v0 of [...adj.keys()]) {
      if (seen.has(v0)) continue;
      const comp = [v0];
      seen.add(v0);
      for (let i = 0; i < comp.length; i++) for (const e of adj.get(comp[i])) {
        const u = other(e, comp[i]);
        if (!seen.has(u)) { seen.add(u); comp.push(u); }
      }
      const odd = comp.filter(v => adj.get(v).length % 2);
      if (!odd.length) { pieces.push(circuit(comp[0])); continue; }   // a closed loop of tape
      const X = virtual++;
      for (const v of odd) { edges.push([X, v]); link(X, edges.length - 1); link(v, edges.length - 1); }
      let cur = [];
      for (const v of circuit(X)) {
        if (v === X) { if (cur.length > 1) pieces.push(cur); cur = []; } else cur.push(v);
      }
      if (cur.length > 1) pieces.push(cur);
    }

    // Fold short pieces into longer ones as out-and-backs.
    const segs = p => p.length - 1;
    for (let merged = true; merged;) {
      merged = false;
      pieces.sort((a, b) => segs(b) - segs(a));
      for (let i = pieces.length - 1; i >= 0 && !merged; i--) {
        const t = pieces[i];
        if (segs(t) > SHORT_RUN) continue;
        for (const path of [t, [...t].reverse()]) {
          const host = pieces.find(u => u !== t && segs(u) >= segs(t) && u.includes(path[0]));
          if (!host) continue;
          const at = host.indexOf(path[0]);
          host.splice(at + 1, 0, ...path.slice(1), ...path.slice(0, -1).reverse());
          pieces.splice(i, 1);
          merged = true;
          break;
        }
      }
    }
    pieces.sort((a, b) => segs(b) - segs(a));
    return { segments, pieces: pieces.map(p => p.map(xy)) };
  }

  // A piece of tape as spoken steps: where to start, each straight leg to the post
  // where it turns (or doubles back), and where to tie off.
  function describePiece(m, posts) {
    const label = p => postLabel(m, p[0], p[1]);
    const name = (dx, dy) => (dy < 0 ? 'north' : dy > 0 ? 'south' : dx > 0 ? 'east' : 'west');
    const steps = [];
    let prev = null;
    for (let i = 1; i < posts.length; i++) {
      const dx = posts[i][0] - posts[i - 1][0], dy = posts[i][1] - posts[i - 1][1];
      const d = dx + ',' + dy;
      if (steps.length && d === prev) steps[steps.length - 1].to = posts[i];
      else steps.push({ dir: name(dx, dy), back: prev === -dx + ',' + -dy, to: posts[i] });
      prev = d;
    }
    const closed = posts.length > 2 && posts[0][0] === posts[posts.length - 1][0] && posts[0][1] === posts[posts.length - 1][1];
    const doubled = (() => {
      const seen = new Set();
      let n = 0;
      for (let i = 1; i < posts.length; i++) {
        const k = [label(posts[i - 1]), label(posts[i])].sort().join();
        if (seen.has(k)) n++; else seen.add(k);
      }
      return n;
    })();
    return {
      segments: posts.length - 1,
      doubled,
      start: label(posts[0]),
      steps: steps.map(s => `${s.back ? 'back ' : ''}${s.dir} to ${label(s.to)}`),
      end: closed ? `back at the start, ${label(posts[0])}` : label(posts[posts.length - 1]),
    };
  }

  // Everything needed to set the maze out on the ground.
  function buildSheet(m) {
    const label = (x, y) => postLabel(m, x, y);
    const plan = tapePlan(m);
    const gapText = w => w.h
      ? `${label(w.x, w.y)}–${label(w.x + 1, w.y)}`
      : `${label(w.x, w.y + 1)}–${label(w.x, w.y)}`;
    const pieces = plan.pieces.map(p => describePiece(m, p));
    return {
      posts: m.width * m.height,
      segments: plan.segments,
      tapeSegments: pieces.reduce((t, p) => t + p.segments, 0),
      pieces,
      start: gapText(m.startGap),
      finish: gapText(m.finishGap),
      gaps: m.extraGaps.map(gapText),
      corners: [label(0, m.height - 1), label(m.width - 1, 0), label(0, 0), label(m.width - 1, m.height - 1)],
    };
  }


  const OVERPRINT = '#a61fc9';   // ISOM course-overprint purple
  const INK = '#1a1f1c';
  const GREY = '#8b918d';

  // Map as SVG. o.course: index of the course to overprint, or null for the master
  // map (every flag, labelled by code). o.extras shows a course map's other flags in grey.
  function renderSvg(m, o) {
    o = Object.assign({ course: 0, coords: true, lines: true, codes: false, extras: false }, o);
    const { width: W, height: H, hw, vw } = m;
    const cw = W - 1, ch = H - 1, U = 40;
    const padX = o.coords ? 40 : 28, top = 64, bottom = 64;
    const w = cw * U + padX * 2, h = top + ch * U + bottom;
    const px = x => padX + x * U, py = y => top + y * U;
    const f = n => +n.toFixed(1);
    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Helvetica, Arial, sans-serif">`);
    out.push(`<rect width="${w}" height="${h}" fill="#ffffff"/>`);

    if (o.coords) {
      out.push(`<g fill="#7a837e" font-size="11" text-anchor="middle">`);
      for (let x = 0; x < W; x++) {
        out.push(`<text x="${px(x)}" y="${py(0) - 10}">${colName(x)}</text>`);
        out.push(`<text x="${px(x)}" y="${py(ch) + 18}">${colName(x)}</text>`);
      }
      for (let y = 0; y < H; y++) {
        out.push(`<text x="${px(0) - 18}" y="${py(y) + 4}">${H - y}</text>`);
        out.push(`<text x="${px(cw) + 18}" y="${py(y) + 4}">${H - y}</text>`);
      }
      out.push(`</g>`);
    }

    let d = '';
    for (let y = 0; y < H; y++) for (let x = 0; x < cw; x++) if (hw[y][x]) d += `M${px(x)} ${py(y)}H${px(x + 1)}`;
    for (let y = 0; y < ch; y++) for (let x = 0; x < W; x++) if (vw[y][x]) d += `M${px(x)} ${py(y)}V${py(y + 1)}`;
    out.push(`<path d="${d}" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`);
    out.push(`<g fill="${INK}">`);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.push(`<circle cx="${px(x)}" cy="${py(y)}" r="3"/>`);
    out.push(`</g>`);

    // Circles centre on the flag point, a quarter square from its post.
    const R = U * 0.36;
    const master = o.course == null;
    const course = master ? null : m.courses[o.course];
    const onCourse = master ? m.controls.map((c, k) => k).filter(k => !m.controls[k].dummy) : course.stops;
    const ctrls = onCourse.map(k => m.controls[k]).map(c => ({ x: px(c.pt[0]), y: py(c.pt[1]), r: R + 2, code: c.code }));

    // Other flags in grey: unused solid, dummies dashed. Always on the master map.
    if (master || o.extras) {
      const rest = m.controls.filter((c, k) => !onCourse.includes(k));
      if (rest.length) {
        out.push(`<g fill="none" stroke="${GREY}" stroke-width="2">`);
        for (const c of rest) out.push(`<circle cx="${px(c.pt[0])}" cy="${py(c.pt[1])}" r="${f(R)}"${c.dummy ? ' stroke-dasharray="4 3"' : ''}/>`);
        out.push(`</g>`);
        for (const c of rest) {
          // Code just inside the circle, on the side away from the post.
          const ox = c.pt[0] - c.post[0], oy = c.pt[1] - c.post[1], ol = Math.hypot(ox, oy);
          const lx = px(c.pt[0] + 0.12 * ox / ol), ly = py(c.pt[1] + 0.12 * oy / ol) + 4;
          out.push(haloText(f(lx), f(ly), c.code, `fill="#6f7672" font-size="12" font-weight="700" text-anchor="middle"`, 3));
        }
      }
    }

    // Start triangle pointing at the first control, finish double circle, course lines.
    const start = { x: px(m.startGap.x + 0.5), y: py(ch) + 42, r: 13 };
    const finish = { x: px(m.finishGap.x + 0.5), y: py(0) - 38, r: 17 };
    const stops = master ? [] : [start, ...ctrls, finish];
    const lines = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const p = stops[i], q = stops[i + 1];
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      if (len <= p.r + q.r) continue;
      const ux = (q.x - p.x) / len, uy = (q.y - p.y) / len;
      lines.push([p.x + ux * p.r, p.y + uy * p.r, q.x - ux * q.r, q.y - uy * q.r]);
    }
    const toward = master || !ctrls.length ? { x: start.x, y: start.y - 1 } : ctrls[0];
    const a0 = Math.atan2(toward.y - start.y, toward.x - start.x);
    const tri = [0, 1, 2].map(k => `${f(start.x + 16 * Math.cos(a0 + k * 2.0944))},${f(start.y + 16 * Math.sin(a0 + k * 2.0944))}`);
    out.push(`<g fill="none" stroke="${OVERPRINT}" stroke-width="2.5">`);
    out.push(`<polygon points="${tri.join(' ')}"/>`);
    out.push(`<circle cx="${finish.x}" cy="${finish.y}" r="9"/><circle cx="${finish.x}" cy="${finish.y}" r="14"/>`);
    for (const c of ctrls) out.push(`<circle cx="${c.x}" cy="${c.y}" r="${f(R)}"/>`);
    if (o.lines) for (const l of lines) out.push(`<line x1="${f(l[0])}" y1="${f(l[1])}" x2="${f(l[2])}" y2="${f(l[3])}" stroke-width="2"/>`);
    out.push(`</g>`);

    // Labels: try eight positions round each circle and keep the one furthest from
    // course lines, other circles and labels already placed.
    const placed = [];
    ctrls.forEach((c, i) => {
      const text = master ? String(c.code) : o.codes ? `${i + 1}-${c.code}` : String(i + 1);
      const tw = text.length * 8.6;
      let best = null;
      for (let k = 0; k < 8; k++) {
        const a = -Math.PI / 4 - k * Math.PI / 4;   // start upper-right, go anticlockwise
        const dx = Math.cos(a), dy = Math.sin(a);
        const ax = c.x + dx * (R + 4), ay = c.y + dy * (R + 4);
        const anchor = dx > 0.3 ? 'start' : dx < -0.3 ? 'end' : 'middle';
        const left = anchor === 'start' ? ax : anchor === 'end' ? ax - tw : ax - tw / 2;
        const base = ay + (dy > 0.3 ? 12 : dy < -0.3 ? 0 : 5);
        const box = { l: left, r: left + tw, cy: base - 5 };
        const probes = [[box.l, box.cy], [(box.l + box.r) / 2, box.cy], [box.r, box.cy]];
        let clear = Infinity;
        for (const [x, y] of probes) {
          for (const l of lines) clear = Math.min(clear, segDist(x, y, l));
          ctrls.forEach((e, j) => { if (j !== i) clear = Math.min(clear, Math.hypot(x - e.x, y - e.y) - R); });
          for (const p of placed) clear = Math.min(clear, Math.max(Math.abs(y - p.cy) - 12, x < p.l ? p.l - x : x > p.r ? x - p.r : 0));
        }
        if (box.l < 2 || box.r > w - 2 || box.cy < 10 || box.cy > h - 10) clear -= 100;
        // Keep clear of the post-label band round the maze.
        if (o.coords && (box.cy < py(0) - 4 || box.cy > py(ch) + 8 || box.l < px(0) - 8 || box.r > px(cw) + 8)) clear -= 20;
        const score = Math.min(clear, 30) - k * 0.5;   // slight preference for upper-right
        if (!best || score > best.score) best = { score, ax, base, anchor, box };
      }
      placed.push(best.box);
      out.push(haloText(f(best.ax), f(best.base), text, `fill="${OVERPRINT}" font-size="15" font-weight="700" text-anchor="${best.anchor}"`, 4));
    });

    out.push(`</svg>`);
    return out.join('');
  }

  // Text with a white halo, drawn as two elements so it survives SVG-to-PDF conversion.
  function haloText(x, y, text, attrs, width) {
    return `<text x="${x}" y="${y}" ${attrs} stroke="#ffffff" stroke-width="${width}" stroke-linejoin="round">${text}</text>` +
           `<text x="${x}" y="${y}" ${attrs}>${text}</text>`;
  }

  // IOF XML 3.0 CourseData, for import into timing software. Positions are in
  // metres from the maze's south-west corner, written as map millimetres at 1:1000.
  // Lengths are the straight-line course lengths, as IOF convention expects.
  function iofXml(m, o) {
    o = Object.assign({ event: 'O-Maze', spacing: 2 }, o);
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const ch = m.height - 1;
    const pos = ([x, y]) => `<MapPosition x="${(x * o.spacing).toFixed(1)}" y="${((ch - y) * o.spacing).toFixed(1)}" unit="mm"/>`;
    const startPt = [m.startGap.x + 0.5, ch + 0.5], finishPt = [m.finishGap.x + 0.5, -0.5];
    const used = [...new Set(m.courses.flatMap(co => co.stops))].sort((a, b) => m.controls[a].code - m.controls[b].code);
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<CourseData xmlns="http://www.orienteering.org/datastandard/3.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" iofVersion="3.0" createTime="${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}" creator="O-Maze Setter">`,
      `  <Event><Name>${esc(o.event)}</Name></Event>`,
      '  <RaceCourseData>',
      '    <Map><Scale>1000</Scale></Map>',
      `    <Control type="Start"><Id>S1</Id>${pos(startPt)}</Control>`,
      ...used.map(k => `    <Control><Id>${m.controls[k].code}</Id>${pos(m.controls[k].pt)}</Control>`),
      `    <Control type="Finish"><Id>F1</Id>${pos(finishPt)}</Control>`,
    ];
    for (const co of m.courses) {
      const metres = n => Math.round(n * o.spacing);
      lines.push('    <Course>',
        `      <Name>${esc(co.name)}</Name>`,
        `      <Length>${metres(co.legs.reduce((t, l) => t + l.straight, 0))}</Length>`,
        '      <Climb>0</Climb>',
        '      <CourseControl type="Start"><Control>S1</Control></CourseControl>',
        ...co.stops.map((k, i) => `      <CourseControl type="Control"><Control>${m.controls[k].code}</Control><LegLength>${metres(co.legs[i].straight)}</LegLength></CourseControl>`),
        `      <CourseControl type="Finish"><Control>F1</Control><LegLength>${metres(co.legs[co.legs.length - 1].straight)}</LegLength></CourseControl>`,
        '    </Course>');
    }
    lines.push('  </RaceCourseData>', '</CourseData>', '');
    return lines.join('\n');
  }

  // Bump VERSION whenever a change alters what a given seed and settings generate,
  // so share links made with an older version can say so.
  const VERSION = 1;

  global.OMaze = { generate, validate, renderSvg, buildSheet, tapePlan, iofXml, colName, DEFAULTS, SHORT_RUN, VERSION };
})(typeof window !== 'undefined' ? window : globalThis);
