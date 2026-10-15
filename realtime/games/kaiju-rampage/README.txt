Kaiju Rampage

A city-destruction proxy. Destroy six defense towers while avoiding their attacks.

Access
------
Start Game2V using the deployment instructions in ../../README.md, then select
Kaiju Rampage in the workbench. The proxy preview route on the running model app is:
/ext/game2v/play/kaiju-rampage

Controls and mechanics
----------------------
WASD: move; left/right arrows: turn; up/down arrows: aim; F: breathe fire; Space: stomp.
Fire builds heat and has a cooling lockout. Stomps have a cooldown. Buildings block movement and projectiles until destroyed.

The game runs a deterministic 24 Hz simulation. The generated video may lag
behind live input and HUD state; proxy geometry defines collisions and rules.

Files and checks
----------------
game.js: simulation, replay state and condition prompts.
scene.js: proxy geometry, camera and visual effects.
adapter.js: application configuration, controls and status displays.
main.js: runtime entry point.

From the repository root:
node realtime/games/tests/kaiju-rampage.mjs

Licensing
---------
See ../../LICENSE, ../../NOTICE and ../../THIRD-PARTY-NOTICES for code licensing.
The sample name does not establish authorization to use third-party characters
or imagery. Image provenance and any required permissions must be verified
separately before publishing the bundled artwork.
