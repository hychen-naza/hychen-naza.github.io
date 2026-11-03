/* DreamRehearse project page — simulation data and world-model fidelity (#simulation)
   - loads videos/sim/SIM.json
   - renders the file's `fidelity` block (the world model's video against the
     simulator's own ground truth) once per simulator domain, filtered by row id.
     The file's `trained_on` block is NOT rendered: the training-data section it
     lived in was removed from the page. The data is still in SIM.json, so adding
     an entry back to BLOCKS is all it takes to bring it back.
     Each block owns its caption, shuffle strip and rows, and each degrades on
     its own: an empty or unusable block must not blank the other one.
   - a row shows its cells side by side in the fixed reading order
     gt -> dream -> skeleton, and `cells` is variable length: a row carries only
     the columns that genuinely exist, so 1, 2 and 3 cell rows all have to lay
     out without an empty slot. The column count travels with the row as
     data-cells and --sim-cols, so the grid is never three columns wide by
     assumption.
   - every column is labelled by its `kind`, because this is the one section
     where mislabelling would be a claim: gt is the simulator's own render,
     dream is the only generated video, skeleton is the input. A kind the page
     cannot label unambiguously is dropped rather than shown unlabelled.
   - a block with showSplit prints each row's `split`, and a split that reads as
     a failure says in the row that it is a training example. Nothing on the page
     uses it since `trained_on` came off; it is kept for when it goes back.
   - a `fidelity` row with skeleton_matched === false says that its conditioning
     skeleton was not recoverable, so a two-cell row beside a three-cell one does
     not read as an omission.
   - `robometer` is deliberately NOT rendered. The numbers are available in
     SIM.json, but that classifier systematically under-detects success on
     generated frames, so anything on the page derived from it — a verdict most
     of all — would overstate the model.
   - the episode id is not printed. It stays in SIM.json and is exposed on each
     row as data-row-id, so which episode is on screen can always be read off
     the element without turning the page into a list of demo numbers.
   - the clips in a row are slaved to ONE clock rather than left to autoplay
     independently, because the row only means anything if they stay
     frame-aligned. This is the same clock as js/dreams.js: `t` advances with
     wall time, small errors are steered out with playbackRate and large ones
     are seeked. A row that is replaced by a shuffle has its clock destroyed
     before the next row is built, so shuffling cannot leak a frame loop.
   - click a clip to enlarge it in the page's existing #lightbox

   Self-contained on purpose: everything lives inside this IIFE, nothing is added
   to window, every class it writes is sim-* (so it cannot collide with the
   .cmp*, .rw-* and .rwd-* selectors main.js and dreams.js query), and the
   lightbox handlers wired by js/main.js are reused rather than re-bound. Loaded
   after main.js; harmless if the #simulation partial has not been spliced into
   index.html yet.
*/

