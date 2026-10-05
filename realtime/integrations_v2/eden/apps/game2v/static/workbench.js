// SPDX-License-Identifier: Apache-2.0
/**
 * Workbench home screen for the Game2V page.
 *
 * The page opens on a home screen: make a game on the left, or pick one from
 * the cover gallery on the right. Rendering starts only after a game is
 * chosen, and the three-pane play layout underneath (the server's own page)
 * stays hidden until the first frame of that game arrives. When a round ends,
 * a bar along the top offers "play again" or a return to the home screen.
 *
 * Talks to /ext/workbench/ (bridge proxy + FLUX worker) and /ext/game2v/.
 * Game frames are observed through the "game2v-ui" event app.js dispatches for
 * every game_ui envelope, since that envelope otherwise stays inside app.js.
 */
const API = "/ext/workbench";
const STORE = "eden-workbench";
const OPEN_STATES = new Set(["", "RUNNING", "READY"]);
const LOAD_TIMEOUT_MS = 90_000;

const css = `
body.wb-home .layout{visibility:hidden}
body.wb-home #status{display:none}
.wb-home-screen{position:fixed;inset:0;z-index:60;background:#0d0f13;color:#ddd;display:flex;flex-direction:column;font:14px system-ui,sans-serif;overflow:hidden}
.wb-home-screen[hidden],.wb-loading[hidden],.wb-endbar[hidden],.wb-homebtn[hidden]{display:none}
.wb-home-head{display:flex;align-items:baseline;gap:.8rem;padding:.9rem 1.4rem;border-bottom:1px solid #26292f}
.wb-home-head h1{margin:0;font:600 1.15rem system-ui,sans-serif;letter-spacing:.01em}
.wb-home-head span{color:#8b93a1;font-size:.85rem}
.wb-home-body{flex:1;display:grid;grid-template-columns:minmax(20rem,28rem) 1fr;min-height:0}
.wb-make{border-right:1px solid #26292f;padding:1.1rem 1.3rem;overflow-y:auto;display:flex;flex-direction:column;gap:.7rem}
.wb-make h2,.wb-gallery h2{margin:0;font:600 .75rem system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#8b93a1}
.wb-make textarea,.wb-make input,.wb-make button{background:#111;color:#eee;border:1px solid #3a3f48;border-radius:.35rem;padding:.45rem .6rem;font:inherit}
.wb-make textarea{width:100%;box-sizing:border-box;resize:vertical}
.wb-make input{flex:1 1 8rem;min-width:0}
.wb-make button{cursor:pointer}
.wb-make button.primary{background:#1d4ed8;border-color:#1d4ed8;color:#fff}
.wb-make button:disabled{opacity:.5;cursor:default}
.wb-row{display:flex;gap:.4rem;align-items:center;flex-wrap:wrap}
.wb-log{background:#000;border:1px solid #222;border-radius:.3rem;max-height:10rem;overflow-y:auto;font:11px ui-monospace,monospace;white-space:pre-wrap;padding:.4rem;color:#9a9}
.wb-status{min-height:1.2em;color:#9ab;font-size:.85rem}
.wb-status.error{color:#f88}
.wb-images{display:grid;grid-template-columns:1fr 1fr;gap:.4rem}
.wb-images figure{margin:0;display:flex;flex-direction:column;gap:.2rem}
.wb-images img{width:100%;aspect-ratio:16/9;object-fit:cover;background:#000;border:1px solid #333;border-radius:.3rem;color:transparent}
.wb-images img:not([src]),.wb-images img[src=""]{visibility:hidden}
.wb-images figcaption{color:#888;font-size:11px}
.wb-thumbs{display:flex;gap:.3rem;flex-wrap:wrap}
.wb-thumbs img{width:5.5rem;aspect-ratio:16/9;object-fit:cover;border:2px solid transparent;border-radius:.25rem;cursor:pointer}
.wb-thumbs img.selected{border-color:#3b82f6}
.wb-preview{height:12rem;border:1px solid #333;border-radius:.4rem;background:#000}
.wb-preview iframe{width:100%;height:100%;border:0}
.wb-gallery{padding:1.1rem 1.3rem;overflow-y:auto;display:flex;flex-direction:column;gap:.8rem}
.wb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));gap:.8rem}
.wb-card{background:#15181e;border:1px solid #2a2e36;border-radius:.5rem;overflow:hidden;cursor:pointer;text-align:left;padding:0;color:inherit;font:inherit;display:flex;flex-direction:column}
.wb-card:hover,.wb-card:focus-visible{border-color:#3b82f6;outline:none}
.wb-card img{width:100%;aspect-ratio:16/9;object-fit:cover;background:#000}
.wb-card .wb-meta{padding:.5rem .65rem .65rem;display:flex;flex-direction:column;gap:.25rem}
.wb-card .wb-meta strong{font-weight:600}
.wb-card .wb-meta small{color:#8b93a1;font-size:.78rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.wb-badge{align-self:flex-start;background:#1e3a8a;color:#dbe4ff;border-radius:999px;padding:.05rem .45rem;font-size:.68rem;letter-spacing:.04em}
.wb-loading{position:fixed;inset:0;z-index:60;background:#0d0f13;color:#ddd;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;font:14px system-ui,sans-serif;text-align:center;padding:2rem}
.wb-loading img{width:min(48rem,90vw);aspect-ratio:16/9;object-fit:cover;border-radius:.6rem;background:#000}
.wb-loading h2{margin:0;font:600 1.3rem system-ui,sans-serif}
.wb-loading button{background:#111;color:#eee;border:1px solid #3a3f48;border-radius:.35rem;padding:.45rem .8rem;font:inherit;cursor:pointer}
.wb-homebtn{position:fixed;top:.75rem;right:.75rem;z-index:45;background:#111d;color:#eee;border:1px solid #3a3f48;border-radius:.4rem;padding:.4rem .75rem;font:600 13px system-ui,sans-serif;cursor:pointer}
.wb-endbar{position:fixed;top:0;left:0;right:0;z-index:46;background:#0d0f13f2;color:#eee;border-bottom:1px solid #333;display:flex;align-items:center;justify-content:center;gap:.8rem;padding:.6rem 1rem;font:14px system-ui,sans-serif}
.wb-endbar strong{font-weight:600}
.wb-endbar button{background:#111;color:#eee;border:1px solid #3a3f48;border-radius:.35rem;padding:.4rem .75rem;font:inherit;cursor:pointer}
.wb-endbar button.primary{background:#1d4ed8;border-color:#1d4ed8;color:#fff}
@media (max-width: 820px){.wb-home-body{grid-template-columns:1fr;overflow-y:auto}.wb-make{border-right:0;border-bottom:1px solid #26292f}}
`;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "className") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value != null && value !== false) node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...children);
  return node;
}

