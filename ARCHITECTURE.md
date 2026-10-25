# Overall Architecture & Design Document (ARCHITECTURE.md)

This document provides a comprehensive architectural overview and implementation guide for **ojipalt** (オジパルト), a browser-based 2D physics ragdoll catapult game built with HTML5, CSS3, JavaScript (ES6), and Matter.js.

---

## 1. Project Overview & Current Status

**ojipalt** is a single-screen browser action game designed to run statically without build tools (ideal for GitHub Pages).

### Core Game Flow:
1. **Catapult Launch**: On the left side of the screen, an "Ojisan" ragdoll (consisting of 5 physical body parts connected by joints) rests on a catapult sling. The player drags and releases Ojisan to launch him into the air.
2. **Randomized Target Goal**: Every round/reset randomizes the target goal location between **55m and 125m** from the catapult. The distance is displayed in the top status bar UI (`🎯 TARGET: XXm`).
3. **Mid-air Boost**: While Ojisan is airborne, clicking/tapping the screen triggers a single-use mid-air boost ("オシリブースト"), applying an upward/forward impulse and emitting particle effects.
4. **Camera Tracking & Zoom**: A dynamic wide-angle camera tracks Ojisan horizontally and vertically, zooming out to maintain visibility of both high trajectories and the ground ruler.
5. **Clear / Fail Evaluation**: Once Ojisan settles on the ground, the result is evaluated:
   - **CLEAR!**: Triggered if **any body part** of Ojisan overlaps the goal zone.
   - **FAILED...**: Displayed if no body part is inside the goal zone, with tailored feedback for falling short or overshooting.

---

## 2. File Structure & Roles

```text
.
├── index.html       # Single-page HTML shell, CDN imports (Matter.js), and UI overlay structure
├── style.css        # Responsive styling, game canvas layout, status badges, modal card overlay
├── game.js          # Main game loop, physics engine setup, ragdoll creation, camera, render hooks
└── ARCHITECTURE.md  # Architecture and handover documentation (this file)
```

### Module Responsibilities:
* **`index.html`**: Loads Matter.js via CDN (`cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js`), sets up `#canvas-wrapper`, top HUD bar, and result modal overlay.
* **`style.css`**: Provides modern dark UI backdrop, status badge styles (`#target-status`, `#boost-status`, `#game-status`), and centered result overlay popups.
* **`game.js`**:
  * Physics engine initialization & lifecycle (`Matter.Engine`, `Matter.Runner`, `Matter.Render`).
  * Object construction (`createOjisan`, static ground/walls, catapult, goal zone).
  * Control bindings (`MouseConstraint`, pointer down for boost).
  * Render loop hooks (`afterUpdate` for logic & camera, `afterRender` for custom canvas overlays).

---

## 3. Implemented Key Logic & Mechanics

### 3.1 Catapult Launch & Ragdoll Structure
* **Ragdoll Composition**: Created via `createOjisan(x, y)` with 5 physical bodies assigned to a shared collision group (`group = Body.nextGroup(true)` to avoid self-collision):
  1. Head (circle, r=18)
  2. Torso (rectangle, 28x40)
  3. Pelvis/Butt (rectangle, 26x20)
  4. Left Leg (rectangle, 12x30)
  5. Right Leg (rectangle, 12x30)
* **Joints (Constraints)**: Stiff neck, waist, left hip, and right hip constraints connect the body parts.
* **Slingshot**: An elastic `Constraint` binds the catapult post (`x=360, y=340`) to Ojisan's torso (`stiffness: 0.08`). When dragged beyond 25px and released, `launchOjisan()` detaches the sling immediately and sets `gameState = 'flying'`. Initial launch velocity is calculated purely from displacement distance and vector direction to the anchor point (`dist * LAUNCH_SPEED_FACTOR`), ignoring mouse/touch release gesture speed.

### 3.2 Dynamic Wide Camera & Zoom-Out
* **Viewport vs View Bounds**:
  * Render element resolution: `960 x 540` (`VIEW_WIDTH`, `VIEW_HEIGHT`).
  * Camera virtual world bounds: `1440 x 810` (`VIEW_BOUNDS_WIDTH`, `VIEW_BOUNDS_HEIGHT`).
  * Y-axis bounds: `CAMERA_MIN_Y = -240` to `CAMERA_MAX_Y = 570`.
