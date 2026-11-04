/* DreamRehearse project page
   - loads videos/MANIFEST.json
   - builds the video gallery grouped by embodiment
   - builds the world-model training marquee and the trained-on/dreams-in rows
   - loads videos/realworld/REALWORLD.json and builds the real-robot ours/base rows
   - hover previews (lazy-load the mp4 only on interaction / intersection)
   - lightbox with keyboard support
   - tab switching
   - BibTeX copy button
*/

(() => {
  "use strict";

  const MANIFEST_URL = "videos/MANIFEST.json";
  const REALWORLD_URL = "videos/realworld/REALWORLD.json";
  const VIDEOS_BASE = "videos/";
  const THUMBS_BASE = "videos/thumbs/";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // The lightbox and the BibTeX copy button are plain DOM, so wire them up front
  // rather than from a render callback that a manifest failure would skip.
  wireLightbox();

  // ---------------------------------------------------------- fetch + render
  fetch(MANIFEST_URL, { cache: "no-store" })
    .then(r => r.json())
    .then(manifest => {
      renderComparisons(manifest);
      renderGeneralize(manifest);
    })
    .catch(err => {
      console.error("MANIFEST load failed:", err);
      // file:// is the usual cause: fetch() of a local path is blocked by CORS, so the manifest
      // never arrives and every strip stays empty. Say that instead of printing the raw error.
      const viaFile = location.protocol === "file:";
      const msg = viaFile
        ? `This page is open from the filesystem (<code>file://</code>), so the browser refuses to
           read <code>videos/MANIFEST.json</code> and no clips can load. Serve it over HTTP instead:
           <code>cd website &amp;&amp; ./serve.sh</code>, then open <code>http://localhost:8080/</code>.`
        : `Could not load <code>videos/MANIFEST.json</code>. ${escapeHTML(String(err))}`;
      for (const id of ["rt-pairs", "eb-pairs",
                        "rt-generalize", "eb-generalize", "trex-generalize"]) {
        const host = document.getElementById(id);
        if (host) host.innerHTML = `<p class="gallery__loading">${msg}</p>`;
      }
    });

  // The real-robot rollouts live in their own file, written by a separate step
  // than the one that writes MANIFEST.json, so they are fetched separately: a
  // missing REALWORLD.json must not blank the dream galleries, and vice versa.
  fetch(REALWORLD_URL, { cache: "no-store" })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(data => {
      for (const section of RW_SECTIONS) renderRealworld(section, data);
    })
    .catch(err => {
      console.warn("REALWORLD load failed:", err);
      const viaFile = location.protocol === "file:";
      const msg = viaFile
        ? `This page is open from the filesystem (<code>file://</code>), so the browser refuses to read
           <code>${REALWORLD_URL}</code>. Serve it over HTTP instead:
           <code>cd website &amp;&amp; ./serve.sh</code>.`
        : `<strong>Assets pending.</strong> <code>${REALWORLD_URL}</code> is not readable yet
           (${escapeHTML(String(err))}), so the real-robot rollouts for this section are not on the
           page. The clips and that index are produced by a separate encoding step.`;
      for (const section of RW_SECTIONS) rwPending(section, msg);
    });

  // ---------------------------------------------------------- shared video tile
  // One <video>, muted and looping, that only decodes while it is on screen.
  // Everything on this page that autoplays goes through here so there is a
  // single place where "is this allowed to be playing right now" is decided.
  const autoplayers = [];

  function makeTile(src, { label, badge, accent, aspect, realSrc, skeletonSrc } = {}) {
    const fig = document.createElement("figure");
    fig.className = "tile";
    if (accent) fig.style.setProperty("--tile-accent", accent);
    if (aspect) fig.style.setProperty("--tile-aspect", aspect);

    const frame = document.createElement("div");
    frame.className = "tile__frame";

    const video = document.createElement("video");
    video.src = src;
    // First-frame webp written by download_videos.py. Without it a tile is a
    // black rectangle until the mp4 has buffered, which is very visible when a
    // strip of twenty tiles comes into view at once.
    video.poster = THUMBS_BASE + src.replace(/^videos\//, "").replace(/\.mp4$/i, ".webp");
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "none";
    video.tabIndex = -1;
    video.setAttribute("aria-label", label || "world model clip");
    video.addEventListener("error", () => frame.classList.add("tile__frame--missing"));
    frame.appendChild(video);

    // Hovering a dream tile expands a panel showing the same episode three
    // ways: the simulator's own render, the skeleton that conditioned the
    // model, and the dream. Side by side rather than cross-faded in place,
    // because the claim being made is a comparison — and the skeleton is the
    // part that makes it legible, since it shows the only input was a drawing.
    //
    // The panel is built once on first hover and then reused. Building it up
    // front would put three more <video> elements per tile on the page, and
    // the strip has twelve tiles duplicated for the scroll, so that is 72
    // elements for a thing nobody may hover.
    let panel = null;
    if (realSrc || skeletonSrc) {
      const tag = document.createElement("span");
      tag.className = "tile__swap";
      tag.textContent = skeletonSrc ? "hover: compare 3" : "hover: compare";
      frame.appendChild(tag);

      const panes = [
        { src: realSrc, eyebrow: "Ground truth", role: "simulator render", kind: "gt" },
        { src: skeletonSrc, eyebrow: "Skeleton", role: "conditioning input", kind: "skel" },
        { src: src, eyebrow: "Dream", role: "generated", kind: "dream" },
      ].filter(x => x.src);

      const build = () => {
        panel = document.createElement("div");
        panel.className = "tilex";
        panel.style.setProperty("--tilex-cols", String(panes.length));
        for (const pane of panes) {
          const cell = document.createElement("figure");
          cell.className = `tilex__cell tilex__cell--${pane.kind}`;
          const v = document.createElement("video");
          v.src = pane.src;
          v.muted = true; v.loop = true; v.playsInline = true;
          v.preload = "auto"; v.tabIndex = -1;
          const head = document.createElement("figcaption");
          head.className = "tilex__cap";
          head.innerHTML = `<span class="tilex__eyebrow">${escapeHTML(pane.eyebrow)}</span>` +
                           `<span class="tilex__role">${escapeHTML(pane.role)}</span>`;
          cell.append(v, head);
          panel.appendChild(cell);
        }
        const foot = document.createElement("p");
        foot.className = "tilex__foot";
        foot.textContent = label
          ? `${label} — one episode, the same actions, rendered three ways.`
          : "One episode, the same actions, rendered three ways.";
        if (panes.length === 2) {
          foot.textContent = label
            ? `${label} — the simulator's render beside the dream of the same actions.`
            : "The simulator's render beside the dream of the same actions.";
        }
        panel.appendChild(foot);
        // Appended to <body>, not to the tile. The marquee clips with
        // overflow:hidden AND a mask-image, and its track animates with
        // transform — which makes it the containing block even for
        // position:fixed. A panel parented inside the tile is therefore
        // invisible no matter its z-index. So it is portalled out and
        // positioned from the tile's measured rect instead.
        document.body.appendChild(panel);
        return panel;
      };

      // Place the portalled panel over the tile: above it if there is room,
      // below if the tile is near the top of the viewport, and clamped
      // horizontally so a tile at either end of the strip does not open a
      // panel off screen.
      const place = () => {
        const r = frame.getBoundingClientRect();
        const pw = panel.offsetWidth || 900;
        const ph = panel.offsetHeight || 300;
        const pad = 12;
        let left = r.left + r.width / 2 - pw / 2;
        left = Math.max(pad, Math.min(left, window.innerWidth - pw - pad));
        const above = r.top - ph - 10;
        const top = above >= pad ? above : Math.min(r.bottom + 10,
                                                    window.innerHeight - ph - pad);
        panel.style.left = `${Math.round(left)}px`;
        panel.style.top = `${Math.round(top)}px`;
      };

      // One clock for all panes, so the three stay frame-aligned. Without it
      // they drift and a reader attributes the difference to the model.
      let raf = null;
      const sync = () => {
        const vs = panel ? [...panel.querySelectorAll("video")] : [];
        if (vs.length) {
          const lead = vs[0];
          for (const v of vs.slice(1)) {
            const d = v.duration || 0;
            if (d && Math.abs(v.currentTime - (lead.currentTime % d)) > 0.12) {
              try { v.currentTime = lead.currentTime % d; } catch (_e) {}
            }
          }
        }
        raf = requestAnimationFrame(sync);
      };

      // The panel is position:fixed at coordinates measured once, so it would
      // detach from its tile if the page scrolled underneath it. Reposition
      // while open, and only while open.
      let track = null;
      const follow = () => {
        place();
        track = requestAnimationFrame(follow);
      };

      const open = () => {
        if (!panel) build();
        panel.classList.add("tilex--on");
        // Two frames: one for the panel to be laid out so offsetWidth is real
        // rather than the fallback, one for any in-flight scroll to settle.
        place();
        requestAnimationFrame(() => requestAnimationFrame(place));
        if (track === null) track = requestAnimationFrame(follow);
        fig.classList.add("tile--open");
        for (const v of panel.querySelectorAll("video")) {
          try { v.currentTime = 0; } catch (_e) {}
          v.play().catch(() => {});
        }
        if (raf === null) raf = requestAnimationFrame(sync);
      };
      const close = () => {
        if (panel) panel.classList.remove("tilex--on");
        fig.classList.remove("tile--open");
        if (track !== null) { cancelAnimationFrame(track); track = null; }
        if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
        if (panel) for (const v of panel.querySelectorAll("video")) {
          try { v.pause(); } catch (_e) {}
        }
      };
      fig.addEventListener("pointerenter", open);
      fig.addEventListener("pointerleave", close);
      // keyboard parity, and Escape to dismiss
      fig.tabIndex = 0;
      fig.addEventListener("focus", open);
      fig.addEventListener("blur", close);
      fig.addEventListener("keydown", e => { if (e.key === "Escape") { close(); fig.blur(); } });
    }

    if (badge) {
      const b = document.createElement("span");
      b.className = "tile__badge";
      b.textContent = badge;
      frame.appendChild(b);
    }
    fig.appendChild(frame);

    if (label) {
      const cap = document.createElement("figcaption");
      cap.textContent = label;
      fig.appendChild(cap);
    }

    // preload="none" until the tile is near the viewport, so a page load does not
    // fire 45 video requests at once.
    fig._play = () => {
      if (video.preload === "none") video.preload = "auto";
      video.play().catch(() => {});
    };
    fig._pause = () => { try { video.pause(); } catch (_e) {} };
    autoplayers.push(fig);
    return fig;
  }

  // One observer for every autoplaying tile on the page. Tiles inside a marquee
  // scroll in and out horizontally, so this is also what keeps the number of
  // simultaneously decoding videos down to roughly a screenful.
  let tileObserver = null;
  function observeTiles() {
    if (!("IntersectionObserver" in window)) {
      autoplayers.forEach(t => t._play());
      return;
    }
    tileObserver = tileObserver || new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) e.target._play();
        else e.target._pause();
      }
    }, { rootMargin: "120px", threshold: 0.2 });
    autoplayers.forEach(t => tileObserver.observe(t));
  }

  // ---------------------------------------------------------- marquee
  // A seamless horizontal drift: the item list is rendered twice and the track
  // is translated by exactly -50%, so the second copy arrives where the first
  // began. Duration scales with item count so every strip moves at the same
  // apparent speed regardless of how many clips it holds.
  const PX_PER_SECOND = 34;

  function buildMarquee(items, { direction = "left", accent, aspect, badge } = {}) {
    const wrap = document.createElement("div");
    wrap.className = "marquee";
    wrap.setAttribute("role", "group");

    const track = document.createElement("div");
    track.className = `marquee__track marquee__track--${direction}`;

    for (const pass of [0, 1]) {
      for (const item of items) {
        const tile = makeTile(item.src, {
          label: item.label,
          badge: badge,
          accent: item.accent || accent,
          aspect,
          realSrc: item.realSrc,
          skeletonSrc: item.skeletonSrc,
        });
        // The duplicate pass is decorative: the first pass already carries the
        // caption text, so hide the copy from assistive tech.
        if (pass === 1) tile.setAttribute("aria-hidden", "true");
        track.appendChild(tile);
      }
    }

    // Estimated single-pass width; the exact value is measured once laid out.
    const setDuration = () => {
      const half = track.scrollWidth / 2;
      if (half > 0) track.style.setProperty("--marquee-duration", `${half / PX_PER_SECOND}s`);
    };
    requestAnimationFrame(setDuration);
    window.addEventListener("resize", debounce(setDuration, 250));

    wrap.appendChild(track);
    return wrap;
  }

  // ---------------------------------------------------------- trained-on / dreams-in
  // Which section each generalization row belongs to. The key is matched as a prefix
  // so "T-Rex real" lands on the T-Rex host without hard-coding the suffix.
  const GEN_HOSTS = { RoboTwin: "rt-generalize", EgoBench: "eb-generalize",
                      "T-Rex": "trex-generalize" };

  function genHostFor(embodiment) {
    const name = String(embodiment || "");
    for (const [k, id] of Object.entries(GEN_HOSTS)) {
      if (name.startsWith(k)) return document.getElementById(id);
    }
    return null;
  }

  function renderGeneralize(manifest) {
    const gen = manifest.generalize;
    const anyHost = Object.values(GEN_HOSTS)
      .map(id => document.getElementById(id)).find(Boolean);
    if (!anyHost) return;
    if (!gen || !gen.rows || !gen.rows.length) {
      anyHost.innerHTML = `<p class="gallery__loading">No <code>generalize</code> block in
        <code>MANIFEST.json</code> yet. Run
        <code>python3 download_videos.py --generalize</code>.</p>`;
      return;
    }
    for (const id of Object.values(GEN_HOSTS)) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = "";
    }

    for (const row of gen.rows) {
      const host = genHostFor(row.embodiment);
      if (!host) continue;
      const section = document.createElement("article");
      section.className = "gen-row";
      section.style.setProperty("--row-accent", row.accent || "var(--accent)");

      // No embodiment name and no robot description in this header any more: the
      // row now sits inside that embodiment's own section, whose <h2> already
      // names both. What survives is `axis`, which names the kind of shift this
      // row is about and is the one thing the section heading does not say.
      const hdr = document.createElement("header");
      hdr.className = "gen-row__hdr gen-row__hdr--bare";
      hdr.innerHTML = `
        <span class="gen-row__dot" aria-hidden="true"></span>
        ${row.axis ? `<span class="gen-row__axis">${escapeHTML(row.axis)}</span>` : ""}`;
      if (row.embodiment) section.setAttribute("aria-label",
        `${row.embodiment} generalization${row.axis ? ": " + row.axis : ""}`);
      section.appendChild(hdr);

      const body = document.createElement("div");
      body.className = "gen-row__body";

      // A labelled band per side, stacked. Giving "dreams in" the full row width
      // is the whole point of the section: a handful of recorded scenes above an
      // open-ended stream of new ones.
      const band = (side, data, extra) => {
        const el = document.createElement("div");
        el.className = `gen-band gen-band--${side}`;
        const head = document.createElement("div");
        head.className = "gen-band__head";
        head.innerHTML = `
          <p class="gen-band__eyebrow">${side === "trained" ? "Trained on" : "Dreams in"}</p>
          <p class="gen-band__label">${escapeHTML(data.label)}</p>
          ${data.note ? `<p class="gen-band__note">${escapeHTML(data.note)}</p>` : ""}`;
        el.append(head, extra);
        return el;
      };

      const seen = document.createElement("div");
      seen.className = "gen-band__clips";
      for (const c of row.trained_on.clips) {
        seen.appendChild(makeTile(VIDEOS_BASE + c.local_path, {
          label: c.label, aspect: "4 / 3", accent: "var(--anchor)",
        }));
      }

      const asItem = c => ({
        src: VIDEOS_BASE + c.local_path,
        label: c.label,
        // present only where the simulator rendered the same episode; the
        // real-hardware row has no counterpart and simply omits it
        realSrc: c.real_path ? VIDEOS_BASE + c.real_path : undefined,
        skeletonSrc: c.skeleton_path ? VIDEOS_BASE + c.skeleton_path : undefined,
      });
      const all = row.dreams_in.clips.map(asItem);
      // Two stripes once there are enough episodes to fill them. Both drift the
      // same way, so the pair reads as one wide band rather than two things
      // moving against each other. The episodes that expand to three panes are
      // front-loaded by the asset builder, so dealing alternately puts some in
      // each stripe instead of stacking them all in the first.
      const dreams = document.createElement("div");
      dreams.className = "gen-stripes";
      if (all.length >= 8) {
        const a = all.filter((_x, i) => i % 2 === 0);
        const b = all.filter((_x, i) => i % 2 === 1);
        for (const half of [a, b]) {
          dreams.appendChild(buildMarquee(half,
            { direction: "left", accent: "var(--accent)", aspect: "4 / 3" }));
        }
      } else {
        dreams.appendChild(buildMarquee(all,
          { direction: "left", accent: "var(--accent)", aspect: "4 / 3" }));
      }

      const arrow = document.createElement("div");
      arrow.className = "gen-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="3" x2="12" y2="20"/><polyline points="6 14 12 20 18 14"/></svg>`;

      body.append(band("trained", row.trained_on, seen), arrow,
                  band("dreams", row.dreams_in, dreams));
      section.appendChild(body);
      host.appendChild(section);
    }

    observeTiles();
  }

  function debounce(fn, ms) {
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ---------------------------------------------------------- lightbox
  // Only the dream-vs-real pairs open a lightbox now; it also hosts the BibTeX
  // copy button, which is why this is wired on load rather than per-section.
  let lastFocus = null;
  function wireLightbox() {
    const lb = document.getElementById("lightbox");
    if (!lb) return;
    lb.addEventListener("click", e => { if (e.target === lb) closeLightbox(); });
    $(".lightbox__close", lb).addEventListener("click", closeLightbox);
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && !lb.hidden) closeLightbox();
    });

    // bibtex copy
    const copyBtn = document.querySelector(".code__copy");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        const target = document.querySelector(copyBtn.dataset.copy);
        if (!target) return;
        try {
          await navigator.clipboard.writeText(target.textContent);
          const prev = copyBtn.textContent;
          copyBtn.textContent = "Copied";
          setTimeout(() => (copyBtn.textContent = prev), 1200);
        } catch (_err) {
          copyBtn.textContent = "Press ⌘/Ctrl+C";
          setTimeout(() => (copyBtn.textContent = "Copy"), 1600);
        }
      });
    }
  }

  function closeLightbox() {
    const lb = document.getElementById("lightbox");
    const video = document.getElementById("lb-video");
    const image = document.getElementById("lb-image");
    if (!lb) return;
    lb.hidden = true;
    document.body.style.overflow = "";
    try { video.pause(); video.removeAttribute("src"); video.load(); } catch (_e) {}
    // Both panes are reset, not just the one that was open: a stale src left on
    // the hidden one flashes the wrong content the next time it is used.
    if (image) { image.hidden = true; image.removeAttribute("src"); }
    video.hidden = false;
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  // The still-image form of the same dialog. Used for the pipeline panels,
  // which are the one thing on the page that has to be readable at full size.
  function openImageLightbox(src, title, sub, alt) {
    const lb = document.getElementById("lightbox");
    const video = document.getElementById("lb-video");
    const image = document.getElementById("lb-image");
    if (!lb || !image) return;
    lastFocus = document.activeElement;
    try { video.pause(); video.removeAttribute("src"); video.load(); } catch (_e) {}
    video.hidden = true;
    image.hidden = false;
    image.src = src;
    image.alt = alt || "";
    const h = document.getElementById("lb-title");
    const s = document.getElementById("lb-sub");
    const lg = document.getElementById("lb-legend");
    if (h) h.textContent = title || "";
    if (s) s.textContent = sub || "";
    if (lg) lg.innerHTML = "";
    lb.hidden = false;
    document.body.style.overflow = "hidden";
    const close = lb.querySelector(".lightbox__close");
    if (close) close.focus();
  }

  // ---------------------------------------------------------- dream vs real
  // Each simulator domain owns its own pair grid, inside that domain's section, so
  // there is no tab strip and no second dream-vs-real section: CMP_HOSTS is the whole
  // routing table. An embodiment with no host on the page is simply not drawn.
  const CMP_HOSTS = { RoboTwin: "rt-pairs", EgoBench: "eb-pairs" };

  function renderComparisons(manifest) {
    if (!manifest.comparisons) return;

    const groups = {};
    for (const c of manifest.comparisons) {
      const emb = c.embodiment || "Other";
      (groups[emb] = groups[emb] || []).push(c);
    }

    for (const [emb, comps] of Object.entries(groups)) {
      const host = document.getElementById(CMP_HOSTS[emb] || "");
      if (!host) continue;
      host.innerHTML = "";
      // A strip, not a grid: ten or twelve pairs laid out as a grid is five or six
      // full-width rows per domain, which buries the featured triplets above it and
      // the results below. One scrolling row keeps the pairs as the supporting
      // evidence they are. The strip is a real scroll container with a visible
      // scrollbar, so it cannot hide cards the way a clipped row would.
      const strip = document.createElement("div");
      strip.className = "cmp-strip";
      strip.id = `cmp-panel-${emb}`;
      strip.setAttribute("data-active", "true");
      strip.setAttribute("role", "group");
      strip.setAttribute("aria-label", `${emb} dream and real pairs, ${comps.length} episodes`);
      // Keyboard and screen-reader users reach the cards by tab, but a pointer user
      // with no horizontal wheel needs the container itself focusable to arrow it.
      strip.tabIndex = 0;
      for (const comp of comps) strip.appendChild(buildCompareCard(comp));
      host.appendChild(strip);
      const count = document.createElement("p");
      count.className = "cmp-strip__count";
      count.textContent = `${comps.length} episodes \u00b7 scroll sideways for more`;
      host.appendChild(count);
    }

    observeCompareCards();
  }

  function buildCompareCard(comp) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cmp";
    btn.setAttribute("aria-label", `Open ${comp.label} comparison in ${comp.sublabel}`);

    const pair = document.createElement("div");
    pair.className = "cmp__pair";

    const halves = [];
    for (const kind of ["real", "dream"]) {
      const fig = document.createElement("figure");
      fig.className = `cmp__half cmp__half--${kind}`;

      const img = document.createElement("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = `${comp.label} — ${kind} first frame`;
      img.src = comp[`${kind}_thumb`];
      fig.appendChild(img);

      const cap = document.createElement("figcaption");
      cap.textContent = kind === "real" ? "Real" : "Dream";
      fig.appendChild(cap);

      pair.appendChild(fig);
      halves.push({ kind, fig });
    }

    // lazy videos: created on first hover/focus, played in sync
    let videos = null;
    const buildVideos = () => {
      if (videos) return videos;
      videos = halves.map(({ kind, fig }) => {
        const v = document.createElement("video");
        v.src = comp[`${kind}_path`];
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        v.preload = "metadata";
        v.setAttribute("aria-hidden", "true");
        v.addEventListener("playing", () => v.classList.add("ready"));
        v.addEventListener("error", () => { try { v.remove(); } catch (_) {} });
        fig.appendChild(v);
        return v;
      });
      // whenever one plays, resync the other to the same currentTime periodically
      const [a, b] = videos;
      let syncTimer = null;
      const startSync = () => {
        if (syncTimer) return;
        syncTimer = setInterval(() => {
          if (!a || !b) return;
          if (Math.abs(a.currentTime - b.currentTime) > 0.08) b.currentTime = a.currentTime;
        }, 200);
      };
      const stopSync = () => { if (syncTimer) { clearInterval(syncTimer); syncTimer = null; } };
      a.addEventListener("play", startSync);
      a.addEventListener("pause", stopSync);
      a.addEventListener("ended", stopSync);
      return videos;
    };

    const playBoth = () => {
      const vs = buildVideos();
      if (!vs) return;
      for (const v of vs) { try { v.currentTime = 0; } catch (_) {} v.play().catch(() => {}); }
    };
    const pauseBoth = () => {
      if (!videos) return;
      for (const v of videos) { try { v.pause(); v.currentTime = 0; v.classList.remove("ready"); } catch (_) {} }
    };

    btn._play = playBoth;
    btn._pause = pauseBoth;
    btn.addEventListener("mouseenter", playBoth);
    btn.addEventListener("focus", playBoth);
    btn.addEventListener("blur", pauseBoth);

    btn.appendChild(pair);

    const meta = document.createElement("div");
    meta.className = "cmp__meta";
    const left = document.createElement("div");
    left.innerHTML = `<span class="cmp__title">${escapeHTML(comp.label)}</span>
                      <span class="cmp__sub"> &middot; ${escapeHTML(comp.sublabel)}</span>`;
    meta.appendChild(left);
    // `comp.score` is the Robometer value the clip was selected on. It stays in
    // the manifest as provenance but is deliberately not shown: a per-clip
    // number invites reading a cherry-picked example as a result.
    btn.appendChild(meta);

    // click → lightbox showing both at larger size
    btn.addEventListener("click", () => openCompareLightbox(comp));
    btn.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCompareLightbox(comp); }
    });

    return btn;
  }

  function openCompareLightbox(comp) {
    // reuse the existing lightbox DOM: replace the single <video> with a pair
    const lb = document.getElementById("lightbox");
    const title = document.getElementById("lb-title");
    const sub = document.getElementById("lb-sub");
    const vid = document.getElementById("lb-video");
    const legend = document.getElementById("lb-legend");
    if (!lb) return;

    title.textContent = comp.label;
    sub.textContent = comp.sublabel;

    // swap the single-video slot for a two-video flex row
    const old = vid.parentNode.querySelector(".lb-cmp-row");
    if (old) old.remove();
    vid.hidden = true;

    const row = document.createElement("div");
    row.className = "lb-cmp-row";
    row.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%;";
    const vs = [];
    for (const kind of ["real", "dream"]) {
      const v = document.createElement("video");
      v.src = comp[`${kind}_path`];
      v.controls = false;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = "metadata";
      v.style.cssText = "width:100%;background:#000;border-radius:8px;display:block;";
      row.appendChild(v);
      vs.push(v);
    }
    vid.parentNode.insertBefore(row, vid.nextSibling);

    legend.innerHTML = `<span class="legend--gt">Real sim</span><span class="legend--dream">Dream</span>`;

    lastFocus = document.activeElement;
    lb.hidden = false;
    document.body.style.overflow = "hidden";
    const [a, b] = vs;
    const start = async () => {
      try { a.currentTime = 0; b.currentTime = 0; await a.play(); await b.play(); } catch (_) {}
    };
    start();
    const resync = setInterval(() => {
      if (!a || !b) return;
      if (Math.abs(a.currentTime - b.currentTime) > 0.08) b.currentTime = a.currentTime;
    }, 200);
    // teardown when the lightbox closes
    const close = $(".lightbox__close", lb);
    const onClose = () => {
      clearInterval(resync);
      try { a.pause(); b.pause(); } catch (_) {}
      row.remove();
      vid.hidden = false;
      close.removeEventListener("click", onClose);
    };
    close.addEventListener("click", onClose);
    close.focus();
  }

  // The dream-vs-real tab strip is gone: the comparison pairs now live inside the
  // domain section they belong to (#rt-pairs, #eb-pairs), so there is nothing left
  // to switch between. wireCompareTabs() was removed with it.

  function observeCompareCards() {
    if (!("IntersectionObserver" in window)) {
      $$(".cmp").forEach(c => c._play && c._play());
      return;
    }
    const io = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const cmp = entry.target;
        const img = cmp.querySelector("img");
        if (entry.isIntersecting && img && img.loading === "lazy") img.loading = "eager";
        if (entry.isIntersecting) { if (cmp._play) cmp._play(); }
        else if (cmp._pause) cmp._pause();
      }
    }, { rootMargin: "100px 0px", threshold: 0.25 });
    $$(".cmp").forEach(c => io.observe(c));
  }

  // ---------------------------------------------------------- real robot: ours vs base
  // Two sections over the two arrays of REALWORLD.json. They differ in what the
  // two policies were trained on and in how many clips a side carries:
  //   "pair"   — comparison rows hold one `ours` and one `base` object, shown
  //              side by side so the two executions of a task line up.
  //   "picker" — robustness rows hold `ours_clips` / `base_clips` arrays of any
  //              length. One clip per side is on screen at a time and a single
  //              shuffle re-rolls them. It re-rolls them *separately*, because
  //              the clips are independent trials: no index on one side
  //              "matches" an index on the other, so nothing here ever moves
  //              the two sides together. The section prose says so too, which
  //              is the only place a reader can learn it, since this mode does
  //              not print clip ids.
  // Both modes paint the same `.rw-pair` of `.rw-side` panels through
  // buildRealworldSide(), which takes an explicit clip object so the two
  // sections cannot drift apart.
  // Every label, caption and outcome comes from that file; nothing about a
  // result is written here or in the HTML.
  const RW_SECTIONS = [
    {
      host: "real-exec",
      key: "comparison",
      idKey: "task",
      noun: "task",
      mode: "pair",
      ours: "ACT · 5 real demos + 40 dream demos",
      base: "ACT · the same 5 real demos only",
    },
    {
      host: "real-ood",
      key: "robustness",
      idKey: "variant",
      noun: "condition",
      mode: "picker",
      ours: "ACT · 5 real demos + dreams incl. OOD scenes",
      base: "ACT · the same 5 real demos only",
    },
  ];

  // The three outcomes the index can carry. "unclear" is a verdict of its own,
  // not a soft success: it keeps its own neutral badge. Anything else (absent,
  // misspelled, a value added later) falls through to "unknown" rather than
  // being guessed at.
  const RW_OUTCOMES = {
    success: { label: "Success", cls: "success" },
    failure: { label: "Failure", cls: "failure" },
    unclear: { label: "Unclear", cls: "unclear" },
  };
  const RW_OUTCOME_UNKNOWN = { label: "Outcome not recorded", cls: "unknown" };

  const RW_SIDE_NAME = { ours: "Ours", base: "Base" };

  const RW_ICON = {
    pause: `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"><line x1="9" y1="4" x2="9" y2="20"/>
      <line x1="15" y1="4" x2="15" y2="20"/></svg>`,
    play: `<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <polygon points="6 4 20 12 6 20 6 4"/></svg>`,
    restart: `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"><polyline points="2 4 2 10 8 10"/>
      <path d="M4.2 14.5a8 8 0 1 0 1.9-8.6L2 10"/></svg>`,
    shuffle: `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/>
      <polyline points="21 16 21 21 16 21"/><line x1="4" y1="20" x2="21" y2="3"/>
      <line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>`,
  };

  // Rows autoplay, so honour the same preference the marquees do: start paused
  // and let the row's own play button opt in.
  const RW_REDUCED = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function rwPending(section, html) {
    const host = document.getElementById(section.host);
    if (host) host.innerHTML = `<p class="gallery__loading">${html}</p>`;
  }

  function renderRealworld(section, data) {
    const host = document.getElementById(section.host);
    if (!host) return;
    const rows = data && Array.isArray(data[section.key]) ? data[section.key].filter(Boolean) : null;
    if (!rows || !rows.length) {
      rwPending(section, `<strong>Assets pending.</strong> <code>${REALWORLD_URL}</code> carries no
        <code>${section.key}</code> rows yet, so there is nothing to show for this ${section.noun}.`);
      return;
    }
    host.innerHTML = "";
    for (const row of rows) host.appendChild(buildRealworldRow(section, row));
    observeRealworldRows(host);
  }

  function buildRealworldRow(section, row) {
    const slug = String(row[section.idKey] || row.label || section.key)
      .replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || section.key;
    const name = row.label || slug;
    const titleId = `rw-${section.key}-${slug}`;

    const art = document.createElement("article");
    art.className = "rw-row";
    art.setAttribute("aria-labelledby", titleId);

    // ---- header: label, caption, row controls
    const hdr = document.createElement("header");
    hdr.className = "rw-row__hdr";
    const text = document.createElement("div");
    text.className = "rw-row__text";
    text.innerHTML = `<h3 class="rw-row__title" id="${titleId}">${escapeHTML(name)}</h3>
      ${row.caption ? `<p class="rw-row__caption">${escapeHTML(row.caption)}</p>` : ""}`;
    hdr.appendChild(text);

    const videos = [];
    let paused = RW_REDUCED;

    const toggle = rwControl(RW_ICON.pause);
    const restart = rwControl(RW_ICON.restart, `Restart every clip in the ${name} row`);

    // `silent` only repaints the control: at build time the row is not in the
    // document yet and playback is the intersection observer's job, so starting
    // it here would fetch every clip on the page at once.
    const applyPaused = ({ silent = false } = {}) => {
      art.dataset.paused = paused ? "true" : "false";
      toggle.innerHTML = paused ? RW_ICON.play : RW_ICON.pause;
      toggle.setAttribute("aria-label",
        `${paused ? "Play" : "Pause"} every clip in the ${name} row`);
      if (silent) return;
      if (paused) videos.forEach(v => { try { v.pause(); } catch (_e) {} });
      else videos.forEach(v => v.play().catch(() => {}));
    };
    toggle.addEventListener("click", () => { paused = !paused; applyPaused(); });
    restart.addEventListener("click", () => {
      videos.forEach(v => { try { v.currentTime = 0; } catch (_e) {} });
      paused = false;
      applyPaused();
    });

    const ctrls = document.createElement("div");
    ctrls.className = "rw-row__ctrls";
    ctrls.append(toggle, restart);
    hdr.appendChild(ctrls);
    art.appendChild(hdr);

    // ---- the clips: ours before base in both modes, so the reader always finds
    // the dream-trained policy in the same place.
    //
    // `videos` is captured by the three closures above, so it is the one array
    // the row's controls will ever look at. "picker" mode swaps clips after the
    // row is built, and it does that by splicing this same array in place — see
    // buildRealworldPicker(). Handing it a replacement array would leave
    // pause / play / restart driving detached elements.
    if (section.mode === "picker") {
      art.appendChild(buildRealworldPicker(section, row, name, videos, () => paused));
    } else {
      const pair = document.createElement("div");
      pair.className = "rw-pair";
      for (const side of ["ours", "base"]) {
        pair.appendChild(buildRealworldSide(section, side, (row && row[side]) || {}, name, videos));
      }
      art.appendChild(pair);
    }

    // The intersection observer drives playback, but a row the reader paused by
    // hand stays paused when it scrolls back into view.
    art._play = () => { if (!paused) videos.forEach(v => v.play().catch(() => {})); };
    art._pause = () => videos.forEach(v => { try { v.pause(); } catch (_e) {} });
    applyPaused({ silent: true });
    return art;
  }

  // One panel for one clip. The clip is passed in rather than read off the row,
  // so the comparison rows (which hold a single object per side) and the
  // robustness picker (which holds an array and swaps within it) share this
  // one code path.
  // `opts.note` opts in to the clip's `note` line. The comparison rows leave it
  // off and keep the look they have always had; the picker turns it on, because
  // there the note is the only place a caveat such as "transfer not assessable"
  // can appear next to the outcome badge.
  // `opts.hideClipId` drops the clip id from the visible provenance line only.
  // The id still reaches the page: it is on the panel as `data-clip`, and the
  // clip's filename is on the <video>, so which take is on screen is always
  // recoverable by inspecting the element.
  function buildRealworldSide(section, side, clip, name, videos, opts) {
    clip = clip || {};

    const fig = document.createElement("figure");
    fig.className = `rw-side rw-side--${side}`;
    if (clip.clip) fig.dataset.clip = String(clip.clip);

    const head = document.createElement("div");
    head.className = "rw-side__head";
    head.innerHTML = `<span class="rw-side__eyebrow">${RW_SIDE_NAME[side]}</span>
      <span class="rw-side__policy">${escapeHTML(section[side])}</span>`;
    head.appendChild(rwBadge(rwOutcome(clip)));
    fig.appendChild(head);

    fig.appendChild(rwFrame(section, side, clip, name, videos));
    fig.appendChild(rwMeta(clip, "rw-side__meta", opts));
    if (opts && opts.note && clip.note) {
      const note = document.createElement("p");
      note.className = "rw-side__note";
      note.textContent = clip.note;
      fig.appendChild(note);
    }
    return fig;
  }

  // `ours_clips` / `base_clips` of any length, shown one clip per side at a
  // time with a single shuffle over both. Returns a fragment of [control strip,
  // pair] so the pair itself is the same `.rw-pair` the comparison rows build.
  //
  // The two sides are tracked and redrawn separately on purpose. A side-by-side
  // pair invites the reading that the left clip and the right clip are the same
  // trial under two policies; they are not, they are independent rollouts. So
  // one click draws two independent indices, and nothing here ever ties one
  // side's index to the other's. Neither side shows a clip id or a position in
  // its list, so the prose in index.html is what tells a reader the pairing is
  // arbitrary — see the #robustness kicker.
  //
  // `isPaused` is the row's own pause flag, read (not copied) so a clip swapped
  // in while the row is paused does not start playing.
  function buildRealworldPicker(section, row, name, videos, isPaused) {
    const sides = ["ours", "base"];
    const clips = { ours: rwClipList(row, "ours"), base: rwClipList(row, "base") };
    const at = { ours: 0, base: 0 };
    const mounted = {};  // the <figure> currently on screen, per side
    const owned = { ours: [], base: [] };  // that figure's <video>s, per side

    const strip = document.createElement("div");
    strip.className = "picker";

    const pair = document.createElement("div");
    pair.className = "rw-pair";

    // Swap one side. `videos` is the row's array and is mutated in place: the
    // outgoing <video> is spliced out of it and the incoming one pushed in, so
    // the row's pause / play / restart buttons keep acting on exactly the two
    // clips the reader can see.
    const show = (side, { silent = false } = {}) => {
      for (const v of owned[side]) {
        const i = videos.indexOf(v);
        if (i >= 0) videos.splice(i, 1);
        try { v.pause(); } catch (_e) {}
      }
      const added = [];
      const fig = buildRealworldSide(section, side, clips[side][at[side]], name, added,
        { note: true, hideClipId: true });
      owned[side] = added;
      for (const v of added) videos.push(v);

      if (mounted[side]) pair.replaceChild(fig, mounted[side]);
      else pair.appendChild(fig);  // first paint: ours then base, in call order
      mounted[side] = fig;

      // `silent` on the first paint only: the row is not in the document yet
      // and playback is the intersection observer's job, so starting it here
      // would fetch a clip for a row nobody has scrolled to.
      if (!silent) {
        if (isPaused()) added.forEach(v => { try { v.pause(); } catch (_e) {} });
        else added.forEach(v => v.play().catch(() => {}));
      }
    };

    const shuffle = document.createElement("button");
    shuffle.type = "button";
    shuffle.className = "picker__btn";
    // Icon plus a text label, so the control is never carried by the icon or by
    // colour alone; the icon itself is hidden from the accessibility tree.
    shuffle.innerHTML = `${RW_ICON.shuffle}<span>Shuffle</span>`;
    shuffle.setAttribute("aria-label",
      `Shuffle: draw a new rollout for each policy in the ${name} scene`);
    // A fresh index per side, drawn independently, and never the index already
    // showing: a shuffle that appears to do nothing reads as a broken button.
    shuffle.addEventListener("click", () => {
      for (const side of sides) {
        const next = rwPickOther(clips[side].length, at[side]);
        if (next === at[side]) continue;  // only reachable with 0 or 1 clip
        at[side] = next;
        show(side);
      }
    });
    // Nothing to re-draw on either side, so say so rather than offering a
    // button that cannot change anything.
    if (sides.every(side => clips[side].length < 2)) shuffle.disabled = true;
    strip.appendChild(shuffle);

    for (const side of sides) show(side, { silent: true });

    // With the clip ids and the trial counter hidden, nothing beside the videos
    // would tell a reader that the two sides are unrelated rollouts drawn at
    // random. The kicker says so, but a reader can scroll past it and land on
    // what looks like a matched A/B pair, so repeat it once under the pair.
    const foot = document.createElement("p");
    foot.className = "rw-pair__note";
    foot.textContent = sides.every(side => clips[side].length < 2)
      ? "One rollout per policy. The two are independent trials, not a matched pair."
      : "Two independent trials, drawn at random. The pairing on screen is arbitrary.";

    const frag = document.createDocumentFragment();
    frag.append(strip, pair, foot);
    return frag;
  }

  // Draw one of the n-1 indices that are not `current`, by picking among them
  // and then stepping over `current`. No retry loop, so it cannot spin, and it
  // can never return `current` unless there is nothing else to return.
  // Sections that shuffle hide the clip id everywhere a reader can see it: the
  // provenance line, the frame's aria-label and the lightbox subtitle. The id
  // stays in the index and on the panel as `data-clip`, so which take is on
  // screen is always recoverable by inspecting the element.
  function rwHidesClipId(section) {
    return !!section && section.mode === "picker";
  }

  function rwPickOther(n, current) {
    if (n < 2) return current;
    const i = Math.floor(Math.random() * (n - 1));
    return i < current ? i : i + 1;
  }

  // Accepts either shape for a side: the `*_clips` array the robustness rows
  // carry, or the single object the comparison rows carry, so a row written in
  // the other shape than its section expects still renders.
  function rwClipList(row, side) {
    const arr = row && row[`${side}_clips`];
    if (Array.isArray(arr)) return arr.filter(c => c && typeof c === "object");
    const one = row && row[side];
    return one && typeof one === "object" ? [one] : [];
  }

  function rwOutcome(clip) {
    return RW_OUTCOMES[String((clip && clip.outcome) || "").toLowerCase()] || RW_OUTCOME_UNKNOWN;
  }

  function rwBadge(outcome) {
    const el = document.createElement("span");
    el.className = `rw-badge rw-badge--${outcome.cls}`;
    el.innerHTML = `<span class="rw-badge__dot" aria-hidden="true"></span>${escapeHTML(outcome.label)}`;
    return el;
  }

  // Provenance line: clip id and duration, straight from the index. Readable
  // with video blocked, which is the point.
  // `opts.hideClipId` leaves the id out of the text; see buildRealworldSide for
  // where it still lives on the page.
  function rwMeta(clip, cls, opts) {
    const bits = [];
    if (clip.clip && !(opts && opts.hideClipId)) bits.push(`clip ${clip.clip}`);
    if (typeof clip.duration_s === "number" && isFinite(clip.duration_s)) {
      bits.push(`${clip.duration_s.toFixed(1)} s`);
    }
    if (!clip.src) bits.push("clip pending");
    const el = document.createElement(cls === "rw-side__meta" ? "figcaption" : "span");
    el.className = cls;
    el.textContent = bits.join(" · ");
    return el;
  }

  // A clip that has not been encoded yet degrades to a labelled placeholder with
  // no <video> and nothing to click, rather than a broken player.
  function rwFrame(section, side, clip, name, videos) {
    const clickable = !!(clip && clip.src);
    const frame = document.createElement(clickable ? "button" : "div");
    frame.className = "rw-frame";
    if (!clickable) {
      frame.classList.add("rw-frame--missing");
      return frame;
    }
    frame.type = "button";
    frame.setAttribute("aria-label",
      `Enlarge the ${side === "ours" ? "ours" : "baseline"} rollout for ${name}` +
      (clip.clip && !rwHidesClipId(section) ? `, clip ${clip.clip}` : ""));

    const v = document.createElement("video");
    v.src = clip.src;
    // Attributes as well as properties: the contract for these clips is muted,
    // looping, inline, and metadata-only until they are needed.
    v.muted = true;
    for (const [k, val] of [["muted", ""], ["loop", ""], ["playsinline", ""], ["preload", "metadata"]]) {
      v.setAttribute(k, val);
    }
    v.loop = true;
    v.playsInline = true;
    v.preload = "metadata";
    // The caption and badge carry the meaning; the player itself has no
    // controls, so keep it out of the accessibility tree like .cmp does.
    v.setAttribute("aria-hidden", "true");
    v.addEventListener("error", () => frame.classList.add("rw-frame--missing"));
    // Encoded size, when the index records it, so a clip that is not 16:9 is
    // not cropped. Missing or zero values keep the default aspect.
    if (clip.width > 0 && clip.height > 0) {
      frame.style.setProperty("--rw-aspect", `${clip.width} / ${clip.height}`);
    }
    frame.appendChild(v);
    videos.push(v);
    frame.addEventListener("click", () => openRealworldLightbox(section, side, clip, name));
    return frame;
  }

  function openRealworldLightbox(section, side, clip, name) {
    const lb = document.getElementById("lightbox");
    const title = document.getElementById("lb-title");
    const sub = document.getElementById("lb-sub");
    const vid = document.getElementById("lb-video");
    const legend = document.getElementById("lb-legend");
    if (!lb || !vid) return;
    const outcome = rwOutcome(clip);

    // openCompareLightbox() parks a two-video row beside #lb-video and hides the
    // single slot, and only un-hides it again on its own close button. Undo that
    // here so a pair dismissed with Escape does not linger behind this clip.
    const stale = vid.parentNode.querySelector(".lb-cmp-row");
    if (stale) stale.remove();
    vid.hidden = false;

    title.textContent = `${name} — ${RW_SIDE_NAME[side]}`;
    sub.textContent = [section[side], clip.clip && !rwHidesClipId(section) ? `clip ${clip.clip}` : ""]
      .filter(Boolean).join(" · ");
    legend.innerHTML = `<span class="legend--${side}">${escapeHTML(outcome.label)}</span>`;

    vid.src = clip.src;
    vid.muted = true;
    vid.loop = true;

    lastFocus = document.activeElement;
    lb.hidden = false;
    document.body.style.overflow = "hidden";
    vid.play().catch(() => {});
    $(".lightbox__close", lb).focus();
  }

  function rwControl(icon, label) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rw-ctrl";
    b.innerHTML = icon;
    if (label) b.setAttribute("aria-label", label);
    return b;
  }

  function observeRealworldRows(host) {
    const rows = $$(".rw-row", host);
    if (!("IntersectionObserver" in window)) {
      rows.forEach(r => r._play && r._play());
      return;
    }
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        const row = e.target;
        if (e.isIntersecting) { if (row._play) row._play(); }
        else if (row._pause) row._pause();
      }
    }, { rootMargin: "100px 0px", threshold: 0.2 });
    rows.forEach(r => io.observe(r));
  }

  // ---------------------------------------------------------- method steps
  // Shows exactly one pipeline panel, the one belonging to the step being read,
  // and keeps the a/b/c rail and the caption in step with it.
  //
  // "Being read" is the step closest to a line a third of the way down the
  // viewport. Chosen over an IntersectionObserver's isIntersecting because with
  // three tall steps two of them are on screen most of the time, and "every
  // intersecting step is active" is the same as none of them being active.
  wireMethodSteps();

  function wireMethodSteps() {
    const fig = document.getElementById("method-fw");
    const steps = $$(".method-steps .step");
    if (!fig || !steps.length) return;

    const panels = new Map($$(".fw-panel", fig).map(e => [e.dataset.step, e]));
    const marks = new Map($$(".fw-mark--btn", fig).map(e => [e.dataset.step, e]));
    const labels = new Map($$(".fw-stage__label", fig).map(e => [e.dataset.for, e]));
    const zoom = fig.querySelector(".fw-zoom");

    let active = null;
    const show = key => {
      if (!key || key === active) return;
      active = key;
      for (const [k, el] of panels) el.classList.toggle("is-on", k === key);
      for (const [k, el] of marks) el.setAttribute("aria-current", String(k === key));
      for (const [k, el] of labels) el.classList.toggle("is-on", k === key);
    };

    // A rail button scrolls to its step; the scroll handler then switches the
    // panel. Driving the panel from one place only means the rail can never end
    // up showing a different stage than the page is scrolled to.
    for (const [key, btn] of marks) {
      btn.addEventListener("click", () => {
        const target = document.getElementById(`step-${key}`);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }

    const openFull = () => {
      const panel = panels.get(active);
      if (!panel) return;
      openImageLightbox(panel.src, `Pipeline, stage (${active})`,
        "The full figure is under “Show the full pipeline figure”.", panel.alt);
    };
    if (zoom) zoom.addEventListener("click", openFull);
    for (const panel of panels.values()) panel.addEventListener("click", openFull);

    const pick = () => {
      const line = window.innerHeight / 3;
      let best = null, bestD = Infinity;
      for (const s of steps) {
        const r = s.getBoundingClientRect();
        // distance from the reading line to the step's span; zero while inside
        const d = r.top > line ? r.top - line : r.bottom < line ? line - r.bottom : 0;
        if (d < bestD) { bestD = d; best = s; }
      }
      show(best && best.dataset.step);
    };

    // rAF-throttled: scroll fires far more often than the screen repaints.
    let queued = false;
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; pick(); });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    pick();
  }

  // ---------------------------------------------------------- domain rail
  // Marks whichever of a section's questions is in view. Same reading-line rule
  // as the method steps: the subhead closest to a line a third down the
  // viewport, which keeps exactly one chip current even when two of the blocks
  // it indexes are both on screen.
  wireDomRails();

  function wireDomRails() {
    const rails = $$(".domrail");
    if (!rails.length) return;

    // One (rail, [{link, target}]) entry each. Built from the links' own hrefs,
    // so the rail's markup is the only place the mapping lives.
    const groups = rails.map(rail => ({
      // The rail's own section, so a rail can be cleared once its section is
      // off screen. Without this the last chip of every section you have
      // scrolled past stays aria-current, which is wrong for a screen reader
      // even though the rail itself has scrolled out of sight.
      section: rail.closest("section"),
      links: $$("a", rail).map(a => ({
        a,
        target: document.getElementById(a.getAttribute("href").slice(1)),
      })).filter(e => e.target),
      active: null,
    })).filter(g => g.links.length);
    if (!groups.length) return;

    const pick = () => {
      const line = window.innerHeight / 3;
      for (const g of groups) {
        let best = null, bestD = Infinity;
        const sec = g.section && g.section.getBoundingClientRect();
        const offscreen = sec && (sec.bottom < 0 || sec.top > window.innerHeight);
        if (offscreen) {
          if (g.active !== null) {
            g.active = null;
            for (const e of g.links) e.a.setAttribute("aria-current", "false");
          }
          continue;
        }
        for (const e of g.links) {
          // Measured to the NEXT subhead, so a chip stays current for the whole
          // block it heads rather than only while its own heading is on screen.
          const top = e.target.getBoundingClientRect().top;
          const d = top <= line ? line - top : Infinity;
          if (d < bestD) { bestD = d; best = e; }
        }
        // Above the first subhead nothing is current, which is correct: the
        // reader is still in the section's intro.
        const want = bestD === Infinity ? null : best;
        if (want === g.active) continue;
        g.active = want;
        for (const e of g.links) e.a.setAttribute("aria-current", String(e === want));
      }
    };

    let queued = false;
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; pick(); });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    pick();
  }

  // ---------------------------------------------------------- scroll reveal
  // Blocks fade and rise as they come into view. Purely decorative, so it is
  // opt-in per element (.reveal in the HTML) and it is applied by ADDING a
  // class rather than by hiding things in CSS and un-hiding them here: if this
  // never runs, or the visitor asked for reduced motion, every element stays
  // visible because the CSS only hides .reveal once .js-reveal is on <html>.
  wireReveal();

  function wireReveal() {
    const reduced = window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const targets = $$(".reveal");
    if (!targets.length) return;
    if (reduced || !("IntersectionObserver" in window)) return;

    document.documentElement.classList.add("js-reveal");
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("is-in");
        io.unobserve(e.target);       // one way only; nothing re-hides on scroll up
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    targets.forEach(el => io.observe(el));
  }

  // ---------------------------------------------------------- hero
  // Three small behaviours, all of them degradable: if any of this does not run
  // the hero still shows its poster, the nav links still work, and nothing is
  // unreachable.
  //
  //  1. the background video is attached only when the hero is on screen and
  //     only if the visitor has not asked for reduced motion. Until then the
  //     poster carries the hero and the 2 MB loop is never fetched.
  //  2. #topnav slides in once the hero has scrolled past, so the sticky bar is
  //     never on top of the title.
  //  3. a pause button, which only appears once there is something to pause.
  wireHero();

  function wireHero() {
    const hero = document.getElementById("top");
    const vid = document.getElementById("hero-video");
    const topnav = document.getElementById("topnav");
    const toggle = hero && hero.querySelector(".hero__toggle");

    // ---- 2: the sticky bar ----
    if (hero && topnav) {
      if ("IntersectionObserver" in window) {
        // The sentinel is the hero itself: the bar comes on when less than a
        // tenth of the hero is still visible.
        new IntersectionObserver(([e]) => {
          topnav.classList.toggle("is-on", !e.isIntersecting);
        }, { threshold: 0.08 }).observe(hero);
      } else {
        topnav.classList.add("is-on");
      }
    }

    if (!vid || !vid.dataset.src) return;

    // Declared before the observers below, which read it.
    let userPaused = false;

    // ---- 1: attach and play the loop ----
    const reduced = window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;          // the poster is the hero; never fetch the loop

    let attached = false;
    const attach = () => {
      if (attached) return;
      attached = true;
      vid.src = vid.dataset.src;
      vid.load();
      // Fading in on `playing` rather than on `canplay` means the poster is
      // never replaced by a still first frame of the same video.
      vid.addEventListener("playing", () => {
        vid.classList.add("is-on");
        if (toggle) toggle.hidden = false;
      }, { once: true });
      const go = vid.play();
      // A blocked autoplay is not an error worth surfacing: the poster stays.
      if (go && go.catch) go.catch(() => {});
    };

    const resume = () => {
      if (!attached || userPaused) return;
      const g = vid.play();
      if (g && g.catch) g.catch(() => {});
    };

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([e]) => {
        if (e.isIntersecting) { attach(); resume(); }
        // Off screen: stop decoding frames. A looping 1080p video left running
        // under the rest of the page costs as much as every clip below it.
        else if (attached) vid.pause();
      }, { threshold: 0.05 }).observe(hero);
    } else {
      attach();
    }

    // ---- 3: the pause button ----
    if (toggle) {
      toggle.addEventListener("click", () => {
        userPaused = !userPaused;
        toggle.dataset.paused = String(userPaused);
        toggle.setAttribute("aria-label",
          userPaused ? "Play background video" : "Pause background video");
        if (userPaused) vid.pause();
        else { const g = vid.play(); if (g && g.catch) g.catch(() => {}); }
      });
    }
  }

  // ---------------------------------------------------------- utils
  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
