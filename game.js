// ojipalt (オジパルト) - Main Game Logic

(function () {
  // Matter.js Module Aliases
  const {
    Engine,
    Render,
    Runner,
    Bodies,
    Composite,
    Constraint,
    Mouse,
    MouseConstraint,
    Vector,
    Body,
    Events,
    Bounds
  } = Matter;

  // Constants
  const VIEW_WIDTH = 960;
  const VIEW_HEIGHT = 540;
  const CAMERA_WIDTH = 1280;   // Zoomed-out camera view width
  const CAMERA_HEIGHT = 720;   // Zoomed-out camera view height
  const WORLD_WIDTH = 4500;    // Extended world width for 60m - 130m
  const CATAPULT_X = 160;
  const CATAPULT_Y = 360;      // Standard catapult position
  const GOAL_Y = 480;
  const GOAL_WIDTH = 180;
  const GOAL_HEIGHT = 20;
  const PIXELS_PER_METER = 25; // 25px = 1m

  // DOM Elements
  const canvasWrapper = document.getElementById('canvas-wrapper');
  const targetStatusEl = document.getElementById('target-status');
  const boostStatusEl = document.getElementById('boost-status');
  const gameStatusEl = document.getElementById('game-status');
  const retryBtn = document.getElementById('retry-btn');
  const overlayRetryBtn = document.getElementById('overlay-retry-btn');
  const resultOverlay = document.getElementById('result-overlay');
  const resultCard = document.getElementById('result-card');
  const resultTitle = document.getElementById('result-title');
  const resultMessage = document.getElementById('result-message');

  // Game States: 'aiming', 'flying', 'settled', 'clear', 'failed'
  let gameState = 'aiming';
  let boostUsed = false;
  let isDragging = false;
  let cameraX = 0;
  let cameraY = -120; // Default vertical offset to balance ground level
  let targetGoalMeters = 100;
  let goalX = 2660;

  // Matter.js Engine & World references
  let engine, render, runner;
  let ojisanRagdoll = null;
  let elasticConstraint = null;
  let mouseConstraint = null;
  let mouse = null;
  let goalZone = null;
  let ground = null;
  let boostParticleEffects = [];

  // Initialize Game
  function init() {
    // Create physics engine
    engine = Engine.create({
      gravity: { x: 0, y: 1 }
    });

    // Create renderer
    render = Render.create({
      element: canvasWrapper,
      engine: engine,
      options: {
        width: VIEW_WIDTH,
        height: VIEW_HEIGHT,
        wireframes: false,
        background: '#87ceeb', // Sky blue
        hasBounds: true
      }
    });

    Render.run(render);

    // Create runner
    runner = Runner.create();
    Runner.run(runner, engine);

    // Setup world environment & objects
    setupWorld();

    // Event Listeners for Game Loop
    Events.on(engine, 'afterUpdate', updateGameLoop);
    Events.on(render, 'afterRender', customRender);

    // DOM Event Listeners
    retryBtn.addEventListener('click', resetGame);
    overlayRetryBtn.addEventListener('click', resetGame);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'r' || e.key === 'R') {
        resetGame();
      }
    });

    // Mid-air boost listener on canvas
    render.canvas.addEventListener('pointerdown', handleCanvasClick);
  }

  // Setup World Static Elements & Ragdoll
  function setupWorld() {
    Composite.clear(engine.world, false);

    // 1. Randomize Goal Distance (60m to 130m)
    targetGoalMeters = Math.floor(Math.random() * (130 - 60 + 1)) + 60;
    goalX = CATAPULT_X + targetGoalMeters * PIXELS_PER_METER;

    // Update Target UI Badge
    if (targetStatusEl) {
      targetStatusEl.textContent = `TARGET: ${targetGoalMeters}m`;
    }

    // Camera reset
    cameraX = 0;
    cameraY = -120;
    updateCameraPosition();

    // Ground spanning entire world width
    ground = Bodies.rectangle(WORLD_WIDTH / 2, 510, WORLD_WIDTH + 1000, 60, {
      isStatic: true,
      label: 'ground',
      render: { fillStyle: '#4a7c59' }
    });

    const leftWall = Bodies.rectangle(-20, CAMERA_HEIGHT / 2, 40, CAMERA_HEIGHT * 2, {
      isStatic: true
    });
    const rightWall = Bodies.rectangle(WORLD_WIDTH + 100, CAMERA_HEIGHT / 2, 40, CAMERA_HEIGHT * 2, {
      isStatic: true
    });
    const ceiling = Bodies.rectangle(WORLD_WIDTH / 2, -1200, WORLD_WIDTH * 2, 40, {
      isStatic: true
    });

    // Goal Zone Area
    goalZone = Bodies.rectangle(goalX, GOAL_Y, GOAL_WIDTH, GOAL_HEIGHT, {
      isStatic: true,
      isSensor: true,
      label: 'goalZone',
      render: { fillStyle: 'rgba(255, 215, 0, 0.4)', strokeStyle: '#ffcc00', lineWidth: 4 }
    });

    // Catapult Base Structure
    const catapultPost = Bodies.rectangle(CATAPULT_X, CATAPULT_Y + 70, 20, 100, {
      isStatic: true,
      collisionFilter: { group: -1 },
      render: { fillStyle: '#8b4513' }
    });

    // Create Ojisan Ragdoll
    ojisanRagdoll = createOjisan(CATAPULT_X, CATAPULT_Y - 20);

    // Slingshot Elastic Constraint attached to Ojisan's Torso
    elasticConstraint = Constraint.create({
      pointA: { x: CATAPULT_X, y: CATAPULT_Y - 20 },
      bodyB: ojisanRagdoll.torso,
      pointB: { x: 0, y: 0 },
      stiffness: 0.08,
      damping: 0.02,
      render: {
        visible: true,
        strokeStyle: '#ff4500',
        lineWidth: 5
      }
    });

    Composite.add(engine.world, [
      ground,
      leftWall,
      rightWall,
      ceiling,
      goalZone,
      catapultPost,
      ...ojisanRagdoll.bodies,
      ...ojisanRagdoll.constraints,
      elasticConstraint
    ]);

    // Setup Mouse Controls safely
    setupControls();
  }

  // Create 5-Part Ojisan (Ragdoll)
  function createOjisan(x, y) {
    const group = Body.nextGroup(true);

    // 1. Head
    const head = Bodies.circle(x, y - 45, 18, {
      collisionFilter: { group: group },
      friction: 0.8,
      restitution: 0.3,
      density: 0.002,
      label: 'ojisanHead',
      render: { fillStyle: '#ffdbac' } // Skin tone
    });

    // 2. Torso
    const torso = Bodies.rectangle(x, y - 10, 28, 40, {
      collisionFilter: { group: group },
      friction: 0.8,
      restitution: 0.2,
      density: 0.003,
      label: 'ojisanTorso',
      render: { fillStyle: '#3182ce' } // Blue shirt
    });

    // 3. Pelvis / Butt
    const pelvis = Bodies.rectangle(x, y + 20, 26, 20, {
      collisionFilter: { group: group },
      friction: 0.9,
      restitution: 0.2,
      density: 0.003,
      label: 'ojisanPelvis',
      render: { fillStyle: '#2b6cb0' } // Dark blue pants top
    });

    // 4. Left Leg
    const leftLeg = Bodies.rectangle(x - 8, y + 45, 12, 30, {
      collisionFilter: { group: group },
      friction: 0.9,
      restitution: 0.1,
      density: 0.002,
      label: 'ojisanLeftLeg',
      render: { fillStyle: '#2d3748' } // Dark pants
    });

    // 5. Right Leg
    const rightLeg = Bodies.rectangle(x + 8, y + 45, 12, 30, {
      collisionFilter: { group: group },
      friction: 0.9,
      restitution: 0.1,
      density: 0.002,
      label: 'ojisanRightLeg',
      render: { fillStyle: '#2d3748' } // Dark pants
    });

    // Connect Parts with Joints (Constraints)
    const neck = Constraint.create({
      bodyA: head,
      pointA: { x: 0, y: 15 },
      bodyB: torso,
      pointB: { x: 0, y: -20 },
      stiffness: 0.9,
      damping: 0.1,
      render: { visible: false }
    });

    const waist = Constraint.create({
      bodyA: torso,
      pointA: { x: 0, y: 20 },
      bodyB: pelvis,
      pointB: { x: 0, y: -10 },
      stiffness: 0.8,
      damping: 0.1,
      render: { visible: false }
    });

    const leftHip = Constraint.create({
      bodyA: pelvis,
      pointA: { x: -7, y: 8 },
      bodyB: leftLeg,
      pointB: { x: 0, y: -13 },
      stiffness: 0.7,
      damping: 0.1,
      render: { visible: false }
    });

    const rightHip = Constraint.create({
      bodyA: pelvis,
      pointA: { x: 7, y: 8 },
      bodyB: rightLeg,
      pointB: { x: 0, y: -13 },
      stiffness: 0.7,
      damping: 0.1,
      render: { visible: false }
    });

    return {
      head,
      torso,
      pelvis,
      leftLeg,
      rightLeg,
      bodies: [head, torso, pelvis, leftLeg, rightLeg],
      constraints: [neck, waist, leftHip, rightHip]
    };
  }

  // Setup Mouse Interaction safely
  function setupControls() {
    if (mouseConstraint) {
      Composite.remove(engine.world, mouseConstraint);
    }

    mouse = Mouse.create(render.canvas);
    Mouse.setScale(mouse, {
      x: CAMERA_WIDTH / VIEW_WIDTH,
      y: CAMERA_HEIGHT / VIEW_HEIGHT
    });

    mouseConstraint = MouseConstraint.create(engine, {
      mouse: mouse,
      constraint: {
        stiffness: 0.2,
        render: { visible: true, strokeStyle: '#ffcc00' }
      }
    });

    Composite.add(engine.world, mouseConstraint);
    render.mouse = mouse;

    Events.on(mouseConstraint, 'startdrag', (event) => {
      if (gameState === 'aiming') {
        const body = event.body;
        if (ojisanRagdoll && ojisanRagdoll.bodies.includes(body)) {
          isDragging = true;
        }
      }
    });

    Events.on(mouseConstraint, 'enddrag', () => {
      if (gameState === 'aiming' && isDragging) {
        isDragging = false;
        const torsoPos = ojisanRagdoll.torso.position;
        const dist = Vector.magnitude(Vector.sub(torsoPos, { x: CATAPULT_X, y: CATAPULT_Y - 20 }));

        if (dist > 25) {
          launchOjisan();
        }
      }
    });
  }

  // Launch Ojisan from Catapult
  function launchOjisan() {
    gameState = 'flying';
    updateUIStatus();

    setTimeout(() => {
      if (elasticConstraint) {
        Composite.remove(engine.world, elasticConstraint);
        elasticConstraint = null;
      }
    }, 80);
  }

  // Handle Air Boost Click/Tap
  function handleCanvasClick(e) {
    if (gameState !== 'flying' || boostUsed) return;
    triggerBoost();
  }

  // Single-use Mid-Air Boost (Weakened gentle nudge, no text overlay)
  function triggerBoost() {
    boostUsed = true;
    boostStatusEl.textContent = 'BOOST: USED';
    boostStatusEl.className = 'status-badge boost-used';

    const pelvisPos = ojisanRagdoll.pelvis.position;
    const headPos = ojisanRagdoll.head.position;

    let dir = Vector.sub(headPos, pelvisPos);
    let mag = Vector.magnitude(dir);
    if (mag === 0) {
      dir = { x: 0.8, y: -0.6 };
    } else {
      dir = Vector.normalise(dir);
    }

    // Weakened gentle force nudge
    const boostForceX = 0.015 + Math.max(0, dir.x * 0.015);
    const boostForceY = -0.025; // Gentle upward nudge

    const forceVector = { x: boostForceX, y: boostForceY };

    // Set gentle velocity adjustment
    ojisanRagdoll.bodies.forEach(part => {
      Body.setVelocity(part, {
        x: Math.min(part.velocity.x + 2, 11),
        y: Math.min(part.velocity.y - 2.5, -1.5)
      });
      Body.applyForce(part, part.position, forceVector);
    });

    // Create subtle particles at pelvis location
    for (let i = 0; i < 8; i++) {
      boostParticleEffects.push({
        x: pelvisPos.x,
        y: pelvisPos.y,
        vx: (Math.random() - 0.5) * 4 - forceVector.x * 10,
        vy: (Math.random() - 0.5) * 4 - forceVector.y * 10,
        size: Math.random() * 8 + 3,
        life: 0.8,
        color: ['#ff4500', '#ff8c00', '#ffd700', '#ffffff'][Math.floor(Math.random() * 4)]
      });
    }
  }

  // Camera tracking helper with Zoom-out view
  function updateCameraPosition() {
    if (ojisanRagdoll && ojisanRagdoll.torso) {
      const torsoX = ojisanRagdoll.torso.position.x;
      const torsoY = ojisanRagdoll.torso.position.y;

      const targetCameraX = Math.max(0, Math.min(WORLD_WIDTH - CAMERA_WIDTH, torsoX - CAMERA_WIDTH * 0.35));
      const targetCameraY = Math.min(-60, Math.max(-350, torsoY - CAMERA_HEIGHT * 0.65));

      cameraX += (targetCameraX - cameraX) * 0.1;
      cameraY += (targetCameraY - cameraY) * 0.1;
    } else {
      cameraX = 0;
      cameraY = -120;
    }

    render.bounds.min.x = cameraX;
    render.bounds.max.x = cameraX + CAMERA_WIDTH;
    render.bounds.min.y = cameraY;
    render.bounds.max.y = cameraY + CAMERA_HEIGHT;

    if (mouse) {
      Mouse.setOffset(mouse, render.bounds.min);
    }
  }

  // Main Loop Game Logic Update
  function updateGameLoop() {
    updateCameraPosition();

    for (let i = boostParticleEffects.length - 1; i >= 0; i--) {
      const p = boostParticleEffects[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.04;
      if (p.life <= 0) {
        boostParticleEffects.splice(i, 1);
      }
    }

    if (gameState === 'flying') {
      let totalSpeed = 0;
      ojisanRagdoll.bodies.forEach(b => {
        totalSpeed += b.speed;
      });

      const avgSpeed = totalSpeed / ojisanRagdoll.bodies.length;

      if (avgSpeed < 0.25) {
        gameState = 'settled';
        evaluateResult();
      }
    }
  }

  // Evaluate Win / Fail Condition (Relaxed: CLEAR if ANY body part touches goal zone box)
  function evaluateResult() {
    const goalLeft = goalX - GOAL_WIDTH / 2;
    const goalRight = goalX + GOAL_WIDTH / 2;
    const goalTop = GOAL_Y - 30;
    const goalBottom = GOAL_Y + 40;

    const isClear = ojisanRagdoll.bodies.some(part => {
      const pos = part.position;
      return pos.x >= goalLeft && pos.x <= goalRight && pos.y >= goalTop && pos.y <= goalBottom;
    });

    const torsoPos = ojisanRagdoll.torso.position;
    const finalMeters = Math.max(0, Math.round((torsoPos.x - CATAPULT_X) / PIXELS_PER_METER));

    if (isClear) {
      gameState = 'clear';
      showResultOverlay(true, 'CLEAR!', `おじさんは見事に目標地点（${targetGoalMeters}m）のゴールエリアに着地しました！おめでとう！`);
    } else {
      gameState = 'failed';
      showResultOverlay(false, 'FAILED...', `記録: ${finalMeters}m。目標地点（${targetGoalMeters}m）に届きませんでした。もう一度挑戦しよう！`);
    }
    updateUIStatus();
  }

  // Update UI Status Badge
  function updateUIStatus() {
    gameStatusEl.className = 'status-badge';
    if (gameState === 'aiming') {
      gameStatusEl.textContent = 'AIMING';
      gameStatusEl.classList.add('status-aiming');
    } else if (gameState === 'flying') {
      gameStatusEl.textContent = 'FLYING';
      gameStatusEl.classList.add('status-flying');
    } else if (gameState === 'clear') {
      gameStatusEl.textContent = 'CLEAR!';
      gameStatusEl.classList.add('status-clear');
    } else if (gameState === 'failed') {
      gameStatusEl.textContent = 'FAILED...';
      gameStatusEl.classList.add('status-failed');
    }
  }

  // Display Result Card
  function showResultOverlay(isClear, titleText, msgText) {
    resultTitle.textContent = titleText;
    resultMessage.textContent = msgText;
    resultCard.className = isClear ? 'clear' : 'failed';
    resultOverlay.classList.remove('hidden');
  }

  // Reset Game State
  function resetGame() {
    gameState = 'aiming';
    boostUsed = false;
    isDragging = false;

    boostStatusEl.textContent = 'BOOST: READY';
    boostStatusEl.className = 'status-badge boost-ready';

    resultOverlay.classList.add('hidden');

    updateUIStatus();
    setupWorld();
  }

  // Custom Drawing for Distance Meter, Ojisan Face, Goal Banner, Effects
  function customRender() {
    const ctx = render.context;

    // 1. Distance Ruler Meter along Ground
    const groundY = 480;

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';

    for (let meters = 0; meters <= Math.round(WORLD_WIDTH / PIXELS_PER_METER); meters += 10) {
      const x = CATAPULT_X + meters * PIXELS_PER_METER;
      if (x >= cameraX - 200 && x <= cameraX + CAMERA_WIDTH + 200) {
        ctx.beginPath();
        ctx.moveTo(x, groundY);
        ctx.lineTo(x, groundY + 16);
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillText(`${meters}m`, x, groundY + 36);
      }
    }
    ctx.restore();

    // 2. Goal Zone Banner & Distance Indicator
    ctx.save();
    ctx.fillStyle = '#ffcc00';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`🏁 GOAL AREA (${targetGoalMeters}m) 🏁`, goalX, GOAL_Y - 30);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(goalX - GOAL_WIDTH / 2, GOAL_Y - 20, GOAL_WIDTH, GOAL_HEIGHT + 10);
    ctx.restore();

    // 3. Catapult Sling Lines if aiming
    if (gameState === 'aiming' && elasticConstraint && elasticConstraint.bodyB) {
      ctx.save();
      ctx.strokeStyle = '#8b0000';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(CATAPULT_X - 10, CATAPULT_Y + 20);
      ctx.lineTo(ojisanRagdoll.torso.position.x, ojisanRagdoll.torso.position.y);
      ctx.moveTo(CATAPULT_X + 10, CATAPULT_Y + 20);
      ctx.lineTo(ojisanRagdoll.torso.position.x, ojisanRagdoll.torso.position.y);
      ctx.stroke();
      ctx.restore();
    }

    // 4. Ojisan Bald Head, Moustache, Eyes
    if (ojisanRagdoll && ojisanRagdoll.head) {
      const head = ojisanRagdoll.head;
      const pos = head.position;
      const angle = head.angle;

      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(angle);

      // Eyes
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(6, -4, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Glasses frame
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(6, -4, 5, 0, Math.PI * 2);
      ctx.stroke();

      // Moustache
      ctx.fillStyle = '#718096';
      ctx.beginPath();
      ctx.ellipse(8, 5, 7, 3, 0.2, 0, Math.PI * 2);
      ctx.fill();

      // Bald head shine
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.beginPath();
      ctx.arc(-5, -8, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    // 5. Render Boost Particles
    ctx.save();
    boostParticleEffects.forEach(p => {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  // Start initialization when page is loaded
  window.addEventListener('load', init);
})();