* **Smooth Follow**: `updateCameraPosition()` smoothly interpolates `cameraX` towards centering Ojisan's torso at `cameraX = torso.x - 1440 * 0.3`.
* **Mouse Coordinate Synchronization**: Because the world bounds are scaled up (`1440x810` rendered into `960x540`), mouse input is continuously updated every frame:
  ```javascript
  Mouse.setScale(mouse, { x: VIEW_BOUNDS_WIDTH / VIEW_WIDTH, y: VIEW_BOUNDS_HEIGHT / VIEW_HEIGHT });
  Mouse.setOffset(mouse, { x: render.bounds.min.x, y: render.bounds.min.y });
  ```

### 3.3 Goal Randomization & UI Badge
* On game setup (`setupWorld()`), goal distance in meters is calculated randomly:
  ```javascript
  const randomMeters = Math.floor(Math.random() * (125 - 55 + 1)) + 55;
  GOAL_X = CATAPULT_X + randomMeters * PIXELS_PER_METER; // PIXELS_PER_METER = 30
  ```
* Top bar badge updates with `🎯 TARGET: ${randomMeters}m`.

### 3.4 Mid-air Boost Mechanism
* **Single-use flag**: `boostUsed` tracks availability. `boostStatusEl` switches to `BOOST: USED`.
* **Impulse**: Clicking/tapping during `flying` state calculates Ojisan's pelvis-to-head direction vector and applies forward/upward velocity overrides and forces to all body parts.
* **Particle Visuals**: Spawns subtle decaying particles at Ojisan's pelvis.
* **No Text Banner**: As requested, screen text popups ("BOOST!") during flight have been removed to keep the viewport clean.

### 3.5 Clear / Fail Evaluation
* Triggered in `updateGameLoop()` when average speed of all ragdoll parts drops below `0.25`.
* **Relaxed Clear Rule**:
  ```javascript
  const partInGoal = (part) => {
    const pos = part.position;
    return pos.x >= goalLeft && pos.x <= goalRight && pos.y >= goalTop && pos.y <= goalBottom;
  };
  const isClear = ojisanRagdoll.bodies.some(part => partInGoal(part));
  ```
* Fail overlay differentiates between falling short (` finalMeters < targetMeters `) and overshooting (` finalMeters > targetMeters `).

### 3.6 Ground Ruler Meter Drawing
* Drawn in `customRender()` hook using canvas context transformation:
  ```javascript
  const scaleX = VIEW_WIDTH / VIEW_BOUNDS_WIDTH;
  const scaleY = VIEW_HEIGHT / VIEW_BOUNDS_HEIGHT;
  ctx.save();
  ctx.scale(scaleX, scaleY);
  ctx.translate(-cameraX, -CAMERA_MIN_Y);
  ```
* **Tick Spacing**: Minor ticks every 5m (`meters % 5 === 0`), major ticks with legible numerical labels every 10m (`meters % 10 === 0`).

---

## 4. Known Issues & Future Improvement Points

1. **Matter.js Bounds Context Handling**:
   - `customRender()` applies custom camera scaling (`scaleX`, `scaleY`) and translation (`-cameraX`, `-CAMERA_MIN_Y`) inside `afterRender`. If modifying `Render.create` options or viewport sizes in future iterations, ensure `ctx.save()` and `ctx.restore()` surround custom canvas overlays to prevent matrix leaks.
2. **High Speed Wall Collision Penetration**:
   - Extremely high slingshot forces combined with mid-air boost may occasionally push small bodies past `rightWall` or `ceiling` if physics step sub-iterations (`engine.positionIterations`) are default. Increasing `positionIterations` and `velocityIterations` can prevent tunneling at extreme speeds.
3. **Mobile Touch Control Tuning**:
   - Mouse events work via Pointer Events on desktop and mobile browsers, but mobile touch scrolling/pull-to-refresh on body should be prevented via CSS `touch-action: none` on `#canvas-wrapper` if wrapping in mobile webviews.
