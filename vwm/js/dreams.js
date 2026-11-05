/* DreamRehearse project page — real-world world-model dreams (#dreams)
   - loads videos/realworld_dreams/DREAMS.json
   - all four groups are on the page at once, one three-up row each: real
     (ground truth) | skeleton (the conditioning input) | dream (the only
     generated video). A row shows ONE of its group's episodes; the section's
     single Shuffle button re-rolls every row at once, independently per group
     and never onto the episode that row is already showing.
   - a row's group context — label, caption, conditioning chip and the caveat
     derived from the conditioning string — is built once with the row and
     never moves, because reading one group's caveat beside another group's
     video is the one way this section could lie: a fitted-sim episode is
     *expected* not to match its real clip, a real-skeleton episode is not.
   - the episode id is deliberately not printed. It stays in DREAMS.json and is
     exposed on each row as data-episode, so which episode is on screen can
     always be read off the element (and off the clip filenames in the
     captions), without turning the page into a list of demo numbers.
   - the clips in a row are slaved to ONE clock per row rather than left to
     autoplay independently, because the row only means anything if the three
     stay frame-aligned; re-rolling a row destroys that row's clock (and its
     requestAnimationFrame loop) before building the next one, so shuffling
     cannot leak a loop per row per click
   - OOD episodes carry an `anchor` PNG instead of a `real` video: those scenes
     were never demonstrated, so no real video of them exists
   - click a clip to enlarge it in the page's existing #lightbox

   Self-contained on purpose: everything lives inside this IIFE, nothing is
   added to window, and the lightbox handlers wired by js/main.js are reused
   rather than re-bound. Loaded after main.js; harmless if the #dreams partial
   has not been spliced into index.html yet.
*/

