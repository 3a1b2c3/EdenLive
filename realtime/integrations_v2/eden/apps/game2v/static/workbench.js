// SPDX-License-Identifier: Apache-2.0
/**
 * Game2V workbench: a game gallery, a conversational studio, and a play modal.
 *
 * Three stages, three places:
 *
 * - `#/` gallery: every registered game as a card. Picking one opens the play
 *   modal; a game the workbench made can also be reopened in the studio.
 * - `#/studio/<id>` studio: a conversation on the left builds a game from the
 *   first message and revises the same game on every later one. The right
 *   side tries the proxy game directly in the browser, and a second tab turns
 *   its greybox first frame into a realistic one with FLUX.
 * - play modal: the server's own three-pane page, shown over either view.
 *   Rendering starts when it opens and stops when it closes.
 *
 * The WebRTC connection and its video elements belong to the server's page
 * (index.html + app.js); this script only lays its own views over them. Game
 * frames are observed through the "game2v-ui" event app.js dispatches for
 * every game_ui envelope.
 *
 * Talks to /ext/workbench/ (bridge proxy + FLUX worker) and /ext/game2v/.
 */
const API = "/ext/workbench";
const STORE = "eden-workbench";
const OPEN_STATES = new Set(["", "RUNNING", "READY"]);
const LOAD_TIMEOUT_MS = 90_000;
const POLL_MS = 2000;

