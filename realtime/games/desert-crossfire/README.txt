Desert Crossfire

A desert courtyard combat proxy. Clear eight enemies and reach the extraction marker.

Access
------
Start Game2V using the deployment instructions in ../../README.md, then select
Desert Crossfire in the workbench. The proxy preview route on the running model app is:
/ext/game2v/play/desert-crossfire

Controls and mechanics
----------------------
WASD: move; arrows: aim; F: fire; R: reload; E: flashbang; Space: jump.
Manage magazine ammunition and reserve rounds. Walls block shots and flashes. Defeating all enemies is followed by an extraction objective.

The game runs a deterministic 24 Hz simulation. The generated video may lag
behind live input and HUD state; proxy geometry defines collisions and rules.

Files and checks
----------------
game.js: simulation, replay state and condition prompts.
scene.js: proxy geometry, camera and visual effects.
adapter.js: application configuration, controls and status displays.
main.js: runtime entry point.

From the repository root:
node realtime/games/tests/desert-crossfire.mjs

Licensing
---------
See ../../LICENSE, ../../NOTICE and ../../THIRD-PARTY-NOTICES for code licensing.
The sample name does not establish authorization to use third-party characters
or imagery. Image provenance and any required permissions must be verified
separately before publishing the bundled artwork.
