Deepwater Shock

An underwater machine-room combat proxy. Clear four enemies using a wrench, electrical attacks and conductive water.

Access
------
Start Game2V using the deployment instructions in ../../README.md, then select
Deepwater Shock in the workbench. The proxy preview route on the running model app is:
/ext/game2v/play/deepwater-shock

Controls and mechanics
----------------------
WASD: move; arrows: look; F: swing the wrench; E: electric attack; Space: jump.
Electrical attacks consume energy and can stun enemies. Water conducts electricity and can also hurt the player. Melee and projectiles respect solid obstacles.

The game runs a deterministic 24 Hz simulation. The generated video may lag
behind live input and HUD state; proxy geometry defines collisions and rules.

Files and checks
----------------
game.js: simulation, replay state and condition prompts.
scene.js: proxy geometry, camera and visual effects.
adapter.js: application configuration, controls and status displays.
main.js: runtime entry point.

From the repository root:
node realtime/games/tests/deepwater-shock.mjs

Licensing
---------
See ../../LICENSE, ../../NOTICE and ../../THIRD-PARTY-NOTICES for code licensing.
The sample name does not establish authorization to use third-party characters
or imagery. Image provenance and any required permissions must be verified
separately before publishing the bundled artwork.