(() => {
  "use strict";

  const DREAMS_URL = "videos/realworld_dreams/DREAMS.json";

  const host = document.getElementById("real-dreams");
  // The section is spliced in separately from this file, so do nothing at all
  // when it is absent: no fetch, no listeners, no console noise.
  if (!host) return;

  const section = host.closest(".section") || host;

  // ---------------------------------------------------------- roles
  // The three columns, in reading order. `anchor` is the still-image form of
  // the first column and shares its accent. This table is structure, not data:
  // every label, caption, id, count and path comes from DREAMS.json.
  const ROLES = {
    real:     { eyebrow: "Real",             role: "ground truth", legend: "rwd-real" },
    anchor:   { eyebrow: "Real start frame", role: "ground truth", legend: "rwd-real" },
    skeleton: { eyebrow: "Skeleton",         role: "conditioning input", legend: "rwd-skel" },
    dream:    { eyebrow: "Dream",            role: "generated", legend: "rwd-dream" },
  };
  const COLUMNS = ["real", "skeleton", "dream"];

  // The two blocks of the file, in the order they appear on the page. Each
  // names the key its entries are identified by and the standing caveat that
  // applies to every row in it.
  const BLOCKS = [
    {
      key: "tasks",
      idKey: "task",
      eyebrow: "Demonstrated task",
      note: "",
    },
    {
      key: "ood",
      idKey: "variant",
      eyebrow: "Out-of-distribution scene",
      note: `This scene was never demonstrated on the robot, so no real video of it exists.
             The first column is the real frame the dream starts from — a still, not a clip —
             and the absence of a real video beside it is a property of the data, not a
             missing file.`,
    },
  ];

  // Rows autoplay, so honour the same preference the rest of the page does:
  // start paused and let the row's own play button opt in.
  const DR_REDUCED = !!(window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // Same icon set as the real-robot rows, so the controls read identically.
  const DR_ICON = {
    pause: `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"><line x1="9" y1="4" x2="9" y2="20"/>
      <line x1="15" y1="4" x2="15" y2="20"/></svg>`,
    play: `<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <polygon points="6 4 20 12 6 20 6 4"/></svg>`,
    restart: `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"><polyline points="2 4 2 10 8 10"/>
      <path d="M4.2 14.5a8 8 0 1 0 1.9-8.6L2 10"/></svg>`,
    // two crossing arrows: the standard shuffle glyph, drawn here rather than
    // pulled from an icon font so the page keeps its single-file-per-concern,
    // no-dependency shape
    shuffle: `<svg class="rwd-shuffle__icon" aria-hidden="true" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 5h3.5a4 4 0 0 1 3.3 1.8l4.4 6.4A4 4 0 0 0 17.5 15H21"/>
      <polyline points="18 12 21 15 18 18"/>
      <path d="M3 19h3.5a4 4 0 0 0 3.3-1.8l.9-1.3"/>
      <path d="M14.1 8.1l.6-.9A4 4 0 0 1 18 5.4"/>
      <polyline points="18 2 21 5 18 8"/></svg>`,
  };

  // Every row controller currently on the page, so the intersection observer
  // and the clock never need a property hung off a DOM node (which is how a
  // second script would start fighting with main.js). A row that gets re-rolled
  // is removed from here and its clock destroyed, never parked.
  const rows = new Map();   // Element -> clock
  let io = null;            // one observer for the life of the page

  // One record per group, in the file's own order, each holding its block, its
  // entry, the caveat derived from that entry's conditioning string, its usable
  // episodes and which of them is on screen. The group context travels with the
  // row rather than being looked up at swap time, so a row's header can never
  // belong to a different group than the video under it.
  let groups = [];

  // Selector state. `active` is an index into groups, or -1 before the first
  // activate(); the other three are null until buildSelector() runs, which it
  // does not when there is only one group to show.
  let active = -1;
  let selList = null;
  let selStage = null;
  let selBtns = [];
  let pickerHint = null;
  let pickerBtn = null;

  // ---------------------------------------------------------- fetch + render
  fetch(DREAMS_URL, { cache: "no-store" })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();        // a malformed file rejects here, not later
    })
    .then(render)
    .catch(err => {
      // Never throw out of here: a pending index is the expected state while
      // the clips are still being encoded.
      console.warn("DREAMS load failed:", err);
      const viaFile = location.protocol === "file:";
      pending(viaFile
        ? `This page is open from the filesystem (<code>file://</code>), so the browser refuses to
           read <code>${DREAMS_URL}</code>. Serve it over HTTP instead:
           <code>cd website &amp;&amp; ./serve.sh</code>.`
        : `<strong>Assets pending.</strong> <code>${DREAMS_URL}</code> is not readable or not valid
           JSON yet (${esc(String(err))}), so the real-world dreams are not on the page. The clips
           and that index come from a separate encoding step.`);
    });

  function pending(html) {
    host.innerHTML = `<p class="gallery__loading">${html}</p>`;
  }

  function render(data) {
    groups = [];
    for (const block of BLOCKS) {
      for (const entry of entriesOf(data, block)) {
        // a null hole in the episode list is not an episode
        const episodes = entry.episodes.filter(Boolean);
        if (!episodes.length) continue;
        groups.push({
          block,
          entry,
          episodes,
          caveat: conditioningCaveat(entry.conditioning),
          // the group's label is what the row is titled by and what every
          // control and lightbox caption in it is named after
          name: String(entry.label || entry[block.idKey] || block.key),
          titleId: "",
          el: null,     // .rwd-group
          row: null,    // the <article> on screen now
          cur: -1,      // index into episodes
        });
      }
    }

    if (!groups.length) {
      pending(`<strong>Assets pending.</strong> <code>${DREAMS_URL}</code> carries no
        <code>tasks</code> or <code>ood</code> entries yet, so there is nothing to show here.`);
      return;
    }

    // The encoded size is recorded once for the whole file; use it so a
    // re-encode at another resolution is letterboxed correctly rather than
    // cropped to a hard-coded aspect.
    const res = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(String((data.meta || {}).resolution || ""));
    if (res) section.style.setProperty("--rwd-aspect", `${res[1]} / ${res[2]}`);

    host.innerHTML = "";
    host.appendChild(buildPicker());

    groups.forEach((g, i) => {
      g.titleId = `dreams-${g.block.key}-${slugify(g.entry[g.block.idKey] || g.name) || i}`;
      g.el = buildGroup(g);
    });

    // One group on screen, chosen from a column beside it, rather than all four
    // stacked. Four three-up rows is four screens of scrolling for a comparison
    // a reader makes one task at a time, and only the visible group decodes
    // video — which matters here, where every row drives three clips off one clock.
    if (groups.length > 1) {
      host.appendChild(buildSelector());
      activate(0);
    } else {
      const stage = document.createElement("div");
      stage.className = "rwd-stage";
      stage.appendChild(groups[0].el);
      host.appendChild(stage);
      showEpisode(groups[0], 0);
    }
  }

  // ---------------------------------------------------------- task selector
  function buildSelector() {
    const wrap = document.createElement("div");
    wrap.className = "sel";

    selList = document.createElement("div");
    selList.className = "sel__list";
    selList.setAttribute("role", "tablist");
    selList.setAttribute("aria-orientation", "vertical");
    selList.setAttribute("aria-label", "Choose a task");

    selStage = document.createElement("div");
    selStage.className = "sel__stage rwd-stage";

    selBtns = groups.map((g, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `sel__btn sel__btn--${g.block.key}`;
      b.setAttribute("role", "tab");
      const n = g.episodes.length;
      const sim = (g.entry.sim && g.entry.sim.clips || []).length;
      b.innerHTML =
        `<span class="sel__n" aria-hidden="true">${i + 1}</span>` +
        `<span class="sel__text">` +
          `<span class="sel__name">${esc(g.name)}</span>` +
          `<span class="sel__meta">${n} episode${n === 1 ? "" : "s"}` +
          (sim ? ` &middot; ${sim} sim rollout${sim === 1 ? "" : "s"}` : "") +
          `</span></span>`;
      b.addEventListener("click", () => activate(i));
      b.addEventListener("keydown", e => {
        const d = (e.key === "ArrowDown" || e.key === "ArrowRight") ? 1
                : (e.key === "ArrowUp" || e.key === "ArrowLeft") ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        const j = (i + d + groups.length) % groups.length;
        activate(j);
        selBtns[j].focus();
      });
      selList.appendChild(b);
      return b;
    });

    wrap.append(selList, selStage);
    return wrap;
  }

  // Swap which group is on screen. The outgoing group's row is destroyed and
  // detached, not parked: leaving it inside its own (detached) group element
  // would mean the next activate() appends a second row beside it, and its
  // clock's rAF loop would keep running for a group nobody can see.
  function activate(i) {
    if (i === active) return;
    const prev = groups[active];
    if (prev) {
      teardownRow(prev.row);
      if (prev.row) prev.row.remove();
      prev.row = null;
      prev.cur = -1;
    }
    active = i;
    const g = groups[i];
    selStage.innerHTML = "";
    selStage.appendChild(g.el);
    selBtns.forEach((b, n) => {
      b.setAttribute("aria-selected", String(n === i));
      b.tabIndex = n === i ? 0 : -1;
    });
    showEpisode(g, 0);
    refreshPickerHint();
  }

  function entriesOf(data, block) {
    const raw = data && Array.isArray(data[block.key]) ? data[block.key] : [];
    // a group with no episodes has nothing to compare, so it is not a group
    return raw.filter(e => e && Array.isArray(e.episodes) && e.episodes.length);
  }

  // ---------------------------------------------------------- control strip
  // .picker/.picker__btn are the page-wide picker component defined in
  // css/style.css and shared with the robustness section; nothing here
  // restyles them, so both strips are the same control rather than lookalikes.
  function buildPicker() {
    const strip = document.createElement("div");
    strip.className = "picker";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "picker__btn rwd-shuffle";
    // icon plus a word: the glyph alone would carry the whole meaning by shape,
    // and the label alone would not read as the section's one action
    btn.innerHTML = `${DR_ICON.shuffle}<span class="rwd-shuffle__text">Shuffle episodes</span>`;
    btn.setAttribute("aria-label", "Shuffle: show a different recorded episode in every row");
    btn.addEventListener("click", shuffleAll);

    const hint = document.createElement("p");
    hint.className = "rwd-shuffle__hint";

    pickerBtn = btn;
    pickerHint = hint;
    strip.append(btn, hint);
    refreshPickerHint();
    return strip;
  }

  // The hint has to be recomputed on every task switch, not written once: with
  // one group on screen, Shuffle re-rolls that group only, and its pool is the
  // selected task's episode count. A fixed "re-rolls all 4 rows" line would be
  // describing behaviour the selector removed.
  function refreshPickerHint() {
    if (!pickerHint) return;
    const g = groups[active];
    if (g) {
      const n = g.episodes.length;
      pickerHint.textContent = n > 1
        ? `one click re-rolls the ${g.name} row, drawing from its ${n} recorded episodes`
        : `${g.name} has only one recorded episode, so there is nothing to re-roll`;
      if (pickerBtn) pickerBtn.disabled = n < 2;
      return;
    }
    const pool = groups.reduce((n, x) => n + x.episodes.length, 0);
    pickerHint.textContent =
      `one click re-rolls this row, drawing from ${pool} recorded ` +
      `${pool === 1 ? "episode" : "episodes"}`;
    if (pickerBtn) pickerBtn.disabled = !groups.some(x => x.episodes.length > 1);
  }

  // Re-roll whichever group is on screen. Groups that are not displayed have no
  // row to re-roll — their row was destroyed when they were switched away from,
  // and they rebuild on episode 0 when selected again.
  function shuffleAll() {
    for (const g of groups) {
      if (active >= 0 && g !== groups[active]) continue;
      const j = pickOther(g);
      if (j !== g.cur) showEpisode(g, j);
    }
  }

  // Draw from the other episodes only: pick one of the n-1 others, then step
  // over the current index.
  function pickOther(g) {
    const n = g.episodes.length;
    if (n < 2) return g.cur;
    if (g.cur < 0) return Math.floor(Math.random() * n);
    let j = Math.floor(Math.random() * (n - 1));
    if (j >= g.cur) j += 1;
    return j;
  }

  // ---------------------------------------------------------- group
  // The group's own label, caption, block note and conditioning caveat, built
  // once and left alone: this header is the context its row is read through,
  // and it belongs to the group, not to the episode.
  function buildGroup(g) {
    const { block, entry, caveat } = g;

    const group = document.createElement("div");
    group.className = `rwd-group rwd-group--${block.key}`;

    const hdr = document.createElement("header");
    hdr.className = "rwd-group__hdr";
    hdr.innerHTML = `
      <p class="rwd-group__eyebrow">${esc(block.eyebrow)}</p>
      <h3 class="rwd-group__title" id="${g.titleId}">${esc(g.name)}</h3>
      ${entry.caption ? `<p class="rwd-group__caption">${esc(entry.caption)}</p>` : ""}
      ${block.note ? `<p class="rwd-group__note">${esc(squash(block.note))}</p>` : ""}
      ${caveat.group ? `<p class="rwd-group__note">${esc(squash(caveat.group))}</p>` : ""}`;
    group.appendChild(hdr);

    const sim = buildSimBand(entry);
    if (sim) group.appendChild(sim);

    return group;
  }

  // The simulator rollouts this task's skeletons were fitted to, replayed
  // through the real camera's calibrated pose. Deliberately a band of its own
  // rather than a fourth column in the row below: the row slaves its clips to
  // one clock because they are the same episode at the same instant, and these
  // are a different trajectory of a different length. Dropping them into that
  // row would put three aligned clips and one unaligned one under one clock and
  // invite the reader to compare frames that do not correspond.
  function buildSimBand(entry) {
    const clips = (entry.sim && Array.isArray(entry.sim.clips))
      ? entry.sim.clips.filter(c => c && c.src) : [];
    if (!clips.length) return null;

    const band = document.createElement("div");
    band.className = "rwd-sim";

    const head = document.createElement("div");
    head.className = "rwd-sim__head";
    head.innerHTML =
      `<p class="rwd-sim__eyebrow">Source trajectory</p>` +
      `<p class="rwd-sim__label">${esc(entry.sim.label || "Simulator rollout")}</p>` +
      (entry.sim.note ? `<p class="rwd-sim__note">${esc(squash(entry.sim.note))}</p>` : "");

    const strip = document.createElement("div");
    strip.className = "rwd-sim__clips";
    for (const c of clips) {
      const fig = document.createElement("figure");
      fig.className = "rwd-sim__clip";
      const v = document.createElement("video");
      v.src = c.src;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = "metadata";
      v.setAttribute("aria-label", c.label ? `Simulator rollout, ${c.label}` : "Simulator rollout");
      // poster path is derived the same way main.js derives its own
      v.poster = "videos/thumbs/" + String(c.src).replace(/^videos\//, "")
        .replace(/\.mp4$/i, ".webp");
      if (!DR_REDUCED) v.autoplay = true;
      const cap = document.createElement("figcaption");
      cap.textContent = c.label || "";
      fig.append(v, cap);
      strip.appendChild(fig);
    }

    band.append(head, strip);
    return band;
  }

  // Swap in one of this group's episodes: build the new row first, then tear
  // down the outgoing one, so the group is never without a row and the old
  // clock's frame loop is always stopped.
  function showEpisode(g, idx) {
    const ep = g.episodes[idx];
    if (!ep || !g.el) return;

    const art = buildRow(g, ep);
    const old = g.row;
    if (old && old.isConnected) old.replaceWith(art);
    else g.el.appendChild(art);
    teardownRow(old);

    g.row = art;
    g.cur = idx;
    observeRow(art);
  }

  // The outgoing row's clock owns a requestAnimationFrame loop; one leaked
  // loop per row per shuffle would be a steady leak for a reader who keeps
  // clicking, so it is destroyed and unobserved here rather than parked.
  function teardownRow(art) {
    if (!art) return;
    const clock = rows.get(art);
    if (!clock) return;
    if (io) io.unobserve(art);
    clock.destroy();
    rows.delete(art);
  }

  // What this group's conditioning string implies about the real clip beside
  // the dream. Derived from the datum itself — never from a task name —
  // because it is the difference between "the model is wrong" and "these are
  // two different trajectories".
  function conditioningCaveat(conditioning) {
    const s = String(conditioning || "").toLowerCase();
    if (/\bsim/.test(s)) {
      return {
        kind: "sim",
        group: `Fitted in simulation, so the real clip is a different trajectory and is not
                expected to match frame for frame.`,
        cell: "Different trajectory from the dream's conditioning.",
      };
    }
    if (/\breal/.test(s)) {
      return {
        kind: "real",
        group: `Taken from the real episode beside it, so the dream and the real video should
                track each other frame for frame.`,
        cell: "Same trajectory that conditioned the dream.",
      };
    }
    return { kind: "other", group: "", cell: "" };
  }

  // ---------------------------------------------------------- one episode row
  function buildRow(g, ep) {
    const { entry, caveat, name } = g;

    const art = document.createElement("article");
    art.className = "rwd-row";
    // the row is titled by its group's heading, which is right above it; the
    // episode is identified for inspection only, not in prose
    art.setAttribute("aria-labelledby", g.titleId);
    const epId = String(ep.id || "");
    if (epId) art.dataset.episode = epId;

    // ---- header: length, conditioning, controls
    const hdr = document.createElement("header");
    hdr.className = "rwd-row__hdr";
    const text = document.createElement("div");
    text.className = "rwd-row__text";
    text.innerHTML = `<span class="rwd-row__meta">${esc(lengthLine(ep))}</span>`;
    hdr.appendChild(text);

    if (entry.conditioning) {
      const cond = document.createElement("p");
      cond.className = "rwd-row__cond";
      cond.innerHTML = `<span class="rwd-row__cond-k">Conditioned on</span>
        <span class="rwd-row__cond-v">${esc(entry.conditioning)}</span>`;
      hdr.appendChild(cond);
    }

    // ---- the clock this row's clips are slaved to
    const clock = makeClock(clipDuration(ep));

    const toggle = control(DR_ICON.pause, "");
    const restart = control(DR_ICON.restart, `Restart the ${name} row from the first frame`);
    const applyPaused = () => {
      toggle.innerHTML = clock.paused() ? DR_ICON.play : DR_ICON.pause;
      toggle.setAttribute("aria-label",
        `${clock.paused() ? "Play" : "Pause"} all clips in the ${name} row together`);
    };
    toggle.addEventListener("click", () => { clock.setPaused(!clock.paused()); applyPaused(); });
    restart.addEventListener("click", () => { clock.restart(); applyPaused(); });

    const ctrls = document.createElement("div");
    ctrls.className = "rwd-row__ctrls";
    ctrls.append(toggle, restart);
    hdr.appendChild(ctrls);
    art.appendChild(hdr);

    // ---- real (or its still) | skeleton | dream, always in that order so the
    // eye can run down a column across rows
    const trio = document.createElement("div");
    trio.className = "rwd-trio";
    for (const col of COLUMNS) {
      // An OOD episode has no `real` video, only an `anchor` still. Fall back
      // to it for the first column rather than rendering an empty cell.
      const kind = (col === "real" && !asset(ep.real) && asset(ep.anchor)) ? "anchor" : col;
      trio.appendChild(buildCell(kind, ep, name, caveat, clock));
    }
    art.appendChild(trio);

    clock.setPaused(DR_REDUCED);
    applyPaused();
    rows.set(art, clock);
    return art;
  }

  function buildCell(kind, ep, name, caveat, clock) {
    const role = ROLES[kind];
    const src = asset(ep[kind]);
    const isStill = kind === "anchor";

    const fig = document.createElement("figure");
    fig.className = `rwd-cell rwd-cell--${kind}`;

    const head = document.createElement("div");
    head.className = "rwd-cell__head";
    head.innerHTML = `<span class="rwd-cell__eyebrow">${esc(role.eyebrow)}</span>
      <span class="rwd-cell__role">${esc(role.role)}</span>`;
    fig.appendChild(head);

    // A clip that is not on disk yet degrades to a labelled hole with nothing
    // to click, rather than a <video> that will never play.
    const clickable = !!src && !isStill;
    const frame = document.createElement(clickable ? "button" : "div");
    frame.className = "rwd-frame";
    if (isStill) frame.classList.add("rwd-frame--still");

    if (!src) {
      frame.classList.add("rwd-frame--missing");
      frame.dataset.missing = isStill ? "still not available" : "clip not available";
    } else if (isStill) {
      const img = document.createElement("img");
      img.src = src;
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = `${name}: the real first frame of the scene the dream starts from`;
      img.addEventListener("error", () => {
        frame.classList.add("rwd-frame--missing");
        frame.dataset.missing = "still not available";
      });
      frame.appendChild(img);
    } else {
      frame.type = "button";
      frame.setAttribute("aria-label", `Enlarge the ${role.eyebrow.toLowerCase()} clip for ${name}`);
      const v = document.createElement("video");
      v.src = src;
      // Attributes as well as properties: the contract for these clips is
      // muted, looping, inline and metadata-only until they are needed.
      v.muted = true;
      for (const [k, val] of [["muted", ""], ["loop", ""], ["playsinline", ""], ["preload", "metadata"]]) {
        v.setAttribute(k, val);
      }
      v.loop = true;
      v.playsInline = true;
      v.preload = "metadata";
      // The head and caption carry the meaning; the player has no controls, so
      // keep it out of the accessibility tree the way the other rows do.
      v.setAttribute("aria-hidden", "true");
      v.addEventListener("error", () => {
        // Drop it from the clock too, or the row keeps steering a dead element,
        // and take the enlarge affordance away with the clip it would show.
        clock.drop(v);
        frame.classList.add("rwd-frame--missing");
        frame.dataset.missing = "clip not available";
        frame.disabled = true;
      });
      frame.appendChild(v);
      clock.add(v);
      frame.addEventListener("click", () => openInLightbox(frame, kind, ep, name));
    }
    fig.appendChild(frame);

    // Provenance and caveats, readable with video disabled — which is the point
    // of putting them in the caption rather than over the picture.
    const cap = document.createElement("figcaption");
    cap.className = "rwd-cell__meta";
    // The filename is deliberately NOT printed here: it contains the episode id
    // (hammer_demo_77_real.mp4), and the episode on screen is not meant to be
    // shown. It stays recoverable from `data-episode` on the row and from the
    // element's own src, so provenance is kept without putting it on the page.
    const bits = [];
    if (isStill) bits.push("still image", "no real video for this scene");
    else if (!src) bits.push("clip pending");
    cap.textContent = bits.filter(Boolean).join(" · ");
    // Only a real *clip* can be mistaken for the motion the dream was driven
    // by, so that is the only column that carries the caveat: beside a still
    // there is no frame-by-frame comparison to get wrong.
    if (kind === "real" && caveat.cell) {
      const sub = document.createElement("span");
      sub.className = "rwd-cell__caveat";
      sub.textContent = caveat.cell;
      cap.appendChild(sub);
    }
    fig.appendChild(cap);

    return fig;
  }

  // ---------------------------------------------------------- one clock a row
  // Three <video> elements left to autoplay on their own drift apart within
  // seconds, which destroys the only thing the row is for. So the row owns a
  // clock: `t` advances with wall time, and every clip is steered onto it --
  // nudged with playbackRate for small errors, seeked for large ones. No clip
  // is the leader; if one cannot decode fast enough the clock yields to it
  // instead of seeking it forward every frame.
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
    // shortest signed distance, so a clip that has just looped round to 0 is
    // not read as being a whole clip's length behind
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
      // the row this clock drove has been replaced: stop the frame loop, stop
      // the clips, and refuse to be restarted, so nothing here can reschedule
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
    const clock = rows.get(art);
    if (!clock) return;
    if (!("IntersectionObserver" in window)) {
      clock.setOnScreen(true);
      return;
    }
    if (!io) {
      io = new IntersectionObserver(entries => {
        for (const e of entries) {
          const c = rows.get(e.target);
          if (c) c.setOnScreen(e.isIntersecting);
        }
      }, { rootMargin: "100px 0px", threshold: 0.2 });
    }
    io.observe(art);
  }

  // ---------------------------------------------------------- lightbox
  // Reuse the page's #lightbox exactly the way main.js drives it for the
  // real-robot rows: fill #lb-video, unhide it, show it. Closing is already
  // wired there (backdrop, close button, Escape), so nothing is re-bound here.
  let lbTrigger = null;
  let lbWatcher = null;

  function openInLightbox(trigger, kind, ep, name) {
    const lb = document.getElementById("lightbox");
    const title = document.getElementById("lb-title");
    const sub = document.getElementById("lb-sub");
    const vid = document.getElementById("lb-video");
    const legend = document.getElementById("lb-legend");
    if (!lb || !vid) return;
    const role = ROLES[kind];
    const src = asset(ep[kind]);
    if (!src) return;

    // main.js's dream-vs-real lightbox parks a two-video row beside #lb-video
    // and hides the single slot, and only restores it from its own close
    // button. Undo that here, the same way its real-robot lightbox does, so a
    // pair dismissed with Escape does not linger behind this clip.
    const stale = vid.parentNode.querySelector(".lb-cmp-row");
    if (stale) stale.remove();
    vid.hidden = false;

    title.textContent = `${name} — ${role.eyebrow}`;
    sub.textContent = role.role;
    legend.innerHTML = `<span class="legend--${role.legend}">${esc(role.eyebrow)} · ${esc(role.role)}</span>`;

    vid.src = src;
    vid.muted = true;
    vid.loop = true;

    lb.hidden = false;
    document.body.style.overflow = "hidden";
    vid.play().catch(() => {});
    const close = lb.querySelector(".lightbox__close");
    if (close) close.focus();

    // main.js owns the close handlers and restores focus to whatever it opened
    // last, which is not this button. Watching the `hidden` attribute puts
    // focus back where it belongs without touching those handlers.
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
    // same class as the real-robot row controls, so they are literally the
    // same button rather than a lookalike
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rw-ctrl";
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

  function clipDuration(ep) {
    const frames = Number(ep.frames), fps = Number(ep.fps);
    return (isFinite(frames) && frames > 0 && isFinite(fps) && fps > 0) ? frames / fps : 0;
  }

  // "237 frames · 20 fps · 11.9 s" — whatever of that the index actually knows
  function lengthLine(ep) {
    const frames = Number(ep.frames), fps = Number(ep.fps), secs = clipDuration(ep);
    const bits = [];
    if (isFinite(frames) && frames > 0) bits.push(`${frames} frames`);
    if (isFinite(fps) && fps > 0) bits.push(`${fps} fps`);
    if (secs > 0) bits.push(`${secs.toFixed(1)} s`);
    return bits.join(" · ");
  }

  function slugify(s) {
    return String(s || "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  }

  // the long template literals above are written across lines for readability
  function squash(s) {
    return String(s).replace(/\s+/g, " ").trim();
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