const css = `
body.wb-on{overflow:hidden}
body.wb-on:not(.wb-play) .layout{visibility:hidden}
body.wb-on:not(.wb-play) #status{display:none}
body.wb-on .game2v-host{display:none}
/* panel.js adds a fourth row for its own panel, which is hidden here. */
body.wb-on .layout{grid-template-rows:repeat(3,minmax(0,1fr))!important}
body.wb-on .layout .model{grid-row:1/span 3!important}
/* The panes move into the modal body while a round is open, so the video
   and the HUD over it share the modal's box instead of floating above it. */
body.wb-play .wb-modal-body{display:flex;flex-direction:column}
.wb-keys{display:flex;flex-wrap:wrap;gap:.4rem .9rem;padding:.45rem 1.1rem;border-bottom:1px solid var(--line);color:var(--muted);font-size:.78rem}
.wb-keys[hidden]{display:none!important}
.wb-keys span{white-space:nowrap}
body.wb-play .layout{position:relative;z-index:auto;flex:1;width:auto;height:auto;min-height:0;padding:.75rem;box-sizing:border-box}
body.wb-play #status{z-index:73}
/* The cover hides the panes until the first frames arrive. */
body.wb-play.wb-starting .layout,body.wb-play.wb-starting #status{visibility:hidden}
:is(.wb,.wb-modal,.wb-endbar){--bg:#f2f1ed;--panel:#ffffff;--raise:#e8e6e0;--line:#d8d5cf;--text:#22252a;--muted:#737d8c;--accent:#569cd6;--accent-soft:#569cd61a;--danger:#b34747;--on-accent:#ffffff}
.wb{position:fixed;inset:0;z-index:60;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;display:flex;flex-direction:column}
.wb[hidden],.wb-modal[hidden],.wb-endbar[hidden],.wb [hidden]{display:none!important}
:is(.wb,.wb-modal,.wb-endbar) button{font:inherit;color:inherit;cursor:pointer}
:is(.wb,.wb-modal,.wb-endbar) button:disabled{opacity:.45;cursor:default}
.wb-btn{background:var(--raise);border:1px solid var(--line);border-radius:.5rem;padding:.4rem .8rem;display:inline-flex;align-items:center;gap:.35rem;white-space:nowrap}
.wb-btn:hover:not(:disabled){border-color:var(--accent)}
.wb-btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent);font-weight:600}
.wb-btn.ghost{background:transparent}
.wb-head{display:flex;align-items:center;gap:.75rem;padding:.7rem 1.1rem;border-bottom:1px solid var(--line);min-height:3.2rem;box-sizing:border-box}
.wb-head .grow{flex:1;min-width:0}
.wb-title{font-weight:600;font-size:.95rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wb-sub{color:var(--muted);font-size:.75rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wb-mark{width:2.6rem;height:2.6rem;border-radius:.8rem;border:1px solid #569cd666;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center;font-size:1.2rem}
.wb-mark.round{border-radius:50%;background:transparent}
.wb-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.5rem;text-align:center;padding:2rem;color:var(--muted)}
.wb-empty strong{color:var(--text);font-size:1.25rem;font-weight:600}
.wb-empty.small strong{font-size:1rem}
.wb-empty.glow{background:radial-gradient(closest-side,#569cd612,transparent 70%)}
/* gallery */
.wb-gallery{flex:1;overflow-y:auto;padding:1.4rem}
.wb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));gap:1rem}
.wb-card{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:.8rem;overflow:hidden;text-align:left;padding:0;display:flex;flex-direction:column}
.wb-card:hover{border-color:#569cd680}
.wb-card img{width:100%;aspect-ratio:16/9;object-fit:cover;background:#000;display:block}
.wb-card .meta{padding:.6rem .75rem .75rem;display:flex;flex-direction:column;gap:.2rem}
.wb-card small{color:var(--muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.wb-badge{position:absolute;top:.5rem;left:.5rem;background:#ffffffee;border:1px solid #569cd666;color:var(--accent);border-radius:999px;padding:.05rem .5rem;font-size:.72rem}
.wb-edit{position:absolute;top:.45rem;right:.45rem;background:#ffffffee;border:1px solid var(--line);border-radius:.4rem;padding:.15rem .5rem;font-size:.75rem}
.wb-convos{display:grid;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));gap:.6rem;margin-bottom:1.6rem}
.wb-convo{all:unset;cursor:pointer;box-sizing:border-box;background:var(--panel);border:1px solid var(--line);border-radius:.6rem;padding:.6rem .75rem;display:flex;flex-direction:column;gap:.25rem;min-width:0}
.wb-convo:hover,.wb-convo:focus-visible{border-color:#569cd680}
.wb-convo .row{display:flex;align-items:center;gap:.5rem}
.wb-convo strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wb-convo small{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wb-pill{font-size:.7rem;border-radius:999px;padding:0 .45rem;border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.wb-pill.running{color:var(--accent);border-color:#569cd666}
.wb-pill.failed{color:var(--danger);border-color:currentColor}
.wb-section{color:var(--muted);font-size:.75rem;letter-spacing:.06em;margin:0 0 .7rem}
/* studio */
.wb-studio{flex:1;display:grid;grid-template-columns:minmax(22rem,36%) 1fr;min-height:0}
.wb-chat{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--line)}
.wb-msgs{flex:1;overflow-y:auto;padding:1rem 1.1rem;display:flex;flex-direction:column;gap:.8rem}
.wb-msg{max-width:88%;padding:.6rem .8rem;border-radius:.8rem;white-space:pre-wrap;word-break:break-word}
.wb-msg.user{align-self:flex-end;background:var(--accent-soft);border:1px solid #569cd640}
.wb-msg.assistant{align-self:flex-start;background:var(--panel);border:1px solid var(--line)}
.wb-msg.error{border-color:#b3474766;color:var(--danger)}
.wb-msg .state{color:var(--muted);font-size:.8rem;display:flex;align-items:center;gap:.4rem}
.wb-trace{margin-top:.5rem;display:flex;flex-direction:column;gap:.55rem;min-width:16rem}
.wb-phase{display:flex;flex-direction:column;gap:.25rem}
.wb-phase .head{display:flex;align-items:center;gap:.4rem;font-size:.78rem}
.wb-phase .head b{font-weight:600}
.wb-phase .dot{width:.45rem;height:.45rem;border-radius:50%;background:var(--line);flex:0 0 auto}
.wb-phase.done .dot{background:#2f9e6b}
.wb-phase.current .dot{background:var(--accent)}
.wb-phase .body{border-left:2px solid var(--line);margin-left:.2rem;padding:.15rem 0 .15rem .6rem;display:flex;flex-direction:column;gap:.3rem}
.wb-say{white-space:pre-wrap;word-break:break-word}
.wb-tool{font:11px/1.4 ui-monospace,monospace;color:var(--muted);background:var(--raise);border-radius:.3rem;padding:.15rem .4rem;white-space:pre-wrap;word-break:break-word}
.wb-note-line{font-size:.75rem;color:var(--muted)}
.wb-spin{width:.7rem;height:.7rem;border-radius:50%;border:2px solid #569cd655;border-top-color:var(--accent);animation:wb-spin 1s linear infinite}
@keyframes wb-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.wb-spin{animation:none}}
.wb-compose{margin:.9rem 1.1rem 1.1rem;background:var(--panel);border:1px solid var(--line);border-radius:.8rem;padding:.6rem .7rem;display:flex;flex-direction:column;gap:.4rem}
.wb-compose:focus-within{border-color:#569cd680}
.wb-compose textarea{background:transparent;border:0;outline:0;color:var(--text);font:inherit;resize:none;min-height:3.5rem;max-height:12rem}
.wb-compose .row{display:flex;justify-content:flex-end;align-items:center;gap:.5rem}
.wb-compose .hint{flex:1;color:var(--muted);font-size:.75rem}
.wb-send{width:2.1rem;height:2.1rem;border-radius:.55rem;border:0;background:var(--accent);color:var(--on-accent);font-weight:700;display:grid;place-items:center}
.wb-side{display:flex;flex-direction:column;min-height:0;min-width:0}
.wb-tabs{display:flex;gap:.25rem;background:var(--panel);border:1px solid var(--line);border-radius:.55rem;padding:.2rem}
.wb-tab{background:transparent;border:0;border-radius:.4rem;padding:.25rem .75rem;color:var(--muted)}
.wb-tab[aria-selected="true"]{background:var(--raise);color:var(--accent)}
.wb-pane{flex:1;min-height:0;display:flex;flex-direction:column}
.wb-pane iframe{flex:1;border:0;background:#000;width:100%}
.wb-frame{flex:1;overflow-y:auto;padding:1.1rem;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;align-content:start}
.wb-frame figure{margin:0;display:flex;flex-direction:column;gap:.35rem}
.wb-frame figcaption{color:var(--muted);font-size:.75rem}
.wb-frame figure img{width:100%;height:auto;min-height:0;aspect-ratio:auto;object-fit:contain;display:block;border-radius:.5rem;background:#000;border:1px solid var(--line)}
.wb-frame .full{grid-column:1/-1;display:flex;flex-direction:column;gap:.5rem}
.wb-frame textarea,.wb-frame input,.wb-frame select{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:.5rem;padding:.5rem .6rem;font:inherit}
.wb-frame textarea{min-height:6rem;resize:vertical}
.wb-frame .row{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
.wb-frame label{color:var(--muted);font-size:.8rem;display:flex;align-items:center;gap:.4rem}
.wb-frame input[type=number]{width:6rem}
.wb-thumbs{display:flex;gap:.5rem;flex-wrap:wrap}
.wb-thumbs button{padding:0;border:2px solid transparent;border-radius:.4rem;background:none;line-height:0}
.wb-thumbs button[aria-pressed="true"]{border-color:var(--accent)}
.wb-thumbs img{width:7.5rem;aspect-ratio:16/9;object-fit:cover;border-radius:.25rem}
.wb-note{color:var(--muted);font-size:.8rem;min-height:1.2em}
.wb-note.warn{color:var(--accent)}
.wb-note.error{color:var(--danger)}
/* play modal */
.wb-modal{position:fixed;inset:0;z-index:70;background:#22252a66;backdrop-filter:blur(3px);font:14px/1.5 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--text)}
.wb-modal-box{position:absolute;inset:4vh 4vw;background:var(--bg);border:1px solid var(--line);border-radius:.9rem;box-shadow:0 1.5rem 4rem #22252a33;display:flex;flex-direction:column;overflow:hidden}
.wb-modal .wb-head{border-color:var(--line)}
.wb-modal-body{position:relative;flex:1}
.wb-loading{position:absolute;inset:0;z-index:74;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.9rem;background:var(--bg);text-align:center;padding:2rem}
.wb-loading[hidden]{display:none!important}
.wb-loading img{width:min(44rem,80%);height:auto;aspect-ratio:16/9;object-fit:contain;border-radius:.6rem;background:#000}
.wb-endbar{position:fixed;left:50%;top:calc(4vh + 4.4rem);transform:translateX(-50%);z-index:74;color:var(--text);font:14px/1.5 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#ffffffee;border:1px solid #569cd666;border-radius:.7rem;padding:.5rem .8rem;display:flex;gap:.7rem;align-items:center}
@media (max-width:860px){.wb-studio{grid-template-columns:1fr;grid-template-rows:minmax(22rem,55vh) minmax(22rem,1fr);overflow-y:auto}.wb-chat{border-right:0;border-bottom:1px solid var(--line)}.wb-frame{grid-template-columns:1fr}}
/* Workbench panel geometry at 1920 x 1080.
   Keep runtime video nodes and workflow controls; only their containers move. */
/* Default theme: VS Code's dark workbench palette. Keep the contrast high
   enough for long sessions while letting the live video remain the visual
   focus. */
body.wb-on :is(.wb,.wb-modal,.wb-endbar){--bg:#1e1e1e;--panel:#252526;--raise:#2d2d30;--line:#3e3e42;--text:#d4d4d4;--muted:#9d9d9d;--accent:#569cd6;--accent-soft:#264f78;--danger:#f48771;--on-accent:#ffffff;font-family:Arial,"Microsoft YaHei",sans-serif}
.wb,.wb-modal-box{box-sizing:border-box;padding:24px;background:var(--bg)}
.wb-modal-box{inset:0;border:0;border-radius:0;box-shadow:none}
.wb-btn,.wb-btn.primary{border:1px solid var(--accent);background:#264f78;color:#ffffff;border-radius:7px;font-size:12px}
.wb-btn.ghost{background:transparent;border-color:var(--line)}
.wb-control-head{height:68px;min-height:68px;display:flex;align-items:center;gap:18px;border-bottom:1px solid var(--line);box-sizing:border-box}
.wb-brand-lockup{width:270px;flex:0 0 270px;line-height:1.05}
.wb-brand-lockup strong{font-size:25px;letter-spacing:2px}
.wb-brand-lockup small{display:block;font-size:10px;letter-spacing:1px;color:var(--muted);margin-top:3px}
.wb-control-title{flex:1;min-width:0}
.wb-control-title strong,.wb-control-title .wb-title{font-size:18px;font-weight:700}
.wb-control-title small,.wb-control-title .wb-sub{display:block;font-size:11px;color:var(--muted);margin-top:5px;letter-spacing:0}
.wb-connection{margin-left:auto;color:#89d185;background:#1e3a29;border-radius:22px;padding:10px 18px;font-size:12px;white-space:nowrap}
.wb-nav,.wb-play-nav{width:auto;box-sizing:border-box;border-right:1px solid var(--line);padding:12px 22px 0 8px;display:flex;flex-direction:column;align-self:stretch;min-width:0;background:transparent}
.wb-nav-brand,.wb-nav-foot{display:none}
.wb-nav-label{font-size:11px;color:var(--muted);letter-spacing:1px;margin:0 0 14px}
.wb-nav-item{display:flex;gap:10px;align-items:center;padding:12px 10px;border:1px solid transparent;border-radius:9px;margin-bottom:9px;background:transparent;color:var(--text);text-align:left;min-height:59px;font-size:13px;font-weight:700}
.wb-nav-item.active{border-color:var(--accent);background:#252526}
.wb-nav-item img{width:62px;height:38px;object-fit:cover;border-radius:4px}
.wb-nav-item small{display:block;color:#89d185;font-size:9px;font-weight:400;margin-top:5px}
.wb-pipeline-label,.wb-play-pipeline-label{margin-top:31px}
.wb-pipeline-step{display:flex;align-items:center;font-size:12px;color:#d4d4d4;margin:18px 0;gap:12px}
.wb-pipeline-step i{display:block;width:9px;height:9px;border-radius:50%;background:#858585;flex:none}
.wb-pipeline-step.active i{background:#569cd6}
.wb-gallery-wrap{display:grid;grid-template-columns:254px minmax(0,1fr);gap:18px;flex:1;min-height:0;padding-top:20px;padding-bottom:63px}
.wb-gallery-wrap.preview-open{grid-template-columns:254px minmax(0,1fr) 300px;column-gap:18px}
.wb-gallery{min-width:0;overflow-y:auto;padding:0;background:transparent}
.wb-gallery-intro{height:85px;box-sizing:border-box}
.wb-gallery-eyebrow{font-size:11px;color:var(--accent);font-weight:700;letter-spacing:1.2px;line-height:13px}
.wb-gallery-intro h1,.wb-create-intro h1{font-size:23px;line-height:27px;margin:7px 0 0}
.wb-gallery-intro p,.wb-create-intro p{font-size:12px;color:var(--muted);line-height:14px;margin:7px 0 18px}
.wb-library-panel{background:#252526;border:1px solid var(--line);border-radius:13px;padding:18px;min-height:421px;box-sizing:border-box}
.wb-library-head{display:flex;align-items:center;margin-bottom:15px;height:35px}
.wb-library-head>div:first-child{display:none}
.wb-gallery-actions{display:flex;align-items:center;gap:8px}
.wb-gallery-actions .wb-btn{font-size:11px;height:35px;font-weight:700}
.wb-game-count{color:#89d185;background:#1e3a29;border-radius:22px;padding:10px 13px;font-size:12px}
.wb-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.wb-card{display:grid;grid-template-columns:120px minmax(0,1fr);grid-template-rows:74px 31px;gap:14px;padding:12px;border-radius:10px;background:#252526;border-color:var(--line);box-sizing:border-box;min-width:0;overflow:visible}
.wb-card-main{display:contents;cursor:pointer}
.wb-card:has(.wb-card-main:focus-visible),.wb-card.selected{outline:1px solid var(--accent);outline-offset:-1px}
.wb-card img{grid-column:1;grid-row:1;width:120px;height:74px;object-fit:cover;border-radius:5px}
.wb-card .meta{grid-column:2;grid-row:1;padding:0;justify-content:space-between;min-width:0}
.wb-card .meta strong{font-size:15px;line-height:18px}
.wb-card .meta small{font-size:10px;color:#89d185;line-height:15px}
.wb-play-card{grid-column:2;grid-row:2;border:1px solid var(--accent);background:transparent;color:#9cdcfe;border-radius:5px;padding:7px;font-size:12px}
.wb-card .wb-edit{grid-column:1;grid-row:2;position:static;font-size:11px;background:transparent;color:var(--muted);border-color:var(--line)}
.wb-card .wb-badge{position:absolute;top:58px;left:16px;font-size:9px;background:#1e1e1ecc;color:#89d185}
.wb-library-panel>.wb-note:empty{display:none}
.wb-gallery-preview{margin-top:85px;align-self:start;box-sizing:border-box;min-width:0;width:300px;min-height:421px;background:#252526;border:1px solid var(--line);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:12px}
.wb-gallery-preview[hidden]{display:none}
.wb-gallery-preview .tag{font-size:11px;color:var(--accent);font-weight:700;letter-spacing:1.2px;order:1}
.wb-gallery-preview-title{font-size:18px;font-weight:700;order:2}
.wb-preview-media{width:100%;height:auto;aspect-ratio:16/9;order:0;border:0;border-radius:7px;overflow:hidden;background:#1e1e1e;display:flex;align-items:center;justify-content:center}
.wb-preview-media img,.wb-preview-media iframe{display:block;width:100%;height:100%;object-fit:contain;border:0}
.wb-preview-description{order:3;font-size:11px;color:var(--muted);line-height:1.5;margin:0}
.wb-preview-play{order:4;justify-content:center;min-height:41px;font-weight:700}
.wb-preview-stream{order:5;justify-content:center}
.wb-gallery-preview .wb-note{order:6;font-size:11px;line-height:1.5;margin:6px 0 10px}
.wb-convos{margin-bottom:18px}
.wb-convo{background:#252526}
/* Studio shares the reference's rail, heading, 825px chat card and 330px tools. */
.wb-studio{display:grid;grid-template-columns:220px minmax(400px,1fr) 400px;grid-template-rows:68px 85px minmax(0,1fr);column-gap:16px;row-gap:0;min-height:0}
.wb-studio>.wb-control-head{grid-column:1/-1;grid-row:1}
.wb-studio>.wb-stagebar{display:none}
.wb-studio-nav{grid-column:1;grid-row:2/4;margin-top:20px;margin-right:4px;margin-bottom:63px}
.wb-create-intro{grid-column:2/4;grid-row:2;padding-top:20px}
.wb-studio>.wb-chat{grid-column:2;grid-row:3;position:relative;margin-top:20px;max-height:825px;min-height:0;background:#252526;border:1px solid var(--line);border-radius:13px;overflow:hidden;padding:18px;box-sizing:border-box}
.wb-chat>.wb-head{display:flex;position:absolute;z-index:3;top:10px;right:12px;padding:0;border:0;background:transparent;min-height:0;gap:6px}
.wb-chat>.wb-head>*:not(.wb-chat-zoom){display:none}
.wb-chat-zoom{display:inline-flex!important;background:#2d2d30;border:1px solid var(--line);border-radius:6px;padding:4px 8px;color:var(--muted);font-size:11px;align-items:center;gap:4px}
.wb-chat-zoom:hover{border-color:var(--accent);color:var(--text)}
.wb-msgs{padding:0;gap:12px;min-height:0}
.wb-msgs>.wb-empty{flex:1;min-height:170px;width:auto;max-width:600px;align-self:center;padding:20px;font-size:13px;box-sizing:border-box}
.wb-empty .wb-mark{width:64px;height:64px;border-radius:50%;background:#264f78;border:1px solid var(--accent);color:#9cdcfe;font-size:28px;margin-bottom:10px;flex:none}
.wb-empty strong{font-size:25px;margin-bottom:2px}
.wb-msg{max-width:75%;font-size:13px;line-height:1.5;border-radius:10px;padding:12px 15px}
.wb-msg.user{background:#264f78;border:0}
.wb-msg.assistant{background:#2d2d30}
.wb-compose{position:relative;flex:none;display:flex;flex-direction:row;align-items:center;gap:12px;margin:14px 0 0;padding:10px 16px;border:1px solid var(--accent);border-radius:12px;background:#2d2d30;box-shadow:0 0 30px #25145c55}
.wb-compose textarea{flex:1;min-width:0;height:30px;min-height:30px;max-height:100px;font-size:14px;line-height:22px;padding:4px 0;box-sizing:border-box}
.wb-compose .hint{display:none}
.wb-compose .row{flex:none}
.wb-send{width:26px;height:28px;background:transparent;color:#9cdcfe}
.wb-studio.focus-start .wb-compose{position:absolute;left:50%;top:55%;transform:translate(-50%,-50%);margin:0;width:min(600px,calc(100% - 48px));box-sizing:border-box}
.wb-studio.focus-start .wb-chat>.wb-msgs>.wb-empty{transform:translateY(-90px)}
.wb-side{grid-column:3;grid-row:3;margin-top:20px;max-height:825px;gap:13px;overflow:auto}
.wb-studio.focus-frame{grid-template-columns:220px minmax(330px,.78fr) minmax(470px,1.22fr)}
.wb-studio.focus-frame>.wb-chat{max-width:none}
.wb-studio.focus-frame .wb-frame{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:16px}
.wb-studio.focus-frame .wb-frame figure img{height:auto;min-height:0;aspect-ratio:auto;object-fit:contain}
.wb-build-status,.wb-claude-details{flex:0 0 auto;background:#2d2d30;border:1px solid var(--line);border-radius:10px;padding:15px;box-sizing:border-box;font-size:12px}
.wb-build-status{min-height:145px}
.wb-build-status h4,.wb-claude-details h4{margin:0 0 7px;font-size:12px;color:var(--muted);letter-spacing:.2px}
.wb-build-status .row{display:flex;justify-content:space-between;margin:5px 0}
.wb-build-status b{color:#89d185}
.wb-build-status .wb-progress{margin:8px 0 0}
.wb-build-status>.wb-head{display:flex;flex-wrap:nowrap;align-items:center;gap:6px;margin:9px 0 0;padding:0;border:0;min-height:0;background:transparent}
.wb-build-status>.wb-head .wb-tabs{width:auto;flex:1;min-width:0}
.wb-build-status>.wb-head .wb-tab{padding:5px 7px;font-size:10px}
.wb-build-status>.wb-head>.grow{display:none}
.wb-build-status>.wb-head>.wb-btn{flex:0 0 auto;padding:5px 7px;font-size:10px}
.wb-claude-details{min-height:116px;color:var(--muted);line-height:1.8}
.wb-claude-details h4{color:var(--muted)}
.wb-claude-details p{margin:0;font-size:11px}
.wb-side>.wb-head{flex-wrap:wrap;min-height:0;padding:12px;background:#2d2d30;border:1px solid var(--line);border-radius:10px;gap:8px}
.wb-side>.wb-head{flex:0 0 auto}
.wb-side .wb-tabs{width:100%;box-sizing:border-box}
.wb-side .wb-tab{flex:1;padding:5px;font-size:11px}
.wb-side .wb-head>.grow{display:none}
.wb-side .wb-head>.wb-btn{flex:1;justify-content:center;font-size:11px}
.wb-side .wb-pane{background:transparent;flex:0 0 auto;min-height:230px;overflow:visible}
.wb-side-section-title{margin:0;padding:2px 2px 0;color:var(--accent);font-size:11px;letter-spacing:1.2px;font-weight:700}
.wb-side .wb-pane{align-items:center;overflow:auto}
.wb-side .wb-pane iframe{width:100%;height:auto;aspect-ratio:16/9;min-height:0;flex:0 0 auto;border:1px solid var(--line);border-radius:10px;box-sizing:border-box;background:#1e1e1e}
.wb-side .wb-empty{padding:20px 12px;border:1px solid var(--line);border-radius:10px;background:#2d2d30;font-size:12px}
.wb-side .wb-empty strong{font-size:14px}
.wb-frame{padding:18px;border:1px solid var(--line);border-radius:13px;background:#252526;gap:9px;overflow:visible;flex:none}
.wb-frame figure{gap:5px}
.wb-frame figure img{height:auto;min-height:0;aspect-ratio:auto;object-fit:contain;border-radius:8px}
.wb-frame figcaption{font-size:9px}
.wb-frame .row{gap:8px}
.wb-frame .wb-btn,.wb-frame label{font-size:11px}
.wb-frame textarea{font-size:12px;min-height:80px}
.wb-frame select{max-width:100%;font-size:11px}
.wb-frame .wb-sub{white-space:normal;font-size:11px}
.wb-build-status{padding:15px;background:#2d2d30;border:1px solid var(--line);border-radius:10px;font-size:12px}
.wb-build-status h4{margin:0 0 11px;font-size:12px;color:var(--muted)}
.wb-build-status .row{display:flex;justify-content:space-between;margin:10px 0}
.wb-build-status b{color:#89d185}
.wb-trace-details{margin-top:10px;border-top:1px solid var(--line);padding-top:9px;font-size:11px;color:var(--muted)}
.wb-trace-details>summary{cursor:pointer;color:#9cdcfe;font-size:11px}
.wb-detail-count{margin-left:12px;color:var(--muted)}
.wb-trace{min-width:0}
.wb-progress{height:4px;background:#3e3e42;border-radius:9px;overflow:hidden;margin:10px 0}
.wb-progress i{display:block;height:100%;width:40%;background:var(--accent);animation:wb-progress 1.6s ease-in-out infinite alternate}
@keyframes wb-progress{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
/* Reuse the real server video/prompt/event nodes, never a replacement player. */
body.wb-play .wb-modal-body{display:grid;grid-template-columns:250px minmax(0,1fr);gap:22px;padding:20px 0 63px;min-height:0;overflow:auto}
.wb-play-nav .wb-nav-item{min-height:64px}
.wb-play-nav-again{margin-top:35px;min-height:41px;justify-content:center;font-weight:700}
body.wb-play .wb-modal-body>.layout{display:grid;grid-column:2;grid-template-columns:minmax(0,1fr) 310px!important;grid-template-rows:145px 120px 174px minmax(0,1fr)!important;gap:12px 16px;padding:12px 0 0;width:100%;height:837px;min-height:0;flex:none;overflow:visible;background:transparent}
body.wb-play .layout>.panel{background:#252526;border:1px solid var(--line);border-radius:10px;min-width:0;min-height:0;box-sizing:border-box}
body.wb-play .layout>.wb-live-model{grid-column:1;grid-row:1/5!important;height:825px;position:relative;border-radius:12px}
body.wb-play .layout>.wb-scene-panel{grid-column:2;grid-row:1}
body.wb-play .layout>.wb-events-panel{grid-column:2;grid-row:3}
body.wb-play .layout>.wb-game-render-panel{grid-column:2;grid-row:4}
body.wb-play .layout .panel-title{padding:15px 15px 0;color:var(--muted);font-size:11px;letter-spacing:1px;flex:none}
body.wb-play .layout .wb-live-model>.panel-title{position:absolute;z-index:2;top:16px;left:16px;background:#1e1e1ecc;padding:8px 11px;border-radius:5px;color:#89d185;font-size:11px;letter-spacing:0;pointer-events:none}
body.wb-play .layout .model-stage{flex:1;min-height:0}
body.wb-play .layout #prompt,body.wb-play .layout #events{padding:12px 15px;font-size:12px;line-height:1.8;color:#d4d4d4}
body.wb-play .layout .wb-scene-panel #prompt{padding-bottom:0}
.wb-play-tag{position:absolute;top:0;left:0;color:var(--accent);font-size:11px;line-height:12px;letter-spacing:1.2px;font-weight:700}
.wb-keys{border:0;padding:8px 15px 15px;min-height:0;gap:5px;font-size:11px;overflow:auto;flex:none}
.wb-keys span{white-space:normal}
.wb-play-metrics{grid-column:2;grid-row:2;display:grid;grid-template-columns:1fr 1fr;gap:8px}
.wb-play-metrics>div{padding:10px;border:1px solid var(--line);border-radius:6px;color:var(--muted);font-size:10px;line-height:12px;box-sizing:border-box}
.wb-play-metrics b{display:block;color:var(--text);font-size:17px;margin-top:3px;line-height:20px}
.wb-loading{grid-column:2;inset:12px 326px auto 0;height:825px;box-sizing:border-box;background:#1e1e1e;border:1px solid var(--line);border-radius:12px}
.wb-endbar{background:#2d2d30ee;top:98px}
@media(max-width:1200px){.wb,.wb-modal-box{padding:16px}.wb-brand-lockup{width:218px;flex-basis:218px}.wb-gallery-wrap{grid-template-columns:200px minmax(0,1fr);gap:18px}.wb-gallery-wrap.preview-open{grid-template-columns:200px minmax(0,1fr) 280px;column-gap:18px}.wb-gallery-preview{width:280px}.wb-grid{grid-template-columns:1fr}.wb-studio,.wb-studio.focus-frame{grid-template-columns:190px minmax(0,1fr) 340px}.wb-card{grid-template-columns:100px minmax(0,1fr)}.wb-card img{width:100px}.wb-studio .wb-msg{max-width:95%}body.wb-play .wb-modal-body{grid-template-columns:200px minmax(0,1fr);gap:18px}body.wb-play .wb-modal-body>.layout{grid-template-columns:minmax(0,1fr) 280px!important}.wb-loading{right:296px}}
@media(max-width:860px){.wb,.wb-modal-box{padding:12px}.wb-brand-lockup{width:auto;flex:1}.wb-brand-lockup strong{font-size:20px}.wb-control-title{display:none}.wb-connection{font-size:10px;padding:8px}.wb-nav,.wb-play-nav{display:none}.wb-gallery-wrap,.wb-gallery-wrap.preview-open{grid-template-columns:minmax(0,1fr);overflow:auto;padding-bottom:12px}.wb-gallery-preview{grid-column:1;grid-row:1;width:100%;margin:0;min-height:0}.wb-gallery{overflow:visible}.wb-grid{grid-template-columns:1fr}.wb-studio{grid-template-columns:minmax(0,1fr);grid-template-rows:68px 105px minmax(360px,60vh) auto;overflow:auto}.wb-create-intro{grid-column:1;grid-row:2}.wb-create-intro h1{font-size:20px}.wb-studio>.wb-chat{grid-column:1;grid-row:3;margin:0}.wb-side{grid-column:1;grid-row:4;max-height:none}.wb-studio.focus-start .wb-chat>.wb-msgs>.wb-empty{transform:translateY(-50px)}.wb-studio.focus-start .wb-compose{top:68%}body.wb-play .wb-modal-body{grid-template-columns:minmax(0,1fr);padding-bottom:12px}body.wb-play .wb-modal-body>.layout{grid-column:1;grid-template-columns:minmax(0,1fr)!important;grid-template-rows:minmax(350px,65vh) auto 120px 174px 220px!important;height:auto;min-height:0}body.wb-play .layout>.wb-live-model{grid-column:1;grid-row:1!important;height:auto}body.wb-play .layout>.wb-scene-panel{grid-column:1;grid-row:2;min-height:145px}body.wb-play .layout>.wb-play-metrics{grid-column:1;grid-row:3}body.wb-play .layout>.wb-events-panel{grid-column:1;grid-row:4}body.wb-play .layout>.wb-game-render-panel{grid-column:1;grid-row:5}.wb-loading{grid-column:1;right:0;height:65vh}.wb-control-head .wb-btn{font-size:10px;padding:6px}}

`;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "className") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value != null && value !== false) node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...children.filter((child) => child != null && child !== false));
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