async function call(path, body) {
  const options = body === undefined ? {} : {
    method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body),
  };
  const response = await fetch(path, {cache: "no-store", ...options});
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || response.statusText || `HTTP ${response.status}`);
  return payload;
}

function load() {
  try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { return {}; }
}
function save(state) {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* storage blocked */ }
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 4).join("-") || "my-game";
}

function mount() {
  if (document.querySelector(".wb-home-screen")) return;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);

  const state = load();
  let games = [];
  let view = "home";
  let target = null;
  let loadTimer = null;
  let polling = null;
  let selected = null;

  // ---- home: left column, make a game ----
  const prompt = el("textarea", {rows: 4, placeholder: "Describe the game, e.g. a 3D lane runner through a neon city where the player dodges cars and collects batteries."});
  prompt.value = state.prompt || "";
  const slug = el("input", {placeholder: "slug, e.g. neon-runner", "aria-label": "Game slug"});
  slug.value = state.slug || "";
  prompt.addEventListener("change", () => { if (!slug.value) slug.value = slugify(prompt.value); });
  const status1 = el("div", {className: "wb-status", role: "status"});
  const log = el("div", {className: "wb-log", hidden: true, "aria-live": "off"});
  const generate = el("button", {className: "primary", type: "button"}, "Generate game");
  const cancel = el("button", {type: "button", hidden: true}, "Cancel");

  const coarseImg = el("img", {alt: "Greybox first frame"});
  const fineImg = el("img", {alt: "Rendered fine first frame"});
  const caption = el("textarea", {rows: 4, placeholder: "Caption (written from the greybox frame; you can edit it)"});
  const seed = el("input", {type: "number", value: "12345", "aria-label": "Seed", style: "flex:0 0 7rem"});
  const thumbs = el("div", {className: "wb-thumbs"});
  const status2 = el("div", {className: "wb-status", role: "status"});
  const captionBtn = el("button", {type: "button"}, "Write caption");
  const renderBtn = el("button", {type: "button"}, "Render");
  const acceptBtn = el("button", {className: "primary", type: "button", disabled: true}, "Use as first frame");
  const frameBox = el("div", {hidden: true},
    el("div", {className: "wb-images"},
      el("figure", {}, coarseImg, el("figcaption", {}, "Greybox (coarse)")),
      el("figure", {}, fineImg, el("figcaption", {}, "Fine (selected)"))),
    caption,
    el("div", {className: "wb-row"}, captionBtn, el("label", {}, "seed "), seed, renderBtn),
    thumbs,
    el("div", {className: "wb-row"}, acceptBtn),
    status2);
  const preview = el("div", {className: "wb-preview", hidden: true});
  const playNew = el("button", {className: "primary", type: "button", hidden: true}, "Play this game");

  const make = el("section", {className: "wb-make"},
    el("h2", {}, "Make a new game"),
    prompt,
    el("div", {className: "wb-row"}, slug, generate, cancel),
    status1, log, frameBox, preview,
    el("div", {className: "wb-row"}, playNew));

  // ---- home: right column, gallery ----
  const grid = el("div", {className: "wb-grid"});
  const gallery = el("section", {className: "wb-gallery"}, el("h2", {}, "Games"), grid);

  const home = el("div", {className: "wb-home-screen", hidden: true},
    el("header", {className: "wb-home-head"},
      el("h1", {}, "Game2V workbench"),
      el("span", {}, "Make a game, or pick one to start rendering.")),
    el("div", {className: "wb-home-body"}, make, gallery));

  // ---- loading ----
  const loadCover = el("img", {alt: ""});
  const loadTitle = el("h2", {}, "Loading…");
  const loadNote = el("div", {className: "wb-status", role: "status"}, "The first frames take a few seconds.");
  const loadBack = el("button", {type: "button", hidden: true}, "Back to home");
  const loading = el("div", {className: "wb-loading", hidden: true}, loadCover, loadTitle, loadNote, loadBack);

  // ---- play chrome ----
  const homeBtn = el("button", {className: "wb-homebtn", type: "button", hidden: true}, "← Home");
  const endText = el("strong", {}, "Round over.");
  const againBtn = el("button", {className: "primary", type: "button"}, "Play again");
  const endHomeBtn = el("button", {type: "button"}, "Back to home");
  const endbar = el("div", {className: "wb-endbar", hidden: true, role: "status"}, endText, againBtn, endHomeBtn);

  document.body.append(home, loading, homeBtn, endbar);

  const say = (node, text, error = false) => { node.textContent = text; node.classList.toggle("error", error); };
  const remember = (patch) => { Object.assign(state, patch); save(state); };
  const image = (name) => `${API}/image/${state.slug}/${name}?t=${Date.now()}`;

  function show(next) {
    view = next;
    document.body.classList.toggle("wb-home", next !== "play");
    home.hidden = next !== "home";
    loading.hidden = next !== "loading";
    homeBtn.hidden = next !== "play";
    if (next !== "play") endbar.hidden = true;
    if (next !== "loading") { clearTimeout(loadTimer); loadBack.hidden = true; }
  }

  function renderGallery() {
    grid.replaceChildren(...games.map((game) => el("button", {
      className: "wb-card", type: "button", onClick: () => startGame(game),
    },
      el("img", {alt: "", loading: "lazy", src: game.cover ? `/ext/game2v/${game.cover}` : ""}),
      el("div", {className: "wb-meta"},
        el("strong", {}, game.title),
        game.source ? el("span", {className: "wb-badge"}, "Workbench") : "",
        el("small", {}, game.description || "")))));
  }

  async function refreshGames() {
    const payload = await call("/ext/game2v/games");
    games = payload.games;
    renderGallery();
    return payload;
  }

  function startGame(game, restart = false) {
    target = game;
    remember({slug: game.slug});
    loadTitle.textContent = `Loading ${game.title}…`;
    loadNote.textContent = "The first frames take a few seconds.";
    loadNote.classList.remove("error");
    loadBack.hidden = true;
    if (game.cover) loadCover.src = `/ext/game2v/${game.cover}`;
    else loadCover.removeAttribute("src");
    show("loading");
    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => {
      if (view !== "loading") return;
      say(loadNote, "Still waiting for the first frame. The server may be busy, or the connection stalled.", true);
      loadBack.hidden = false;
    }, LOAD_TIMEOUT_MS);
    call("/ext/game2v/switch", {slug: game.slug, restart}).catch((error) => {
      say(loadNote, error.message, true);
      loadBack.hidden = false;
    });
  }

  function goHome() {
    target = null;
    show("home");
    call("/ext/game2v/home", {}).then(() => refreshGames()).catch((error) => say(status1, error.message, true));
  }

  // A game_ui envelope is the first proof that frames of a game are arriving,
  // and its state field is how a finished round is recognised.
  window.addEventListener("game2v-ui", (event) => {
    const payload = event.detail;
    if (payload?.type !== "game_ui") return;
    const phase = payload.state?.state ?? "";
    if (view === "loading" && payload.slug && (!target || payload.slug === target.slug)) {
      show("play");
    }
    if (view === "play") {
      const over = !OPEN_STATES.has(phase);
      endbar.hidden = !over;
      if (over) endText.textContent = phase === "WON" ? "You won." : "Round over.";
    }
  });

  // "Play again" rewinds the rollout to the first frame, same as picking the
  // game again. The game's own restart key would only reset its simulation,
  // leaving the video on the round that just ended.
  againBtn.addEventListener("click", () => {
    const game = games.find((item) => item.slug === (target?.slug || state.slug));
    if (game) startGame(game, true);
  });
  endHomeBtn.addEventListener("click", goHome);
  homeBtn.addEventListener("click", goHome);
  loadBack.addEventListener("click", goHome);

  // ---- generation flow (left column) ----
  function select(name) {
    selected = name;
    if (name) fineImg.src = image(name);
    else fineImg.removeAttribute("src");
    for (const thumb of thumbs.children) thumb.classList.toggle("selected", thumb.dataset.name === name);
    acceptBtn.disabled = !name;
  }

  async function openFrameStep() {
    const files = await call(`${API}/api/games/${state.slug}`);
    frameBox.hidden = false;
    coarseImg.src = image(files.coarse);
    if (files.caption && !caption.value) caption.value = files.caption;
    thumbs.replaceChildren(...files.fines.map((name) => el("img", {
      src: image(name), alt: name, "data-name": name, onClick: () => select(name),
    })));
    select(files.fines.includes(state.fine) ? state.fine : files.fines.at(-1) || null);
    preview.hidden = false;
    preview.replaceChildren(el("iframe", {src: `/ext/game2v/play/${state.slug}`, title: "Game preview"}));
    if (state.accepted) playNew.hidden = false;
  }

  function watch(job, onDone) {
    clearInterval(polling);
    let offset = 0;
    log.hidden = false;
    log.textContent = "";
    remember({job: job.id});
    const tick = async () => {
      let current;
      try { current = await call(`${API}/api/jobs/${job.id}?since=${offset}`); } catch (error) { say(status1, error.message, true); return; }
      if (current.log.length) {
        log.textContent += current.log.join("\n") + "\n";
        log.scrollTop = log.scrollHeight;
      }
      offset = current.log_total;
      if (current.status !== "running") {
        clearInterval(polling);
        remember({job: null});
        onDone(current);
      }
    };
    polling = setInterval(tick, 2000);
    tick();
  }

  function busy(on) {
    generate.disabled = captionBtn.disabled = on;
    cancel.hidden = !on;
  }

  function finishGame(job) {
    busy(false);
    if (job.status !== "succeeded") return say(status1, `Game job ${job.status}: ${job.error || ""}`, true);
    say(status1, job.result.summary ? job.result.summary.slice(0, 400) : "Game ready. Now its first frame.");
    refreshGames().catch(() => {});
    openFrameStep().catch((error) => say(status2, error.message, true));
  }

  generate.addEventListener("click", async () => {
    const name = slug.value.trim() || slugify(prompt.value);
    slug.value = name;
    remember({prompt: prompt.value, slug: name, accepted: false, fine: null});
    frameBox.hidden = true; playNew.hidden = true;
    try {
      busy(true);
      say(status1, "Claude Code is building the game. This usually takes tens of minutes.");
      watch(await call(`${API}/api/games`, {prompt: prompt.value, slug: name}), finishGame);
    } catch (error) { busy(false); say(status1, error.message, true); }
  });

  cancel.addEventListener("click", async () => {
    if (state.job) await call(`${API}/api/jobs/${state.job}/cancel`, {}).catch((error) => say(status1, error.message, true));
  });

  captionBtn.addEventListener("click", async () => {
    try {
      busy(true);
      say(status2, "Claude is captioning the greybox frame…");
      watch(await call(`${API}/api/games/${state.slug}/caption`, {}), (job) => {
        busy(false);
        if (job.status !== "succeeded") return say(status2, `Caption ${job.status}: ${job.error || ""}`, true);
        caption.value = job.result.caption;
        say(status2, "Caption ready. Edit it if needed, then render.");
      });
    } catch (error) { busy(false); say(status2, error.message, true); }
  });

  renderBtn.addEventListener("click", async () => {
    if (!caption.value.trim()) return say(status2, "Write or generate a caption first.", true);
    renderBtn.disabled = true;
    say(status2, "FLUX is rendering (about 15 s)…");
    try {
      const result = await call(`${API}/render`, {slug: state.slug, caption: caption.value, seed: Number(seed.value) || 0});
      if (![...thumbs.children].some((thumb) => thumb.dataset.name === result.image)) {
        thumbs.append(el("img", {src: image(result.image), alt: result.image, "data-name": result.image, onClick: () => select(result.image)}));
      }
      select(result.image);
      remember({fine: result.image});
      say(status2, `Rendered in ${result.seconds}s. Try another seed, or use this frame.`);
    } catch (error) { say(status2, error.message, true); }
    finally { renderBtn.disabled = false; }
  });

  acceptBtn.addEventListener("click", async () => {
    try {
      await call(`${API}/api/games/${state.slug}/accept`, {image: selected, caption: caption.value});
      remember({accepted: true, fine: selected});
      playNew.hidden = false;
      say(status2, `${selected} is now the first frame of ${state.slug}.`);
      refreshGames().catch(() => {});
    } catch (error) { say(status2, error.message, true); }
  });

  playNew.addEventListener("click", () => {
    const game = games.find((item) => item.slug === state.slug) || {slug: state.slug, title: state.slug, cover: null};
    startGame(game);
  });

  // A session that is already rendering keeps its play layout, so a reload
  // does not interrupt it. Otherwise the home screen comes first.
  refreshGames().then(({started}) => {
    if (started) show("play");
    else show("home");
  }).catch((error) => { say(status1, `Cannot reach the server: ${error.message}`, true); show("home"); });

  // Resume an unfinished generation after a reload.
  call(`${API}/api/state`).then(({running}) => {
    if (running && running.kind === "game") { busy(true); watch(running, finishGame); }
    else if (state.slug) openFrameStep().catch(() => {});
  }).catch((error) => say(status1, `Workbench backend: ${error.message}`, true));
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
else mount();
