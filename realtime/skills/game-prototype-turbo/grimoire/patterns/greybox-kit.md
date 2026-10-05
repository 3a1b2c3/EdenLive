# Readable greybox presentation

Outcome: the normal player view makes the current decisions and available actions legible.
Use when intentional simple shapes fit the game or when reviewing scene readability. The complete
static scene is assembled in Stage 1; Stage 2 makes it act and Stage 3 finishes outcomes and UI.
Use the space, board or interface the game needs; no floor grid, prop quota or fixed palette is required.
Catalog environments already carry floor, stands or terrain. Do not restack concentric decorative rings,
over-tessellated cylinders or a field of unique props around a factory that already reads as that space.
Instancing or merging is not a substitute for that judgment. Complexity is a review call, not a mesh count.

## Workflow

Combine [world foundations](../../assets/catalogs/world.md), fitting
[visual factories](../../assets/catalogs/world-visuals.md) and the
[UI catalog](../../assets/catalogs/ui.md). Direct Three.js primitives and GreyboxKitFactory suit
abstract pieces, markers, simple massing and any 3D role the skill factories do not cover: a
street, lamp or gate can be boxes, cylinders and planes rather than a dense custom mesh or an
imported model. Depicted actors and scenery use suitable factories from the start; avoid building
a disposable primitive version of a factory-backed character first. Skip this fallback when a
catalog factory already represents the role. Rendering supplies no collision, navigation or triggers.

Translate scene intent into contrast, landmarks, scale and framing. SceneAtmosphere can help
with depth-heavy spaces; size view/shadow distances for actual decisions. A distant goal need
not be visible from spawn if the game provides sufficient local guidance. Freeze moving scenery
and cues for the static gate, then drive them from game state during behavior.

Give roles consistent cues, with shape/text/pose supplementing color. Rules use semantic
[interaction tags](interaction-tags.md). Zone paint normally is
not a solid; a barrier presented as solid must affect the relevant movement/shot queries.

Keep drawable and mechanical geometry aligned from shared data. Avoid coplanar surfaces that
flicker, invisible blocking and decoration hiding cells or cues.

## Verify and record

Check the player's normal view at relevant action states; add diagnostic views only to answer
remaining questions. Retain functional UI in primary evidence, especially for menu, resource,
feed and timing games. Record the inspected state, view and readability verdict with the artifact.
Readability applies throughout. [Scene review](../build/step1-static-scene.md) also checks the
concrete theme inventory; recognizable roles and composition need actual image review.

## Troubleshooting

| Symptom | Likely cause | Remedy and recheck |
| --- | --- | --- |
| The scene passes a bounds check but a decision is off-screen or unreadable | Frustum intersection was treated as proof of useful framing | Inspect the actual decision state at the player viewport; adjust framing, scale or local guidance. Recheck the needed action and a boundary view. |
| A cue exists but is hidden, clipped or too small to use | World anchoring, occlusion, fog, contrast or screen scale was not checked from the normal camera | Fix the relevant presentation cause or use a fitting interface cue. Inspect it when actionable with normal UI retained. |
| Pointer targets or labels drift after resize | Projection and input use different viewport bounds or stale camera matrices | Share current CSS bounds and update camera/projection with resize. Recheck the visible target and an actual click; use [camera aiming](camera-combat-navigation.md) for ray-based actions. |
| A custom 3D prop is an imported model or a dense sculpted mesh | A missing factory was treated as a reason to load GLTF/FBX/OBJ or author high-poly geometry | Rebuild the role from box/sphere/cylinder/capsule/plane massing or GreyboxKit; inspect silhouette and scale from the normal view |
| The playable space is a catalog arena plus stacked rings, unique prop fields or over-tessellated cylinders | Decoration was treated as completeness | Prefer the catalog environment as-is, or a few large masses and one landmark; inspect from the normal view. The gate does not count meshes. |
| The WebGL view is cropped or shifted at high DPR | `setSize` wrote CSS pixels from the drawing buffer, or `#app canvas` was left unstyled | Pin canvas CSS to 100% of `#app` and call `setSize(width, height, false)`; recheck at devicePixelRatio 2 |