function remembered() {
  try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { return {}; }
}
function remember(patch) {
  try { localStorage.setItem(STORE, JSON.stringify({...remembered(), ...patch})); } catch { /* storage blocked */ }
}

function say(node, text, tone = "") {
  node.textContent = text || "";
  node.className = `wb-note${tone ? ` ${tone}` : ""}`;
}

function mount() {
  if (document.querySelector(".wb")) return;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  document.body.classList.add("wb-on");

  let games = [];
  let conversations = [];
  let conversation = null;
  let polling = null;
  let target = null;
  let loadTimer = null;
  let selected = null;
  // Keep the first-frame pipeline visible on entry; Proxy remains available
  // as a tab for the generated game.
  let tab = "frame";
  document.documentElement.lang = "en";
  const root = el("div", {className: "wb"});
  // Typing into the workbench must not reach the game: app.js forwards every
  // window keydown as model input.
  for (const type of ["keydown", "keyup"]) root.addEventListener(type, (event) => event.stopPropagation());

  // ---- gallery ---------------------------------------------------------
  const grid = el("div", {className: "wb-grid"});
  let gallerySelection = null;
  const convoTitle = el("p", {className: "wb-section", hidden: true}, "My conversations");
  const convoList = el("div", {className: "wb-convos", hidden: true});
  const galleryNote = el("div", {className: "wb-note"});
  const galleryPreviewFrame = el("iframe", {title: "Proxy game preview", allow: "autoplay; fullscreen; pointer-lock", sandbox: "allow-scripts allow-same-origin allow-pointer-lock"});
  const galleryPreview = el("aside", {className: "wb-gallery-preview", hidden: true},
    el("div", {className: "tag"}, "LIVE PROXY PREVIEW"),
    el("div", {className: "wb-gallery-preview-title"}, "Select a game"),
    el("div", {className: "wb-preview-media"}, galleryPreviewFrame),
    el("p", {className: "wb-preview-description"}),
    el("button", {className: "wb-btn primary wb-preview-play", type: "button", onClick: () => { if (gallerySelection) startGalleryPreview(gallerySelection); }}, "▶ PLAY GAME"),
    el("button", {className: "wb-btn ghost wb-preview-stream", type: "button", onClick: () => { if (gallerySelection) openPlay(gallerySelection); }}, "Stream play"),
    el("p", {className: "wb-note"}, "Click Play to begin rendering."));
  const galleryNav = el("aside", {className: "wb-nav", "aria-label": "Workbench navigation"},
    el("div", {className: "wb-nav-brand"}, el("span", {className: "wb-nav-logo"}, "✦"), el("strong", {}, "EDEN"), el("small", {}, "CONTROL DECK")),
    el("div", {className: "wb-nav-label wb-gallery-nav-label"}, "WORKSPACE"),
    el("button", {className: "wb-nav-item wb-gallery-nav-item active", type: "button", onClick: () => go("#/")}, "▦", el("span", {}, "Game gallery")),
    el("button", {className: "wb-nav-item wb-gallery-create-item", type: "button", onClick: () => go("#/studio/new")}, "＋", el("span", {}, "Create game")),
    el("div", {className: "wb-nav-foot"}, "PROXY VIDEO", el("span", {}, "FIRST FRAME · STREAM RENDER")));
  const libraryPanel = el("div", {className: "wb-library-panel"},
    el("div", {className: "wb-library-head"}, el("div", {}, el("p", {className: "wb-section"}, "ALL GAMES"), el("span", {}, "Select a project to preview or play")), el("div", {className: "wb-gallery-actions"}, el("button", {className: "wb-btn primary", type: "button", onClick: () => go("#/studio/new")}, "+ NEW GAME"), el("span", {className: "wb-game-count"}, "6 GAMES"))), grid, galleryNote);
  const gallery = el("section", {className: "wb-view", "aria-label": "Game gallery"},
    el("header", {className: "wb-control-head wb-gallery-head"},
      el("div", {className: "wb-brand-lockup"}, el("strong", {}, "EDENLIVE"), el("small", {}, "REALTIME WORKBENCH")),
      el("div", {className: "wb-control-title grow"}, el("strong", {}, "PROXY GAME GALLERY"), el("small", {}, "Choose a game to preview or play")),
      el("span", {className: "wb-connection"}, "● 6 GAMES")),
    el("div", {className: "wb-gallery-wrap"}, galleryNav,
      el("div", {className: "wb-gallery"}, convoTitle, convoList,
        el("div", {className: "wb-gallery-intro"}, el("div", {className: "wb-gallery-eyebrow"}, "02 / DISCOVER"), el("h1", {}, "Proxy Game Gallery"), el("p", {}, "Select a project. Click Play to begin rendering the proxy stream.")),
        libraryPanel), galleryPreview));
  gallery.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0";

  function conversationFor(slug) {
    return conversations.find((row) => row.slug === slug);
  }

  const STATUS = {
    running: () => ["BUILDING", "running"],
    failed: () => ["FAILED", "failed"],
    cancelled: () => ["CANCELLED", "failed"],
  };

  // Every conversation with something in it, so one left mid-build (no game
  // yet, so no card below) can be reopened from here.
  function renderConversations() {
    const rows = conversations.filter((row) => row.count);
    convoTitle.hidden = convoList.hidden = !rows.length;
    convoList.replaceChildren(...rows.map((row) => {
      const status = STATUS[row.status];
      const [label, tone] = status ? status() : (row.slug ? ["READY", ""] : ["", ""]);
      const when = row.updated ? new Date(row.updated * 1000).toLocaleString("en-US", {month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"}) : "";
      return el("button", {className: "wb-convo", type: "button", onClick: () => go(`#/studio/${row.id}`)},
        el("div", {className: "row"}, el("strong", {}, row.title || row.preview || "New game"),
          label ? el("span", {className: `wb-pill ${tone}`}, label) : null),
        el("small", {}, [row.title ? row.preview : "", when].filter(Boolean).join(" · ")));
    }));
  }

  function renderGallery() {
    renderConversations();
    gallery.querySelector(".wb-game-count").textContent = `${games.length} GAMES`;
    gallery.querySelector(".wb-connection").textContent = `● ${games.length} GAMES`;
    if (!games.length) {
      grid.replaceChildren(el("div", {className: "wb-empty small"}, el("strong", {}, "No games yet"), "Click Create game in the top right to make one."));
      return;
    }
    grid.replaceChildren(...games.map((game) => {
      const owner = conversationFor(game.slug);
      return el("div", {className: "wb-card"},
        el("div", {className: "wb-card-main", role: "button", tabIndex: "0", "aria-label": `${"View"} ${game.title}`,
          onClick: () => selectGalleryGame(game), onKeydown: (event) => { if (event.key === "Enter") selectGalleryGame(game); }},
          el("img", {alt: "", loading: "lazy", src: game.cover ? `/ext/game2v/${game.cover}` : ""}),
          el("div", {className: "meta"}, el("strong", {}, game.title), el("small", {}, game.description || ""))),
        game.source ? el("span", {className: "wb-badge"}, "WORKBENCH") : null,
        el("button", {className: "wb-play-card", type: "button", onClick: () => startGalleryPreview(game)}, "▶ Play"),
        owner ? el("button", {className: "wb-edit", type: "button", onClick: () => go(`#/studio/${owner.id}`)}, "Edit") : null);
    }));
  }

  function selectGalleryGame(game) {
    gallerySelection = game;
    galleryPreview.hidden = false;
    gallery.classList.add("preview-open");
    gallery.querySelector(".wb-gallery-wrap")?.classList.add("preview-open");
    galleryPreview.querySelector(".wb-gallery-preview-title").textContent = game.title || game.slug;
    // Selecting a card only opens the detail rail. Rendering begins from the
    // explicit Play button, so browsing the gallery never starts a session.
    galleryPreview.querySelector(".wb-preview-media").replaceChildren(el("img", {
      src: game.cover ? `/ext/game2v/${game.cover}` : "", alt: game.title || game.slug,
    }));
    galleryPreview.querySelector(".wb-preview-description").textContent = game.description || "";
    grid.querySelectorAll(".wb-card").forEach((card) => card.classList.remove("selected"));
    const title = [...grid.querySelectorAll(".wb-card strong")].find((node) => node.textContent === game.title);
    title?.closest(".wb-card")?.classList.add("selected");
    const play = galleryPreview.querySelector(".wb-preview-play");
    if (play) play.disabled = false;
  }

  async function startGalleryPreview(game) {
    selectGalleryGame(game);
    galleryPreview.hidden = false;
    const frame = el("iframe", {title: "Proxy game preview", allow: "autoplay; fullscreen; pointer-lock", sandbox: "allow-scripts allow-same-origin allow-pointer-lock"});
    galleryPreview.querySelector(".wb-preview-media").replaceChildren(frame);
    frame.src = `/ext/game2v/play/${encodeURIComponent(game.slug)}?v=${Date.now()}`;
    const play = galleryPreview.querySelector(".wb-preview-play");
    if (play) play.disabled = true;

  }

  async function refreshGames() {
    const payload = await call("/ext/game2v/games");
    games = payload.games;
    return payload;
  }

  async function refreshConversations() {
    try { conversations = (await call(`${API}/api/conversations`)).conversations; }
    catch { conversations = []; }  // the gallery works without the bridge
  }

  // ---- studio: conversation ---------------------------------------------
  const chatTitle = el("div", {className: "wb-title"}, "New game");
  const chatSub = el("div", {className: "wb-sub"}, "No project yet");
  const msgs = el("div", {className: "wb-msgs", "aria-live": "polite"});
  const input = el("textarea", {rows: 3, placeholder: "Describe the game you want to build…", "aria-label": "Message"});
  const hint = el("span", {className: "hint"}, "Enter to send, Shift+Enter for a new line");
  const send = el("button", {className: "wb-send", type: "button", "aria-label": "Send"}, "↑");
  const cancel = el("button", {className: "wb-btn", type: "button", hidden: true}, "Cancel");
  const chatNote = el("div", {className: "wb-note", style: "margin:0 1.1rem"});

  const empty = el("div", {className: "wb-empty"},
    el("div", {className: "wb-mark", "aria-hidden": "true"}, "✦"),
    el("strong", {}, "Describe the game you want to build"),
    "Describe the mechanics, scene and style. Claude Code will build a playable version you can revise with follow-up messages.");

  // ---- studio: right side -------------------------------------------------
  const tabProxy = el("button", {className: "wb-tab", type: "button", role: "tab", onClick: () => showTab("proxy")}, "Proxy Play");
  const tabFrame = el("button", {className: "wb-tab", type: "button", role: "tab", onClick: () => showTab("frame")}, "First Frame");
  const reload = el("button", {className: "wb-btn ghost", type: "button", title: "Reload game preview"}, "↻ Reload");
  const playBtn = el("button", {className: "wb-btn primary", type: "button", disabled: true}, "▶ Play");

  const proxyFrame = el("iframe", {title: "Proxy game preview", allow: "autoplay; fullscreen; pointer-lock", sandbox: "allow-scripts allow-same-origin allow-pointer-lock"});
  const proxyEmpty = el("div", {className: "wb-empty glow"},
    el("div", {className: "wb-mark round", "aria-hidden": "true"}, "✦"),
    el("strong", {style: "font-size:1rem"}, "No game output yet"),
    el("span", {}, "Describe a game on the left to start building"));
  const proxyPane = el("div", {className: "wb-pane", role: "tabpanel"}, proxyEmpty, proxyFrame);

  const coarseImg = el("img", {alt: "Greybox first frame"});
  const fineImg = el("img", {alt: "Rendered first frame"});
  const caption = el("textarea", {placeholder: "Generate a caption or write a scene description.", "aria-label": "Caption"});
  const captionStyle = el("select", {"aria-label": "First frame visual style"},
    el("option", {value: "realistic"}, "Realistic"),
    el("option", {value: "cinematic"}, "Cinematic"),
    el("option", {value: "storybook"}, "Storybook"),
    el("option", {value: "animation"}, "Animated film"),
    el("option", {value: "anime"}, "Anime"));
  captionStyle.value = remembered().captionStyle || "realistic";
  if (!captionStyle.value) captionStyle.value = "realistic";
  const seed = el("input", {type: "number", value: "0", min: "0", "aria-label": "Seed"});
  const captionBtn = el("button", {className: "wb-btn", type: "button"}, "Generate caption");
  const renderBtn = el("button", {className: "wb-btn", type: "button"}, "Render");
  const acceptBtn = el("button", {className: "wb-btn primary", type: "button", disabled: true}, "Use as first frame");
  const thumbs = el("div", {className: "wb-thumbs"});
  const frameNote = el("div", {className: "wb-note"});
  const frameEmpty = el("div", {className: "wb-empty small"}, el("strong", {}, "Build the game first"), "Once the game is ready, render its greybox first frame here.");
  const captionHelp = el("span", {className: "wb-sub"}, "Choose a style, then ask Claude to caption the greybox. Render uses the editable text below.");
  const frameBody = el("div", {className: "wb-frame"},
    el("figure", {}, el("figcaption", {}, "GREYBOX PROXY"), coarseImg),
    el("figure", {}, el("figcaption", {}, "RENDERED FRAME"), fineImg),
    el("div", {className: "full"},
      el("div", {className: "row"}, el("label", {}, "Visual style", captionStyle)),
      el("div", {className: "row"}, captionBtn, captionHelp),
      caption,
      el("div", {className: "row"}, el("label", {}, "Seed", seed), renderBtn, acceptBtn),
      thumbs, frameNote));
  const framePane = el("div", {className: "wb-pane", role: "tabpanel"},
    el("h4", {className: "wb-side-section-title"}, "FIRST FRAME"), frameEmpty, frameBody);
  const buildStatus = el("section", {className: "wb-build-status", "aria-label": "Build status"},
    el("h4", {}, "BUILD STATUS"),
    el("div", {className: "row"}, el("span", {}, "Proxy game"), el("b", {className: "wb-build-proxy"}, "—")),
    el("div", {className: "row"}, el("span", {}, "Claude output"), el("strong", {className: "wb-build-claude"}, "IDLE")),
    el("div", {className: "wb-progress", hidden: true}, el("i", {})));
  const claudeDetails = el("section", {className: "wb-claude-details", "aria-label": "Claude details"},
    el("h4", {}, "CLAUDE DETAILS"),
    el("p", {className: "wb-claude-line"}, "Waiting for a game brief"),
    el("p", {className: "wb-claude-line"}, "Scene and behavior will appear here"),
    el("p", {className: "wb-claude-line"}, "Acceptance checks will follow"));

  // The studio uses the same project rail as the reference Control Deck.  It
  // is separate from the chat so the composer can collapse into a focused
  // centre state without taking navigation with it.
  const studioNav = el("aside", {className: "wb-nav wb-studio-nav", "aria-label": "Project navigation"},
    el("div", {className: "wb-nav-brand"}, el("span", {className: "wb-nav-logo"}, "✦"), el("strong", {}, "EDEN"), el("small", {}, "CONTROL DECK")),
    el("div", {className: "wb-nav-label"}, "PROJECTS"),
    el("button", {className: "wb-nav-item active", type: "button", onClick: () => go("#/")}, "▦", el("span", {}, "Game gallery")),
    el("button", {className: "wb-nav-item", type: "button", onClick: () => go("#/studio/new")}, "＋", el("span", {}, "New game")),
    el("div", {className: "wb-nav-label wb-pipeline-label"}, "Pipeline"),
    el("div", {className: "wb-pipeline"},
      el("div", {className: "wb-pipeline-step active"}, el("i", {}), "01  Proxy Game"),
      el("div", {className: "wb-pipeline-step"}, el("i", {}), "02  Greybox Frame"),
      el("div", {className: "wb-pipeline-step"}, el("i", {}), "03  Caption"),
      el("div", {className: "wb-pipeline-step"}, el("i", {}), "04  Realistic Frame"),
      el("div", {className: "wb-pipeline-step"}, el("i", {}), "05  Model Render")));
  const studioHead = el("header", {className: "wb-control-head"},
    el("div", {className: "wb-brand-lockup"}, el("strong", {}, "EDENLIVE"), el("small", {}, "REALTIME WORKBENCH")),
    el("div", {className: "wb-control-title grow"}, el("strong", {}, "CREATE / PROXY VIDEO"), el("small", {}, "Generate game and realistic first frame")),
    el("span", {className: "wb-connection"}, "● CONNECTED"));

  const studio = el("section", {className: "wb-view wb-studio", "aria-label": "Workbench"},
    studioHead,
    el("div", {className: "wb-stagebar"},
      el("div", {className: "wb-stage done"}, el("b", {}, "01"), el("span", {}, "CREATE / PROXY VIDEO")),
      el("i", {}), el("div", {className: "wb-stage"}, el("b", {}, "02"), el("span", {}, "Game gallery")),
      el("i", {}), el("div", {className: "wb-stage"}, el("b", {}, "03"), el("span", {}, "STREAM PLAY")),
      el("div", {className: "wb-stage-meta"}, "WORKBENCH / STUDIO")),
    studioNav,
    el("div", {className: "wb-chat"},
      el("header", {className: "wb-head"},
        el("button", {className: "wb-btn ghost", type: "button", title: "Back to game gallery", onClick: () => go("#/")}, "←"),
        el("div", {className: "grow"}, chatTitle, chatSub),
        el("button", {className: "wb-btn", type: "button", onClick: () => go("#/studio/new")}, "✎ New game"),
        el("button", {className: "wb-chat-zoom", type: "button", title: "Expand first frame and Proxy areas"}, "↔", el("span", {}, "Shrink chat"))),
      el("div", {className: "wb-create-intro"}, el("div", {className: "wb-gallery-eyebrow"}, "01 / CREATE + FRAME"), el("h1", {}, "Describe the game you want to build"), el("p", {}, "Claude will build the proxy game, capture the first frame, and prepare the realistic render.")),
      msgs, chatNote,
      el("div", {className: "wb-compose"}, input, el("div", {className: "row"}, hint, cancel, send))),
    el("div", {className: "wb-side"},
      el("header", {className: "wb-head"},
        el("div", {className: "wb-tabs", role: "tablist"}, tabProxy, tabFrame),
        el("div", {className: "grow"}), reload, playBtn),
      buildStatus,
      proxyPane, framePane));
  const studioSide = studio.querySelector(".wb-side");
  const chatZoom = studio.querySelector(".wb-chat-zoom");
  const updateChatZoomLabel = () => {
    const compact = studio.classList.contains("focus-frame");
    chatZoom?.setAttribute("aria-pressed", String(compact));
    if (chatZoom) chatZoom.querySelector("span").textContent = compact ? "Restore chat" : "Shrink chat";
  };
  chatZoom?.addEventListener("click", () => {
    studio.classList.toggle("focus-frame");
    updateChatZoomLabel();
  });
  updateChatZoomLabel();
  const sideHead = studioSide?.querySelector(":scope > .wb-head");
  if (sideHead) buildStatus.append(sideHead);
  studioSide?.append(claudeDetails);

  studio.insertBefore(studio.querySelector(".wb-create-intro"), studio.querySelector(".wb-chat"));
  root.append(gallery, studio);
  document.body.append(root);

  // ---- play modal ---------------------------------------------------------
  const modalTitle = el("div", {className: "wb-title"}, "");
  const againBtn = el("button", {className: "wb-btn wb-play-again", type: "button"}, "↺ Play again");
  const closeBtn = el("button", {className: "wb-btn wb-play-close", type: "button", "aria-label": "Close"}, "✕ Close");
  const loadImg = el("img", {alt: ""});
  const loadNote = el("div", {className: "wb-sub", style: "white-space:normal"});
  const loadingTitle = el("strong", {className: "wb-play-loading-title"}, "Starting render…");
  const loading = el("div", {className: "wb-loading"}, loadImg, loadingTitle, loadNote);
  const transportStatus = document.getElementById("status");
  const showTransportError = () => {
    if (!modal.hidden && !loading.hidden && transportStatus?.classList.contains("error")) {
      clearTimeout(loadTimer);
      say(loadNote, transportStatus.textContent, "error");
    }
  };
  if (transportStatus) {
    new MutationObserver(showTransportError).observe(transportStatus, {
      attributes: true, attributeFilter: ["class"], childList: true, characterData: true,
    });
  }
  const keys = el("div", {className: "wb-keys", hidden: true});
  const stage = el("div", {className: "wb-modal-body"}, loading);
  const layout = document.querySelector("main.layout");
  const layoutHome = layout?.parentElement ?? null;
  const revealPlaySurface = () => {
    if (modal.hidden || loading.hidden) return;
    loading.hidden = true;
    applyPlayLanguage();
    document.body.classList.remove("wb-starting");
    clearTimeout(loadTimer);
  };
  const liveVideo = layout?.querySelector("#video");
  const pairedVideo = layout?.querySelector("#game-video");
  [liveVideo, pairedVideo].filter(Boolean).forEach((video) => {
    ["loadeddata", "canplay", "playing", "resize"].forEach((eventName) => {
      video.addEventListener(eventName, revealPlaySurface);
    });
  });
  if (layout) {
    const panels = [...layout.querySelectorAll(":scope > .panel")];
    panels[0]?.classList.add("wb-live-model");
    panels[1]?.classList.add("wb-scene-panel");
    panels[2]?.classList.add("wb-events-panel");
    panels[3]?.classList.add("wb-game-render-panel");
  }
  const playNav = el("aside", {className: "wb-play-nav"},
    el("div", {className: "wb-nav-brand"}, el("span", {className: "wb-nav-logo"}, "✦"), el("strong", {}, "EDEN"), el("small", {}, "CONTROL DECK")),
    el("div", {className: "wb-nav-label wb-play-projects-label"}, "PROJECTS"),
    el("div", {className: "wb-nav-item active"}, "▣", el("span", {className: "wb-play-project-name"}, "Subway Run")),
    el("div", {className: "wb-nav-label wb-play-pipeline-label"}, "PIPELINE"),
    el("div", {className: "wb-pipeline-step active"}, el("i", {}), "01  Proxy Game"),
    el("div", {className: "wb-pipeline-step active"}, el("i", {}), "02  Greybox Frame"),
    el("div", {className: "wb-pipeline-step active"}, el("i", {}), "03  Stream Render"),
    el("button", {className: "wb-btn primary wb-play-nav-again", type: "button", onClick: () => { if (target) openPlay(target, true); }}, "↻ PLAY AGAIN"));
  const endText = el("strong", {}, "");
  const endAgain = el("button", {className: "wb-btn primary wb-play-end-again", type: "button"}, "Play again");
  const endClose = el("button", {className: "wb-btn wb-play-end-close", type: "button"}, "Close");
  const endbar = el("div", {className: "wb-endbar", hidden: true}, endText, endAgain, endClose);
  const modal = el("div", {className: "wb-modal", hidden: true, role: "dialog", "aria-modal": "true", "aria-label": "Play"},
    el("div", {className: "wb-modal-box"},
      el("header", {className: "wb-control-head"},
        el("div", {className: "wb-brand-lockup"}, el("strong", {}, "EDENLIVE"), el("small", {}, "REALTIME WORKBENCH")),
        el("div", {className: "wb-control-title"}, modalTitle, el("div", {className: "wb-sub wb-play-sub"}, "")),
        el("span", {className: "wb-connection wb-play-live"}, ""), closeBtn),
    stage));
  stage.prepend(playNav);
  const playCover = el("img", {alt: ""});
  playNav.querySelector(".wb-nav-item").firstChild.replaceWith(playCover);
  const metricCards = {};
  const metricNames = {
    latency: "NETWORK RTT",
    gpu: "GPU MEM",
    webrtc: "WEBRTC FPS",
    model: "MODEL FPS",
  };
  const metricValue = (key, value, detail = "") => {
    const card = metricCards[key];
    if (!card) return;
    card.querySelector("b").textContent = value;
    card.title = detail || "Waiting for data";
  };
  if (layout) {
    layout.querySelector(".wb-scene-panel")?.append(keys);
    layout.append(el("div", {className: "wb-play-tag"}, "03 / PLAY LIVE"));
    layout.append(el("div", {className: "wb-play-metrics"},
      ...Object.keys(metricNames).map((key) => {
        const card = el("div", {}, el("span", {}, ""), el("b", {}, "—"));
        metricCards[key] = card;
        return card;
      })));
  }
  // Outside the modal: the page's panes sit above the modal's stacking context.
  document.body.append(modal, endbar);

  const applyPlayLanguage = () => {
    Object.entries(metricNames).forEach(([key, name]) => {
      const card = metricCards[key];
      if (card) card.querySelector("span").textContent = name;
    });
    modal.querySelector(".wb-play-sub").textContent = "Proxy Session · Streaming model render";
    modal.querySelector(".wb-play-live").textContent = loading.hidden ? "● LIVE" : "● CONNECTING";
    if (!loading.hidden) say(loadNote, "The first video chunk can take a few dozen seconds.");
    const panelTitles = [
      [".wb-live-model .panel-title", "● LIVE · PROXY → MODEL"],
      [".wb-scene-panel .panel-title", "PROMPT / CONTROLS"],
      [".wb-events-panel .panel-title", "Event timeline"],
      [".wb-game-render-panel .panel-title", "Game render"],
    ];
    panelTitles.forEach(([selector, title]) => {
      const node = layout?.querySelector(selector);
      if (node) node.textContent = title;
    });
    if (endText.textContent) {
      const won = endText.dataset.state === "WON";
      endText.textContent = won ? "You won." : "Round over.";
    }
  };
  applyPlayLanguage();

  let metricsTimer = null;
  let metricsEpoch = 0;
  let metricsBusy = false;
  const resetMetrics = () => {
    Object.keys(metricNames).forEach((key) => metricValue(key, "—"));
  };
  const stopMetrics = () => {
    metricsEpoch += 1;
    clearInterval(metricsTimer);
    metricsTimer = null;
  };
  const pollMetrics = async (epoch) => {
    if (metricsBusy || modal.hidden || !target) return;
    metricsBusy = true;
    try {
      const [browserResult, modelResult] = await Promise.allSettled([
        typeof window.flashdreamsWebRTCStats === "function"
          ? window.flashdreamsWebRTCStats() : Promise.resolve(null),
        call("/ext/game2v/metrics"),
      ]);
      if (epoch !== metricsEpoch || modal.hidden || !target) return;
      const browser = browserResult.status === "fulfilled" ? browserResult.value : null;
      const rtt = browser?.connected ? browser.rtt_ms : null;
      const receiveFps = browser?.connected ? browser.receive_fps : null;
      metricValue("latency", Number.isFinite(rtt) ? `${Math.round(rtt)} ms` : "—",
        "WebRTC network round-trip time");
      metricValue("webrtc", Number.isFinite(receiveFps) ? `${receiveFps.toFixed(1)} fps` : "—",
        "Video frames received and decoded by the browser");
      const model = modelResult.status === "fulfilled" ? modelResult.value?.model : null;
      if (model?.slug === target.slug && Number.isFinite(model.age_s) && model.age_s < 120) {
        metricValue("model", Number.isFinite(model.chunk_fps) ? `${model.chunk_fps.toFixed(1)} fps` : "—",
          Number.isFinite(model.model_step_ms)
            ? `Latest model chunk: ${Math.round(model.model_step_ms)} ms`
            : "");
        const used = model.gpu_memory_used_gib;
        const total = model.gpu_memory_total_gib;
        metricValue("gpu", Number.isFinite(used) ? `${used.toFixed(1)} GiB` : "—",
          Number.isFinite(used) && Number.isFinite(total)
            ? `GPU memory used: ${used.toFixed(1)} / ${total.toFixed(1)} GiB`
            : "GPU memory data unavailable");
      } else {
        metricValue("gpu", "—", "Waiting for the first model chunk");
        metricValue("model", "—", "Waiting for the first model chunk");
      }
    } finally {
      metricsBusy = false;
    }
  };
  const startMetrics = () => {
    stopMetrics();
    resetMetrics();
    metricsBusy = false;
    const epoch = metricsEpoch;
    void pollMetrics(epoch);
    metricsTimer = setInterval(() => { void pollMetrics(epoch); }, POLL_MS);
  };

  function openPlay(game, restart = false) {
    target = game;
    modalTitle.textContent = game.title || game.slug;
    playNav.querySelector(".wb-play-project-name").textContent = game.title || game.slug;
    playCover.src = game.cover ? `/ext/game2v/${game.cover}` : "";
    const lines = (game.controls || []).map((line) => String(line)).filter(Boolean);
    keys.replaceChildren(...lines.map((line) => el("span", {}, line)));
    keys.hidden = !lines.length;
    loadImg.src = game.cover ? `/ext/game2v/${game.cover}?t=${Date.now()}` : "";
    say(loadNote, "The first video chunk can take a few dozen seconds.");
    loading.hidden = false;
    applyPlayLanguage();
    showTransportError();
    endbar.hidden = true;
    modal.hidden = false;
    stopMetrics();
    resetMetrics();
    document.body.classList.add("wb-play", "wb-starting");
    if (layout && layoutHome) stage.append(layout);
    applyPlayLanguage();
    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => {
      if (!loading.hidden) say(loadNote, "The video is taking longer than expected. Close and retry, or check the server logs.", "error");
    }, LOAD_TIMEOUT_MS);
    // The WebRTC page can have connected media cached before this modal opens.
    // Check synchronously as well as through media events so a replayed frame
    // never leaves the workbench covered by the start card.
    if ([liveVideo, pairedVideo].some((video) => video && (video.readyState >= 2 || video.currentTime > 0))) {
      revealPlaySurface();
    }
    const requestEpoch = metricsEpoch;
    call("/ext/game2v/switch", {slug: game.slug, restart})
      .then(() => {
        if (metricsEpoch === requestEpoch && !modal.hidden && target?.slug === game.slug) startMetrics();
      })
      .catch((error) => say(loadNote, error.message, "error"));
    document.activeElement?.blur?.();
  }

  function closePlay() {
    if (modal.hidden) return;
    stopMetrics();
    resetMetrics();
    target = null;
    clearTimeout(loadTimer);
    modal.hidden = true;
    endbar.hidden = true;
    document.body.classList.remove("wb-play", "wb-starting");
    if (layout && layoutHome) layoutHome.append(layout);
    call("/ext/game2v/home", {}).catch(() => {});
  }

  // A game_ui envelope is the first proof that frames of the chosen game are
  // arriving, and its state field is how a finished round is recognised.
  window.addEventListener("game2v-ui", (event) => {
    const payload = event.detail;
    if (payload?.type !== "game_ui" || modal.hidden) return;
    if (payload.slug && target && payload.slug !== target.slug) return;
    // Older sessions may replay a game_ui envelope without its slug. Once it
    // reaches the active page it still proves that the selected round is live.
    revealPlaySurface();
    const phase = payload.state?.state ?? "";
    const over = !OPEN_STATES.has(phase);
    endbar.hidden = !over || !loading.hidden;
    if (over) {
      endText.dataset.state = phase;
      endText.textContent = phase === "WON" ? "You won." : "Round over.";
    }
  });

  // "Again" rewinds the rollout to the first frame. The game's own restart key
  // would only reset its simulation, leaving the video on the finished round.
  const again = () => { if (target) openPlay(target, true); };
  againBtn.addEventListener("click", again);
  endAgain.addEventListener("click", again);
  closeBtn.addEventListener("click", closePlay);
  endClose.addEventListener("click", closePlay);

  // ---- routing ------------------------------------------------------------
  function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  async function route() {
    const match = location.hash.match(/^#\/studio\/([^/]+)$/);
    clearInterval(polling);
    if (!match) {
      gallery.hidden = false; studio.hidden = true;
      await Promise.all([refreshGames().catch((error) => say(galleryNote, error.message, "error")), refreshConversations()]);
      renderGallery();
      return;
    }
    gallery.hidden = true; studio.hidden = false;
    if (match[1] === "new") {
      try {
        const created = await call(`${API}/api/conversations`, {});
        history.replaceState(null, "", `#/studio/${created.id}`);
        openConversation(created);
      } catch (error) {
        openConversation(null);
        say(chatNote, `${"Unable to connect to the workbench service"}: ${error.message}`, "error");
      }
      return;
    }
    try { openConversation(await call(`${API}/api/conversations/${match[1]}`)); }
    catch (error) { openConversation(null); say(chatNote, error.message, "error"); }
  }

  // ---- studio behaviour -----------------------------------------------------
  const image = (name) => `${API}/image/${conversation.slug}/${name}?t=${Date.now()}`;
  const running = () => conversation?.messages.find((message) => message.status === "running");
  const ready = () => Boolean(conversation?.slug && games.some((game) => game.slug === conversation.slug));

  function openConversation(next) {
    conversation = next;
    selected = null;
    say(chatNote, "");
    if (next) remember({conversation: next.id});
    refreshGames().catch(() => {}).finally(() => {
      paintChat();
      paintSide(true);
      const job = running();
      if (job) watch(job);
    });
  }

  // A build walks four stages; the log names the one Claude is in. Anything
  // before the first marker is intake, which the log never names explicitly.
  const PHASES = [["scene", "Scene"], ["behavior", "Behavior"], ["acceptance", "Acceptance"]];

  function phaseOf(text) {
    const found = text.match(/\b(scene|behavior|acceptance)\b/);
    return found ? found[1] : null;
  }

  // The bridge prefixes every Claude line: "say  " for its own words, "tool "
  // for a tool call, "log  " for anything unparsed, "done " for the finish.
  function traceEntries(log) {
    const entries = [];
    let phase = "intake";
    for (const raw of log || []) {
      const line = String(raw);
      const text = line.replace(/^\d\d:\d\d:\d\d\s/, "");
      const stamp = line.slice(0, 8);
      const marker = text.startsWith("tool ") || text.startsWith("log  ");
      const named = marker ? phaseOf(text) : null;
      if (named && named !== phase) {
        phase = named;
        entries.push({kind: "phase", phase, stamp});
      }
      const body = text.replace(/^(say|tool|log)\s{2}/, "");
      const kind = text.startsWith("say  ") ? "say" : text.startsWith("tool ") ? "tool" : "note";
      entries.push({kind, phase, text: body, stamp});
    }
    return entries;
  }

  function renderTrace(log, settled = false) {
    const entries = traceEntries(log);
    const trace = el("div", {className: "wb-trace"});
    const groups = new Map();
    const groupFor = (name) => {
      let body = groups.get(name);
      if (body) return body;
      const phase = PHASES.find(([key]) => key === name);
      const label = name === "intake" ? "Brief" : (phase ? phase[1] : name);
      body = el("div", {className: "body"});
      trace.append(el("div", {className: "wb-phase", "data-phase": name},
        el("div", {className: "head"}, el("span", {className: "dot"}), el("b", {}, label), el("span", {className: "wb-note-line"})),
        body));
      groups.set(name, body);
      return body;
    };
    for (const entry of entries) {
      if (entry.kind === "phase") continue;
      const row = entry.kind === "say" ? el("div", {className: "wb-say"}, entry.text)
        : entry.kind === "tool" ? el("div", {className: "wb-tool"}, entry.text)
        : el("div", {className: "wb-note-line"}, `${entry.stamp}  ${entry.text}`);
      groupFor(entry.phase).append(row);
    }
    const phases = [...trace.querySelectorAll(".wb-phase")];
    phases.forEach((node, index) => node.classList.add(!settled && index === phases.length - 1 ? "current" : "done"));
    return trace;
  }

  function renderMessageTrace(message) {
    const log = message.log || [];
    const settled = message.status !== "running";
    const details = el("details", {className: "wb-trace-details"});
    // Running jobs stay open so Claude's output is visible as it arrives;
    // completed jobs stay compact until the user asks for the full trace.
    details.open = !settled;
    const entries = traceEntries(log);
    const summary = el("summary", {},
      settled ? "View Claude details" : "Live Claude output",
      el("span", {className: "wb-detail-count"}, `${entries.filter((entry) => entry.kind !== "phase").length} records`));
    if (!settled) summary.append(el("span", {className: "wb-spin", "aria-hidden": "true"}));
    details.append(summary);
    if (!settled) details.append(el("div", {className: "wb-progress", "aria-label": "Build progress"}, el("i")));
    details.append(renderTrace(log, settled));
    return details;
  }

  function paintChat() {

    const messages = conversation?.messages ?? [];
    studio.classList.toggle("focus-start", !messages.length);
    chatTitle.textContent = conversation?.title || "New game";
    chatSub.textContent = conversation?.slug ? `Project: ${conversation.slug}` : "No project yet";
    if (!messages.length) { msgs.replaceChildren(empty); }
    else {
      msgs.replaceChildren(...messages.map((message) => {
        if (message.role === "user") return el("div", {className: "wb-msg user"}, message.text);
        const trace = renderMessageTrace(message);
        if (message.status === "running") {
          return el("div", {className: "wb-msg assistant", "data-job": message.job},
            el("div", {className: "state"}, el("span", {className: "wb-spin", "aria-hidden": "true"}),
              message.kind === "revision" ? "Updating the game…" : "Building the game; this can take a few minutes…"),
            trace);
        }
        if (message.status === "failed" || message.status === "cancelled") {
          return el("div", {className: "wb-msg assistant error"},
            message.status === "cancelled" ? "Cancelled." : `${"Build failed"}: ${message.error || "Unknown error"}`,
            el("div", {className: "state"}, "Try another description."),
            trace);
        }
        return el("div", {className: "wb-msg assistant"},
          message.text || (message.kind === "revision" ? "Updated." : "The game is ready; you can play it on the right."),
          trace);
      }));
    }
    msgs.scrollTop = msgs.scrollHeight;
    const busy = Boolean(running());
    const buildProxy = studio.querySelector(".wb-build-proxy");
    const buildClaude = studio.querySelector(".wb-build-claude");
    const buildProgress = studio.querySelector(".wb-build-status .wb-progress");
    if (buildProxy) buildProxy.textContent = ready() ? "READY" : (busy ? "BUILDING" : "—");
    if (buildClaude) buildClaude.textContent = busy ? "LIVE" : (messages.length ? "READY" : "IDLE");
    if (buildProgress) buildProgress.hidden = !busy;
    const detailLines = studio.querySelectorAll(".wb-claude-line");
    if (detailLines.length) {
      const status = busy ? "Reading game brief" : (messages.length ? "Build complete" : "Waiting for a game brief");
      detailLines[0].textContent = status;
      detailLines[0].dataset.live = "true";
      detailLines[1].textContent = busy ? "Writing scene modules" : "Scene and behavior modules";
      detailLines[1].dataset.live = "true";
      detailLines[2].textContent = busy ? "Running acceptance checks" : "Acceptance checks will follow";
      detailLines[2].dataset.live = "true";
    }
    input.disabled = !conversation || busy;
    send.disabled = !conversation || busy;
    cancel.hidden = !busy;
    input.placeholder = ready()
      ? "Tell me how to change this game…"
      : "Describe the game you want to build…";
    playBtn.disabled = !ready();
  }

  function showTab(next) {
    tab = next;
    if (next === "frame") {
      studio.classList.add("focus-frame");
      updateChatZoomLabel();
    }
    tabProxy.setAttribute("aria-selected", String(next === "proxy"));
    tabFrame.setAttribute("aria-selected", String(next === "frame"));
    proxyPane.hidden = next !== "proxy";
    framePane.hidden = next !== "frame";
    reload.hidden = next !== "proxy";
    if (next === "frame" && ready()) loadFrameTab().catch((error) => say(frameNote, error.message, "error"));
  }

  function paintSide(reloadProxy) {
    const has = ready();
    proxyEmpty.hidden = has;
    proxyFrame.hidden = !has;
    if (!has) proxyFrame.removeAttribute("src");
    else if (reloadProxy || !proxyFrame.getAttribute("src")) {
      proxyFrame.src = `/ext/game2v/play/${encodeURIComponent(conversation.slug)}?v=${Date.now()}`;
    }
    frameEmpty.hidden = has;
    frameBody.hidden = !has;
    if (running() && !has) {
      proxyEmpty.querySelector("strong").textContent = "Game is being built";
      proxyEmpty.querySelector("span").textContent = "It will appear here when ready";
    } else {
      proxyEmpty.querySelector("strong").textContent = "No game output yet";
      proxyEmpty.querySelector("span").textContent = "Describe a game on the left to start building";
    }
    showTab(tab);
  }

  reload.addEventListener("click", () => paintSide(true));

  async function sendMessage() {
    const text = input.value.trim();
    if (!text || !conversation) return;
    send.disabled = true;
    try {
      const reply = await call(`${API}/api/conversations/${conversation.id}/messages`, {text});
      input.value = "";
      conversation = reply.conversation;
      paintChat();
      paintSide(false);
      watch(running());
    } catch (error) {
      say(chatNote, error.message, "error");
      send.disabled = false;
    }
  }

  send.addEventListener("click", sendMessage);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendMessage(); }
  });
  cancel.addEventListener("click", async () => {
    const job = running();
    if (job) await call(`${API}/api/jobs/${job.job}/cancel`, {}).catch((error) => say(chatNote, error.message, "error"));
  });

  function watch(message) {
    clearInterval(polling);
    if (!message?.job) return;
    let offset = 0;
    const id = conversation.id;
    const tick = async () => {
      let job;
      try { job = await call(`${API}/api/jobs/${message.job}?since=${offset}`); }
      catch (error) { say(chatNote, error.message, "error"); return; }
      if (job.log.length) {
        message.log = (message.log || []).concat(job.log);
        const holder = msgs.querySelector(`.wb-msg[data-job="${message.job}"] .wb-trace-details`);
        const atBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 40;
        if (holder) {
          // Refresh the summary as well as the trace so the live record count
          // and progress affordance stay in sync. Preserve the user's choice
          // when they expand/collapse the Claude output while it is streaming.
          const open = holder.open;
          const next = renderMessageTrace(message);
          next.open = open;
          holder.replaceWith(next);
        }
        if (atBottom) msgs.scrollTop = msgs.scrollHeight;
      }
      offset = job.log_total;
      if (job.status === "running") return;
      clearInterval(polling);
      if (conversation?.id !== id) return;
      // The bridge writes the reply into the conversation when the job ends.
      conversation = await call(`${API}/api/conversations/${id}`).catch(() => conversation);
      await refreshGames().catch(() => {});
      paintChat();
      paintSide(true);
      if (job.status === "succeeded" && job.kind === "revision") {
        say(frameNote, "The game was updated and its greybox frame refreshed. Generate a new caption and render the first frame.", "warn");
      }
    };
    polling = setInterval(tick, POLL_MS);
    tick();
  }

  // ---- realistic first frame ------------------------------------------------
  function pick(name) {
    selected = name;
    if (name) fineImg.src = image(name); else fineImg.removeAttribute("src");
    for (const button of thumbs.children) button.setAttribute("aria-pressed", String(button.dataset.name === name));
    acceptBtn.disabled = !name;
  }

  function addThumb(name) {
    if ([...thumbs.children].some((button) => button.dataset.name === name)) return;
    thumbs.append(el("button", {type: "button", "data-name": name, "aria-pressed": "false", "aria-label": `Candidate ${name}`,
      onClick: () => pick(name)}, el("img", {src: image(name), alt: ""})));
  }

  async function loadFrameTab() {
    const files = await call(`${API}/api/games/${conversation.slug}`);
    coarseImg.src = image(files.coarse);
    if (!caption.value || caption.dataset.slug !== conversation.slug) caption.value = files.caption || "";
    caption.dataset.slug = conversation.slug;
    thumbs.replaceChildren();
    const stale = new Set(files.fines_stale || []);
    for (const name of files.fines.filter((name) => !stale.has(name))) addThumb(name);
    pick(selected && files.fines.includes(selected) && !stale.has(selected) ? selected : null);
    if (!selected) fineImg.removeAttribute("src");
    if (files.cover_is_greybox && !frameNote.textContent) {
      say(frameNote, "Play currently uses the greybox screenshot as its first frame. Render a realistic frame and use it as the first frame for better results.", "warn");
    }
  }

  function frameBusy(on) {
    captionBtn.disabled = renderBtn.disabled = on;
    captionStyle.disabled = on;
    acceptBtn.disabled = on || !selected;
  }

  captionStyle.addEventListener("change", () => {
    remember({captionStyle: captionStyle.value});
    say(frameNote, "Generate a new caption to apply this style. Render uses the text currently in the caption box.");
  });

  captionBtn.addEventListener("click", async () => {
    frameBusy(true);
    say(frameNote, `Claude is writing a ${captionStyle.selectedOptions[0].text} caption from the greybox frame…`);
    try {
      let job = await call(`${API}/api/games/${conversation.slug}/caption`, {style: captionStyle.value});
      while (job.status === "running") {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        job = await call(`${API}/api/jobs/${job.id}?since=${job.log_total ?? 0}`);
      }
      if (job.status !== "succeeded") throw new Error(job.error || job.status);
      caption.value = job.result.caption;
      say(frameNote, "Caption is ready. Edit it if needed, then click Render.");
    } catch (error) { say(frameNote, `${"Caption failed"}: ${error.message}`, "error"); }
    finally { frameBusy(false); }
  });

  renderBtn.addEventListener("click", async () => {
    if (!caption.value.trim()) return say(frameNote, "Generate or write a caption first.", "error");
    frameBusy(true);
    say(frameNote, "FLUX is rendering; this usually takes about 15 seconds…");
    try {
      const result = await call(`${API}/render`, {slug: conversation.slug, caption: caption.value, seed: Number(seed.value) || 0});
      addThumb(result.image);
      pick(result.image);
      say(frameNote, `Rendered in ${result.seconds} seconds. Try another seed or click “Use as first frame”.`);
    } catch (error) { say(frameNote, error.message, "error"); }
    finally { frameBusy(false); }
  });

  acceptBtn.addEventListener("click", async () => {
    frameBusy(true);
    try {
      await call(`${API}/api/games/${conversation.slug}/accept`, {image: selected, caption: caption.value});
      await refreshGames().catch(() => {});
      say(frameNote, `${selected} is now the first frame. Click “Play” to start rendering.`);
    } catch (error) { say(frameNote, error.message, "error"); }
    finally { frameBusy(false); }
  });

  playBtn.addEventListener("click", () => {
    const game = games.find((item) => item.slug === conversation?.slug);
    if (game) openPlay(game);
  });

  window.addEventListener("hashchange", () => { closePlay(); route(); });
  route();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