(() => {
  "use strict";

  const SIM_URL = "videos/sim/SIM.json";

  // How many rows of a block are on screen at once. A block of ~6 rows times up
  // to three clips each is ~18 video elements; showing a window and giving the
  // block a Shuffle keeps the page light and gives the button something real to
  // do. windowSize() never lets the window exceed half the pool, so a shuffle
  // can always land on a set that shares no row with the one being replaced.
  const WINDOW = 3;

  // ---------------------------------------------------------- the two blocks
  // Structure, not data: which key of the file each host renders. Both the
  // heading and the caption come from the file itself.
  // One entry per host, not per key: `fidelity` is rendered twice, once into each
  // simulator domain's own section, so the block key is no longer unique and `match`
  // decides which rows belong to which host. A host that is absent from the page is
  // skipped, which is what lets the same file serve a restructured index.
  // `heading` says how much of the file's own header to print. The restructured
  // page gives every block an <h3> of its own in the HTML, so printing the file's
  // label too would put two headings on the same block — and with `fidelity`
  // rendered into two sections, the same heading twice on the page. "caption"
  // keeps the explanatory sentence, which the HTML heading does not carry, and
  // drops the title.
  const BLOCKS = [
    { key: "fidelity", host: "rt-triplets", showSplit: false, heading: "none",
      match: id => /^(rt|robotwin)/i.test(id) },
    { key: "fidelity", host: "eb-triplets", showSplit: false, heading: "none",
      match: id => /^(ego|egovla)/i.test(id) },
  ];

  // ---------------------------------------------------------- the three kinds
  // What a column is, in words, keyed by the `kind` the file gives it. This is
  // the section's whole contract with the reader, so it is written here once and
  // never derived from a label, a filename or a column position.
  const KINDS = {
    gt: {
      eyebrow: "Ground truth",
      role: "simulator render",
      legend: "sim-gt",
      what: "The simulator's own render of this episode. Not generated.",
    },
    dream: {
      eyebrow: "Dream",
      role: "generated",
      legend: "sim-dream",
      what: "Generated by the world model. The only generated video in this row.",
    },
    skeleton: {
      eyebrow: "Skeleton",
      role: "conditioning input",
      legend: "sim-skel",
      what: "The conditioning input the model was given. Drawn, not predicted.",
    },
  };
  // Reading order across a row, independent of the order the file lists cells in.
  const KIND_ORDER = ["gt", "dream", "skeleton"];

  // Rows autoplay, so honour the same preference the rest of the page does:
  // start paused and let the row's own play button opt in.
  const SIM_REDUCED = !!(window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // Same icon set as the real-robot and dreams rows, so the controls read
  // identically. Drawn inline rather than pulled from an icon font so the page
  // keeps its no-dependency shape.
  const SIM_ICON = {
    pause: `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"><line x1="9" y1="4" x2="9" y2="20"/>
      <line x1="15" y1="4" x2="15" y2="20"/></svg>`,
    play: `<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <polygon points="6 4 20 12 6 20 6 4"/></svg>`,
    restart: `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"><polyline points="2 4 2 10 8 10"/>
      <path d="M4.2 14.5a8 8 0 1 0 1.9-8.6L2 10"/></svg>`,
    shuffle: `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 5h3.5a4 4 0 0 1 3.3 1.8l4.4 6.4A4 4 0 0 0 17.5 15H21"/>
      <polyline points="18 12 21 15 18 18"/>
      <path d="M3 19h3.5a4 4 0 0 0 3.3-1.8l.9-1.3"/>
      <path d="M14.1 8.1l.6-.9A4 4 0 0 1 18 5.4"/>
      <polyline points="18 2 21 5 18 8"/></svg>`,
  };

  // Every row controller currently on the page: element -> clock. Kept in a map
  // rather than hung off the DOM node, which is how a second script would start
  // fighting with main.js. A row that gets replaced is deleted from here and its
  // clock destroyed, never parked.
  const clocks = new Map();
  let io = null;        // one observer for the life of the page
  let warnedKind = false;

  // The section is spliced in separately from this file, so do nothing at all
  // when its hosts are absent: no fetch, no listeners, no console noise.
  const hosts = new Map();
  for (const b of BLOCKS) {
    const el = document.getElementById(b.host);
    if (el) hosts.set(b.host, el);
  }
  if (!hosts.size) return;

  // ---------------------------------------------------------- fetch + render
  fetch(SIM_URL, { cache: "no-store" })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();          // a malformed file rejects here, not later
    })
    .then(render)
    .catch(err => {
      // Never throw out of here: a pending index is the expected state while the
      // clips are still being encoded. One warning, then the visible idiom.
      console.warn("SIM load failed:", err);
      const viaFile = location.protocol === "file:";
      const msg = viaFile
        ? `This page is open from the filesystem (<code>file://</code>), so the browser refuses to
           read <code>${SIM_URL}</code>. Serve it over HTTP instead:
           <code>cd website &amp;&amp; ./serve.sh</code>.`
        : `<strong>Assets pending.</strong> <code>${SIM_URL}</code> is not readable or not valid
           JSON yet (${esc(String(err))}), so the simulation rows are not on the page. The clips
           and that index come from a separate encoding step.`;
      for (const el of hosts.values()) pending(el, msg);
    });

  function pending(hostEl, html) {
    hostEl.innerHTML = `<p class="gallery__loading">${html}</p>`;
  }

  function render(data) {
    const file = data && typeof data === "object" ? data : {};
    for (const b of BLOCKS) {
      const hostEl = hosts.get(b.host);
      if (!hostEl) continue;
      // Each block is built inside its own try, so a surprise in one block's
      // data cannot take the other block off the page with it.
      try {
        renderBlock(b, hostEl, file[b.key]);
      } catch (err) {
        console.warn(`SIM ${b.key} block failed:`, err);
        pending(hostEl, `<strong>Assets pending.</strong> The <code>${b.key}</code> block of
          <code>${SIM_URL}</code> could not be rendered (${esc(String(err))}).`);
      }
    }
  }

  function renderBlock(b, hostEl, raw) {
    const block = raw && typeof raw === "object" ? raw : {};
    // A row with no usable cell has nothing to compare, so it is not a row.
    const rows = (Array.isArray(block.rows) ? block.rows : [])
      .map(normaliseRow)
      .filter(r => r && r.cells.length)
      // `match` keeps only the rows belonging to this host's domain. No match means
      // take everything, so a block without a filter behaves as before.
      .filter(r => !b.match || b.match(String(r.id || "")));

    if (!rows.length) {
      pending(hostEl, `<strong>Assets pending.</strong> The <code>${b.key}</code> block of
        <code>${SIM_URL}</code> carries no rows with clips yet, so there is nothing to show here.`);
      return;
    }

    const state = {
      b,
      rows,
      win: windowSize(rows.length),
      shown: [],
      stage: null,
      // Namespaced by HOST, not by block key: the same block is now rendered into
      // two hosts (one per domain), so keying ids on the key alone put duplicate
      // ids on the page and pointed every aria-labelledby at the first one.
      ns: `sim-${slugify(b.host)}`,
      titleId: `sim-${slugify(b.host)}-title`,
    };
    // First paint is the file's own order, so a reload lands on the same rows;
    // Shuffle is the only thing that moves the window.
    state.shown = rows.map((_r, i) => i).slice(0, state.win);

    hostEl.innerHTML = "";
    if ((b.heading || "full") !== "full") {
      const label = String(block.label || "").trim();
      if (label) hostEl.setAttribute("aria-label", label);
    }
    hostEl.appendChild(buildBlockHeader(state, block));
    if (state.win < rows.length) hostEl.appendChild(buildPicker(state));

    state.stage = document.createElement("div");
    state.stage.className = "sim-stage";
    hostEl.appendChild(state.stage);

    paintRows(state);
  }

  // Never let the window take more than half the pool: then the set of rows not
  // on screen is always at least as big as the window, so a shuffle can always
  // find a full set that re-picks nothing currently showing.
  function windowSize(pool) {
    if (pool <= WINDOW) return pool;
    return Math.max(1, Math.min(WINDOW, Math.floor(pool / 2)));
  }

  // The block's own heading and caption, straight from the file. Built once per
  // render and never touched by a shuffle, because this is the context its rows
  // are read through.
  function buildBlockHeader(state, block) {
    const hdr = document.createElement("header");
    hdr.className = "sim-block__hdr";
    const label = String(block.label || "").trim();
    const caption = String(block.caption || "").trim();
    const mode = state.b.heading || "full";
    // No <h3> in "caption" mode: the HTML already titled this block, and the
    // host carries the accessible name instead so the block is still labelled.
    const title = mode === "full"
      ? `<h3 class="sim-block__title" id="${state.titleId}">${esc(label || state.b.key)}</h3>`
      : "";
    hdr.innerHTML = `${title}
      ${caption && mode !== "none" ? `<p class="sim-block__caption">${esc(caption)}</p>` : ""}`;
    return hdr;
  }

  // ---------------------------------------------------------- control strip
  // .picker/.picker__btn are the page-wide picker component defined in
  // css/style.css and shared with the robustness and dreams sections; nothing
  // here restyles them, so all three strips are the same control rather than
  // lookalikes.
  function buildPicker(state) {
    const strip = document.createElement("div");
    strip.className = "picker";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "picker__btn sim-shuffle";
    // Icon plus a word: the glyph alone would carry the whole meaning by shape,
    // and the label alone would not read as the block's one action.
    btn.innerHTML = `${SIM_ICON.shuffle}<span class="sim-shuffle__text">Shuffle episodes</span>`;
    btn.setAttribute("aria-label", "Shuffle: show a different set of episodes in this block");
    btn.addEventListener("click", () => shuffleBlock(state));

    const hint = document.createElement("p");
    hint.className = "sim-shuffle__hint";
    // Counted off the file rather than written down: how many rows one click
    // re-rolls, and how big the pool it draws from is.
    const n = state.win;
    hint.textContent = `showing ${n} of ${state.rows.length} episodes; ` +
      `one click swaps ${n === 1 ? "it" : `all ${n}`} for ${n === 1 ? "another" : "others"} ` +
      `not currently on screen`;

    strip.append(btn, hint);
    return strip;
  }

  // One click, the whole window: draw a full set from the rows that are NOT on
  // screen, so a shuffle is always visibly a shuffle and never re-picks a row
  // the reader is already looking at.
  function shuffleBlock(state) {
    const unshown = state.rows
      .map((_r, i) => i)
      .filter(i => state.shown.indexOf(i) < 0);
    if (unshown.length < state.win) return;   // cannot happen: see windowSize()
    state.shown = sample(unshown, state.win).sort((x, y) => x - y);
    paintRows(state);
  }

  // Partial Fisher-Yates over a copy: k distinct members of `pool`.
  function sample(pool, k) {
    const a = pool.slice();
    for (let i = 0; i < k && i < a.length; i++) {
      const j = i + Math.floor(Math.random() * (a.length - i));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a.slice(0, k);
  }

  // Build the new rows first, then tear down the outgoing ones, so the block is
  // never empty mid-swap and every outgoing clock is stopped exactly once.
  function paintRows(state) {
    const outgoing = Array.from(state.stage.children);
    const built = state.shown.map(i => buildRow(state, state.rows[i], i));
    state.stage.replaceChildren(...built);
    for (const el of outgoing) teardownRow(el);
    for (const el of built) observeRow(el);
  }

  // The outgoing row's clock owns a requestAnimationFrame loop; one leaked loop
  // per row per shuffle would be a steady leak for a reader who keeps clicking,
  // so it is destroyed and unobserved here rather than parked.
  function teardownRow(el) {
    const clock = clocks.get(el);
    if (!clock) return;
    if (io) io.unobserve(el);
    clock.destroy();
    clocks.delete(el);
  }

  // ---------------------------------------------------------- one row
  function buildRow(state, row, idx) {
    const { b } = state;
    const art = document.createElement("article");
    art.className = `sim-row sim-row--${slugify(b.key)}`;
    // Kept for inspection only: this is how we tell which episode is on screen
    // without printing demo numbers on the page.
    if (row.id) art.dataset.rowId = row.id;

    const titleId = `${state.ns}-row-${idx}`;
    art.setAttribute("aria-labelledby", titleId);

    // ---- header: label, length, split, controls
    const hdr = document.createElement("header");
    hdr.className = "sim-row__hdr";

    const text = document.createElement("div");
    text.className = "sim-row__text";
    text.innerHTML = `<h4 class="sim-row__title" id="${titleId}">${esc(row.label)}</h4>
      ${row.lengthLine ? `<p class="sim-row__meta">${esc(row.lengthLine)}</p>` : ""}`;
    hdr.appendChild(text);

    // The split is what keeps a failed training episode from reading as a model
    // error, so it travels with the row rather than living in a footnote.
    if (b.showSplit && row.split) {
      const chip = document.createElement("p");
      chip.className = `sim-chip${row.splitFailed ? " sim-chip--failed" : ""}`;
      chip.innerHTML = `<span class="sim-chip__k">Training split</span>
        <span class="sim-chip__v">${esc(row.split)}</span>`;
      hdr.appendChild(chip);
    }

    // ---- the clock this row's clips are slaved to
    const clock = makeClock(row.duration);

    const name = row.label;
    const toggle = control(SIM_ICON.pause, "");
    const restart = control(SIM_ICON.restart, `Restart the ${name} row from the first frame`);
    const applyPaused = () => {
      toggle.innerHTML = clock.paused() ? SIM_ICON.play : SIM_ICON.pause;
      toggle.setAttribute("aria-label",
        `${clock.paused() ? "Play" : "Pause"} all clips in the ${name} row together`);
    };
    toggle.addEventListener("click", () => { clock.setPaused(!clock.paused()); applyPaused(); });
    restart.addEventListener("click", () => { clock.restart(); applyPaused(); });

    const ctrls = document.createElement("div");
    ctrls.className = "sim-row__ctrls";
    ctrls.append(toggle, restart);
    hdr.appendChild(ctrls);
    art.appendChild(hdr);

    // ---- the notes that explain the shape of this row rather than its content
    for (const note of rowNotes(b, row)) {
      const p = document.createElement("p");
      p.className = "sim-row__note";
      p.textContent = note;
      art.appendChild(p);
    }

    // ---- the cells, in gt -> dream -> skeleton order, however many there are
    const cells = document.createElement("div");
    cells.className = "sim-cells";
    cells.dataset.cells = String(row.cells.length);
    cells.style.setProperty("--sim-cols", String(row.cells.length));
    if (row.aspect) cells.style.setProperty("--sim-aspect", row.aspect);
    for (const cell of row.cells) cells.appendChild(buildCell(cell, name, clock));
    art.appendChild(cells);

    clock.setPaused(SIM_REDUCED);
    applyPaused();
    clocks.set(art, clock);
    return art;
  }

  // Why this row looks the way it does. Both notes are about the row's *shape*,
  // which is the thing a reader would otherwise read as a defect or an omission.
  function rowNotes(b, row) {
    const notes = [];
    if (b.showSplit && row.splitFailed) {
      notes.push(`This episode is in the ${row.split} split. The world model trains on failures ` +
        `as well as successes, so this is one of its training examples, not a model error.`);
    }
    if (row.skeletonMissing) {
      notes.push(`The conditioning skeleton for this episode could not be recovered, so there is ` +
        `no skeleton column here. Nothing has been omitted from the comparison.`);
    }
    return notes;
  }

  function buildCell(cell, name, clock) {
    const kind = KINDS[cell.kind];
    const fig = document.createElement("figure");
    fig.className = `sim-cell sim-cell--${cell.kind}`;

    const head = document.createElement("div");
    head.className = "sim-cell__head";
    head.innerHTML = `<span class="sim-cell__eyebrow">${esc(kind.eyebrow)}</span>
      <span class="sim-cell__role">${esc(kind.role)}</span>`;
    fig.appendChild(head);

    // A clip that is not on disk yet degrades to a labelled hole with nothing to
    // click, rather than a <video> that will never play.
    const frame = document.createElement(cell.src ? "button" : "div");
    frame.className = "sim-frame";

    if (!cell.src) {
      frame.classList.add("sim-frame--missing");
      frame.dataset.missing = "clip not available";
    } else {
      frame.type = "button";
      frame.setAttribute("aria-label",
        `Enlarge the ${kind.eyebrow.toLowerCase()} clip for ${name}`);
      const v = document.createElement("video");
      v.src = cell.src;
      // Attributes as well as properties: the contract for these clips is muted,
      // looping, inline and metadata-only until they are needed.
      v.muted = true;
      for (const [k, val] of [["muted", ""], ["loop", ""], ["playsinline", ""],
        ["preload", "metadata"]]) {
        v.setAttribute(k, val);
      }
      v.loop = true;
      v.playsInline = true;
      v.preload = "metadata";
      // The head and caption carry the meaning; the player has no controls, so
      // keep it out of the accessibility tree the way the other sections do.
      v.setAttribute("aria-hidden", "true");
      v.addEventListener("error", () => {
        // Drop it from the clock too, or the row keeps steering a dead element,
        // and take the enlarge affordance away with the clip it would show.
        clock.drop(v);
        frame.classList.add("sim-frame--missing");
        frame.dataset.missing = "clip not available";
        frame.disabled = true;
      });
      frame.appendChild(v);
      clock.add(v);
      frame.addEventListener("click", () => openSimLightbox(frame, cell, name));
    }
    fig.appendChild(frame);

    // What this column is, in words, readable with video disabled — which is the
    // point of putting it in the caption rather than over the picture. The clip
    // filename is deliberately not printed: it carries the episode id, which
    // stays on the row as data-row-id instead.
    const cap = document.createElement("figcaption");
    cap.className = "sim-cell__meta";
    cap.textContent = cell.src ? kind.what : `${kind.what} Clip pending.`;
    fig.appendChild(cap);

    return fig;
  }

  // ---------------------------------------------------------- normalising
  // Everything the page shows about a row, pulled off the file once. A row that
  // survives this has at least one labellable cell; anything missing from the
  // file is simply absent from the row rather than defaulted to a claim.
  function normaliseRow(raw) {
    if (!raw || typeof raw !== "object") return null;

    const cells = (Array.isArray(raw.cells) ? raw.cells : [])
      .map(c => {
        if (!c || typeof c !== "object") return null;
        const kind = String(c.kind || "").toLowerCase();
        // A column the page cannot label unambiguously is worse than no column
        // at all in a section whose whole job is saying which video is which.
        if (!KINDS[kind]) {
          if (kind && !warnedKind) {
            warnedKind = true;
            console.warn(`SIM: ignoring cell of unknown kind "${kind}"`);
          }
          return null;
        }
        return { kind, src: asset(c.src) };
      })
      .filter(Boolean)
      .sort((a, c) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(c.kind));

    const split = String(raw.split == null ? "" : raw.split).trim();
    const frames = Number(raw.frames), fps = Number(raw.fps);
    const duration = (isFinite(frames) && frames > 0 && isFinite(fps) && fps > 0)
      ? frames / fps : 0;

    const bits = [];
    if (isFinite(frames) && frames > 0) bits.push(`${frames} frames`);
    if (isFinite(fps) && fps > 0) bits.push(`${fps} fps`);
    if (duration > 0) bits.push(`${duration.toFixed(1)} s`);

    const w = Number(raw.width), h = Number(raw.height);

    return {
      id: String(raw.id || "").trim(),
      label: String(raw.label || "").trim() || "Episode",
      split,
      // Derived from the datum itself rather than matched against a list of
      // known split names, the same way the dreams section derives its caveat.
      splitFailed: /fail/i.test(split),
      // Only meaningful where the file actually says the skeleton did not match;
      // a row that simply has no skeleton key makes no claim either way.
      skeletonMissing: raw.skeleton_matched === false,
      cells,
      duration,
      lengthLine: bits.join(" · "),
      aspect: (isFinite(w) && w > 0 && isFinite(h) && h > 0) ? `${w} / ${h}` : "",
    };
  }

  // ---------------------------------------------------------- one clock a row
  // Clips left to autoplay on their own drift apart within seconds, which
  // destroys the only thing the row is for. So the row owns a clock: `t` advances
  // with wall time and every clip is steered onto it — nudged with playbackRate
  // for small errors, seeked for large ones. No clip is the leader; if one cannot
  // decode fast enough the clock yields to it instead of seeking it forward every
  // frame. Same tuning as js/dreams.js, so both sections behave identically.
  const TUNE = {
    SOFT: 0.015,   // s — inside this, leave the clip alone
    HARD: 0.12,    // s — outside this, seek instead of nudging
    YIELD: 0.30,   // s — a clip this far behind pulls the clock back to it
    GAIN: 0.8,     // playbackRate correction per second of error
    RATE: 0.08,    // max playbackRate deviation, i.e. ±8% — inaudible, we are muted
    MAX_DT: 0.25,  // s — ignore a longer gap (backgrounded tab, breakpoint)
  };

  function makeClock(initialDuration) {
    const members = [];
    let duration = initialDuration > 0 ? initialDuration : 0;
    let t = 0, last = 0, raf = 0, paused = false, onScreen = false, dead = false;

    const norm = x => (duration > 0 ? ((x % duration) + duration) % duration : Math.max(0, x));
    // shortest signed distance, so a clip that has just looped round to 0 is not
    // read as being a whole clip's length behind
    const wrap = d => (duration > 0 ? d - duration * Math.round(d / duration) : d);
    const seek = (v, to) => { try { if (v.readyState >= 1) v.currentTime = to; } catch (_e) {} };

    function schedule() {
      if (!dead && !paused && onScreen && members.length && !raf) raf = requestAnimationFrame(tick);
    }

    function tick(now) {
      raf = 0;
      if (dead || paused || !onScreen) return;
      const dt = last ? Math.min((now - last) / 1000, TUNE.MAX_DT) : 0;
      last = now;
      t = norm(t + dt);

      // measure everything first: the worst laggard decides whether the clock
      // advances or waits
      let behind = 0;
      const drift = members.map(v => {
        const d = wrap(v.currentTime - t);
        if (-d > behind) behind = -d;
        return d;
      });
      if (behind > TUNE.YIELD) {
        t = norm(t - behind);
        schedule();
        return;
      }

      members.forEach((v, i) => {
        const d = drift[i];
        const ad = Math.abs(d);
        if (ad > TUNE.HARD) {
          seek(v, t);
          if (v.playbackRate !== 1) v.playbackRate = 1;
        } else if (ad > TUNE.SOFT) {
          const r = 1 - d * TUNE.GAIN;
          v.playbackRate = Math.min(1 + TUNE.RATE, Math.max(1 - TUNE.RATE, r));
        } else if (v.playbackRate !== 1) {
          v.playbackRate = 1;
        }
      });
      schedule();
    }

    function run() {
      if (dead || paused || !onScreen) return;
      for (const v of members) v.play().catch(() => {});
      schedule();
    }

    function halt() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      last = 0;   // so the next frame starts with dt = 0 rather than the gap
      for (const v of members) { try { v.pause(); } catch (_e) {} }
    }

    return {
      add(v) {
        if (dead) return;
        members.push(v);
        // The frame count and fps in the index are authoritative, but fall back
        // to the file's own duration if they were absent.
        v.addEventListener("loadedmetadata", () => {
          if (duration <= 0 && isFinite(v.duration) && v.duration > 0) duration = v.duration;
        });
        if (!paused && onScreen) run();
      },
      drop(v) {
        const i = members.indexOf(v);
        if (i >= 0) members.splice(i, 1);
        if (!members.length) halt();
      },
      paused: () => paused,
      setPaused(p) {
        if (dead) return;
        paused = !!p;
        if (paused) halt(); else run();
      },
      setOnScreen(s) {
        if (dead) return;
        onScreen = !!s;
        if (onScreen) run(); else halt();
      },
      restart() {
        if (dead) return;
        t = 0;
        for (const v of members) seek(v, 0);
        paused = false;
        run();
      },
      // the row this clock drove has been replaced: stop the frame loop, stop the
      // clips, and refuse to be restarted, so nothing here can reschedule
      destroy() {
        dead = true;
        paused = true;
        onScreen = false;
        halt();
        members.length = 0;
      },
    };
  }

  // Playback follows the viewport, but a row the reader paused by hand stays
  // paused when it scrolls back in. One observer for the life of the page,
  // pointed at each row as it is built; a replaced row is unobserved in
  // teardownRow(), so a destroyed clock is never called again.
  function observeRow(art) {
    const clock = clocks.get(art);
    if (!clock) return;
    if (!("IntersectionObserver" in window)) {
      clock.setOnScreen(true);
      return;
    }
    if (!io) {
      io = new IntersectionObserver(entries => {
        for (const e of entries) {
          const c = clocks.get(e.target);
          if (c) c.setOnScreen(e.isIntersecting);
        }
      }, { rootMargin: "100px 0px", threshold: 0.2 });
    }
    io.observe(art);
  }

  // ---------------------------------------------------------- lightbox
  // Reuse the page's #lightbox exactly the way main.js's openRealworldLightbox()
  // and dreams.js's openInLightbox() drive it: fill #lb-video, unhide it, show
  // it. Closing is already wired in main.js (backdrop, close button, Escape), so
  // nothing is re-bound here.
  let lbTrigger = null;
  let lbWatcher = null;

  function openSimLightbox(trigger, cell, name) {
    const lb = document.getElementById("lightbox");
    const title = document.getElementById("lb-title");
    const sub = document.getElementById("lb-sub");
    const vid = document.getElementById("lb-video");
    const legend = document.getElementById("lb-legend");
    if (!lb || !vid || !cell.src) return;
    const kind = KINDS[cell.kind];
    if (!kind) return;

    // main.js's dream-vs-real lightbox parks a two-video row beside #lb-video and
    // hides the single slot, and only restores it from its own close button. Undo
    // that here, the same way its real-robot lightbox does, so a pair dismissed
    // with Escape does not linger behind this clip.
    const stale = vid.parentNode.querySelector(".lb-cmp-row");
    if (stale) stale.remove();
    vid.hidden = false;

    if (title) title.textContent = `${name} — ${kind.eyebrow}`;
    if (sub) sub.textContent = kind.what;
    if (legend) {
      legend.innerHTML = `<span class="legend--${kind.legend}">${esc(kind.eyebrow)} · ${esc(kind.role)}</span>`;
    }

    vid.src = cell.src;
    vid.muted = true;
    vid.loop = true;

    lb.hidden = false;
    document.body.style.overflow = "hidden";
    vid.play().catch(() => {});
    const close = lb.querySelector(".lightbox__close");
    if (close) close.focus();

    // main.js owns the close handlers and restores focus to whatever it opened
    // last, which is not this button. Watching the `hidden` attribute puts focus
    // back where it belongs without touching those handlers.
    lbTrigger = trigger;
    if (!lbWatcher) {
      lbWatcher = new MutationObserver(() => {
        if (!lb.hidden || !lbTrigger) return;
        const back = lbTrigger;
        lbTrigger = null;
        try { back.focus(); } catch (_e) {}
      });
      lbWatcher.observe(lb, { attributes: true, attributeFilter: ["hidden"] });
    }
  }

  // ---------------------------------------------------------- utils
  function control(icon, label) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sim-ctrl";
    b.innerHTML = icon;
    if (label) b.setAttribute("aria-label", label);
    return b;
  }

  // Both `{src: "..."}` and a bare string are accepted; anything else is "no
  // asset", which is a state the page has to survive.
  function asset(slot) {
    if (!slot) return "";
    const src = typeof slot === "string" ? slot : slot.src;
    return typeof src === "string" && src.trim() ? src.trim() : "";
  }

  function slugify(s) {
    return String(s || "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
