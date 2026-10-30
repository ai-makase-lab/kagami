// かがみあわせ — ゲームのルール・ステージ生成・ソルバー(画面に依存しない部分)
(function (root) {
  const W = 7, H = 7, N = W * H;
  const FLOOR = 0, WALL = 1, HOLE = 2;
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const DIR_KEYS = ['up', 'down', 'left', 'right'];

  // 再現できる乱数(同じシードなら同じステージ)
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 1人ぶんの移動。壁・盤外なら止まる、穴なら -1(落下)
  function step(board, pos, dx, dy) {
    const x = (pos % W) + dx, y = ((pos / W) | 0) + dy;
    if (x < 0 || x >= W || y < 0 || y >= H) return pos;
    const c = board[y * W + x];
    if (c === WALL) return pos;
    if (c === HOLE) return -1;
    return y * W + x;
  }

  // 左のキャラは入力どおり、右のキャラは左右だけ逆に動く
  function move(stage, state, dir) {
    const [dx, dy] = DIRS[dir];
    const l = step(stage.left, state.l, dx, dy);
    const r = step(stage.right, state.r, -dx, dy);
    return { l, r, fell: l < 0 || r < 0, cleared: l === stage.goalL && r === stage.goalR };
  }

  // 幅優先探索で最短手数と手順を求める。解けなければ null
  function solve(stage, from) {
    from = from || { l: stage.startL, r: stage.startR };
    const start = from.l * N + from.r, goal = stage.goalL * N + stage.goalR;
    if (start === goal) return { moves: 0, path: [], explored: 1 };
    const prev = new Int32Array(N * N).fill(-1), via = new Int8Array(N * N);
    prev[start] = start;
    const q = [start];
    for (let i = 0; i < q.length; i++) {
      const s = q[i], l = (s / N) | 0, r = s % N;
      for (let d = 0; d < 4; d++) {
        const m = move(stage, { l, r }, DIR_KEYS[d]);
        if (m.fell) continue;
        const t = m.l * N + m.r;
        if (prev[t] !== -1) continue;
        prev[t] = s; via[t] = d;
        if (t === goal) {
          const path = [];
          for (let c = t; c !== start; c = prev[c]) path.push(DIR_KEYS[via[c]]);
          return { moves: path.length, path: path.reverse(), explored: q.length + 1 };
        }
        q.push(t);
      }
    }
    return null;
  }

  function randomBoard(rand, wallRate, holeRate) {
    const b = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const v = rand();
      b[i] = v < wallRate ? WALL : v < wallRate + holeRate ? HOLE : FLOOR;
    }
    return b;
  }

  function pickTwo(rand, board) {
    const floors = [];
    for (let i = 0; i < N; i++) if (board[i] === FLOOR) floors.push(i);
    if (floors.length < 2) return null;
    const a = floors[(rand() * floors.length) | 0];
    let b;
    do { b = floors[(rand() * floors.length) | 0]; } while (b === a);
    return [a, b];
  }

  const DEFAULT_OPTS = { wallRate: 0.22, holeRate: 0.06 };

  function generate(seed, opts) {
    opts = Object.assign({}, DEFAULT_OPTS, opts);
    const rand = rng(seed);
    const left = randomBoard(rand, opts.wallRate, opts.holeRate);
    const right = randomBoard(rand, opts.wallRate, opts.holeRate);
    const pl = pickTwo(rand, left), pr = pickTwo(rand, right);
    if (!pl || !pr) return null;
    return { seed, left, right, startL: pl[0], goalL: pl[1], startR: pr[0], goalR: pr[1] };
  }

  // 目標の最短手数ちょうどのステージを、シードを順に試して探す
  function makeStageSet(baseSeed, targets) {
    const stages = [];
    let seed = baseSeed;
    for (const target of targets) {
      for (let tries = 0; tries < 20000; tries++, seed++) {
        const st = generate(seed);
        if (!st) continue;
        const sol = solve(st);
        if (sol && sol.moves === target) { st.optimal = sol.moves; stages.push(st); seed++; break; }
      }
    }
    return stages;
  }

  // ランダムに作った盤面の統計
  function stats(baseSeed, count, opts) {
    const hist = {};
    let solvable = 0, best = null;
    for (let i = 0; i < count; i++) {
      const st = generate(baseSeed + i, opts);
      const sol = st && solve(st);
      if (!sol) continue;
      solvable++;
      hist[sol.moves] = (hist[sol.moves] || 0) + 1;
      if (!best || sol.moves > best.moves) best = { seed: st.seed, moves: sol.moves };
    }
    return { count, solvable, hist, best };
  }

  // 盤面の分析:たどり着ける状態の数、そこから二度とクリアできない「詰み」の状態の数、
  // 最短手順のうち片方だけが壁で止まる手(ずらし)の数
  function analyze(stage) {
    const sol = solve(stage);
    if (!sol) return null;
    const goal = stage.goalL * N + stage.goalR;
    const seen = new Map(), edges = [];
    const start = stage.startL * N + stage.startR;
    seen.set(start, 0);
    const q = [start];
    for (let i = 0; i < q.length; i++) {
      const s = q[i];
      if (s === goal) continue;
      for (let d = 0; d < 4; d++) {
        const m = move(stage, { l: (s / N) | 0, r: s % N }, DIR_KEYS[d]);
        if (m.fell) continue;
        const t = m.l * N + m.r;
        edges.push([s, t]);
        if (!seen.has(t)) { seen.set(t, 0); q.push(t); }
      }
    }
    // ゴールから逆向きにたどって、クリアできる状態を数える
    const rev = new Map();
    for (const [s, t] of edges) { if (!rev.has(t)) rev.set(t, []); rev.get(t).push(s); }
    const ok = new Set([goal]), rq = [goal];
    for (let i = 0; i < rq.length; i++) for (const s of rev.get(rq[i]) || []) if (!ok.has(s)) { ok.add(s); rq.push(s); }
    let desync = 0, st = { l: stage.startL, r: stage.startR };
    for (const d of sol.path) {
      const m = move(stage, st, d);
      const stopL = m.l === st.l, stopR = m.r === st.r;
      if (stopL !== stopR) desync++;
      st = { l: m.l, r: m.r };
    }
    return { optimal: sol.moves, reachable: seen.size, dead: seen.size - ok.size, desync };
  }

  // 「なんとなく近づく」だけの素朴なプレイヤー(ボット)。穴には入らず、
  // 2人のゴールまでの距離の合計が縮む手を選びやすい。400手で打ち切り。
  // 平均手数(失敗は400手と数える)を「難しさ」とする
  const BOT_CAP = 400, BOT_TEMP = 0.3;
  function dist(a, b) { return Math.abs(a % W - b % W) + Math.abs(((a / W) | 0) - ((b / W) | 0)); }
  function botPlay(stage, trials, seed) {
    const rand = rng(seed || 1);
    let win = 0, total = 0;
    for (let t = 0; t < trials; t++) {
      let st = { l: stage.startL, r: stage.startR }, k = 0, ok = false;
      for (; k < BOT_CAP; k++) {
        const opts = [];
        for (const d of DIR_KEYS) {
          const m = move(stage, st, d);
          if (m.fell) continue;
          const score = dist(m.l, stage.goalL) + dist(m.r, stage.goalR);
          opts.push({ m, w: Math.exp(-score * BOT_TEMP) });
        }
        if (!opts.length) break;
        let x = rand() * opts.reduce((a, o) => a + o.w, 0), pick = opts[0];
        for (const o of opts) { x -= o.w; if (x <= 0) { pick = o; break; } }
        st = { l: pick.m.l, r: pick.m.r };
        if (pick.m.cleared) { ok = true; break; }
      }
      if (ok) { win++; total += k + 1; } else total += BOT_CAP;
    }
    return { win: win / trials, avg: total / trials };
  }

  // v0.2のステージ選び:解ける盤面を集めてボットに100回ずつ挑ませ、
  // 平均手数の少ない順(やさしい順)に並べて、まんべんなく選ぶ
  function makeStageSetV2(baseSeed, count, poolSize) {
    const pool = [];
    for (let seed = baseSeed; pool.length < poolSize; seed++) {
      const st = generate(seed);
      const a = st && analyze(st);
      if (!a || a.optimal < 4 || a.optimal > 26) continue;
      const b = botPlay(st, 100, seed);
      Object.assign(st, a, { botWin: b.win, botAvg: b.avg });
      pool.push(st);
    }
    pool.sort((a, b) => a.botAvg - b.botAvg);
    const picked = [];
    for (let i = 0; i < count; i++) picked.push(pool[Math.round(i * (pool.length - 1) / (count - 1))]);
    return { stages: picked, pool };
  }

  root.Kagami = { W, H, N, FLOOR, WALL, HOLE, DIR_KEYS, generate, move, solve, analyze, botPlay, makeStageSet, makeStageSetV2, stats };
})(typeof window !== 'undefined' ? window : globalThis);
