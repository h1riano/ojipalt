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
  const WORLD_WIDTH = 2500;
  const CATAPULT_X = 160;
  const CATAPULT_Y = 360;
  const GOAL_X = 1900;
  const GOAL_Y = 480;
  const GOAL_WIDTH = 180;
  const GOAL_HEIGHT = 20;
  const PIXELS_PER_METER = 30; // 30px = 1m

  // DOM Elements
  const canvasWrapper = document.getElementById('canvas-wrapper');
  const boostStatusEl = document.getElementById('boost-status');
  const gameStatusEl = document.getElementById('game-status');
  const retryBtn = document.getElementById('retry-btn');
  const overlayRetryBtn = document.getElementById('overlay-retry-btn');
  const resultOverlay = document.getElementById('result-overlay');
  const resultCard = document.getElementById('result-card');
  const resultTitle = document.getElementById('result-title');
  const resultMessage = document.getElementById('result-message');
  const boostEffectIndicator = document.getElementById('boost-effect-indicator');

  // Game States: 'aiming', 'flying', 'settled', 'clear', 'failed'
  let gameState = 'aiming';
  let boostUsed = false;
  let isDragging = false;
  let cameraX = 0;

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

    // Camera reset
    cameraX = 0;
    updateCameraPosition();

    // Ground spanning entire world width
    ground = Bodies.rectangle(WORLD_WIDTH / 2, 510, WORLD_WIDTH + 1000, 60, {
      isStatic: true,
      label: 'ground',
      render: { fillStyle: '#4a7c59' }
    });

    const leftWall = Bodies.rectangle(-20, VIEW_HEIGHT / 2, 40, VIEW_HEIGHT * 2, {
      isStatic: true
    });
    const rightWall = Bodies.rectangle(WORLD_WIDTH + 100, VIEW_HEIGHT / 2, 40, VIEW_HEIGHT * 2, {
      isStatic: true
    });
    const ceiling = Bodies.rectangle(WORLD_WIDTH / 2, -600, WORLD_WIDTH * 2, 40, {
      isStatic: true
    });

    // Goal Zone Area
    goalZone = Bodies.rectangle(GOAL_X, GOAL_Y, GOAL_WIDTH, GOAL_HEIGHT, {
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

    // Setup Mouse Controls safely (Re-bind mouse constraint on every reset to fix retry drag issue)
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
        // Check if dragged body is part of Ojisan
        if (ojisanRagdoll && ojisanRagdoll.bodies.includes(body)) {
          isDragging = true;
        }
      }
    });

    Events.on(mouseConstraint, 'enddrag', () => {
      if (gameState === 'aiming' && isDragging) {
        isDragging = false;
        // Check drag distance from catapult origin
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

    // Release elastic constraint after a brief moment to simulate sling release
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

  // Single-use Mid-Air Boost (Adjusted to behave like a controlled 2nd jump / direction shift)
  function triggerBoost() {
    boostUsed = true;
    boostStatusEl.textContent = 'BOOST: USED';
    boostStatusEl.className = 'status-badge boost-used';

    // Show visual effect indicator banner
    if (boostEffectIndicator) {
      boostEffectIndicator.classList.remove('hidden');
      boostEffectIndicator.classList.add('active');
      setTimeout(() => {
        boostEffectIndicator.classList.remove('active');
        setTimeout(() => boostEffectIndicator.classList.add('hidden'), 300);
      }, 800);
    }

    // Calculate Ojisan's pelvis to head direction vector
    const pelvisPos = ojisanRagdoll.pelvis.position;
    const torsoPos = ojisanRagdoll.torso.position;
    const headPos = ojisanRagdoll.head.position;

    let dir = Vector.sub(headPos, pelvisPos);
    let mag = Vector.magnitude(dir);
    if (mag === 0) {
      dir = { x: 0.8, y: -0.6 };
    } else {
      dir = Vector.normalise(dir);
    }

    // Softened impulse for a smooth 2nd-jump / mid-air direction shift
    const boostForceX = 0.05 + Math.max(0, dir.x * 0.04);
    const boostForceY = -0.07; // Upward jump boost

    const forceVector = { x: boostForceX, y: boostForceY };

    // Set gentle velocity boost and apply controlled force across body parts
    ojisanRagdoll.bodies.forEach(part => {
      // Gentle velocity adjustment
      Body.setVelocity(part, {
        x: Math.min(part.velocity.x + 5, 14),
        y: Math.min(part.velocity.y - 6, -4)
      });
      Body.applyForce(part, part.position, forceVector);
    });

    // Create subtle particles at pelvis location
    for (let i = 0; i < 12; i++) {
      boostParticleEffects.push({
        x: pelvisPos.x,
        y: pelvisPos.y,
        vx: (Math.random() - 0.5) * 6 - forceVector.x * 20,
        vy: (Math.random() - 0.5) * 6 - forceVector.y * 20,
        size: Math.random() * 10 + 4,
        life: 1.0,
        color: ['#ff4500', '#ff8c00', '#ffd700', '#ffffff'][Math.floor(Math.random() * 4)]
      });
    }
  }

  // Camera tracking helper
  function updateCameraPosition() {
    if (ojisanRagdoll && ojisanRagdoll.torso) {
      const torsoX = ojisanRagdoll.torso.position.x;
      // Target cameraX centers torso in the left-center of screen
      const targetCameraX = Math.max(0, Math.min(WORLD_WIDTH - VIEW_WIDTH, torsoX - VIEW_WIDTH * 0.35));
      // Smooth camera interpolation
      cameraX += (targetCameraX - cameraX) * 0.1;
    } else {
      cameraX = 0;
    }

    Bounds.shift(render.bounds, { x: cameraX, y: 0 });
  }

  // Main Loop Game Logic Update
  function updateGameLoop() {
    // Update camera follow
    updateCameraPosition();

    // Update boost particles
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
      // Check overall speed of ragdoll
      let totalSpeed = 0;
      ojisanRagdoll.bodies.forEach(b => {
        totalSpeed += b.speed;
      });

      const avgSpeed = totalSpeed / ojisanRagdoll.bodies.length;

      // Check if settled (stopped moving significantly)
      if (avgSpeed < 0.25) {
        gameState = 'settled';
        evaluateResult();
      }
    }
  }

  // Evaluate Win / Fail Condition
  function evaluateResult() {
    const torsoPos = ojisanRagdoll.torso.position;
    const pelvisPos = ojisanRagdoll.pelvis.position;
    const headPos = ojisanRagdoll.head.position;

    const inGoalX = (pos) => pos.x >= GOAL_X - GOAL_WIDTH / 2 && pos.x <= GOAL_X + GOAL_WIDTH / 2;
    const inGoalY = (pos) => pos.y >= GOAL_Y - 30 && pos.y <= GOAL_Y + 40;

    const isClear = (inGoalX(torsoPos) && inGoalY(torsoPos)) ||
                    (inGoalX(pelvisPos) && inGoalY(pelvisPos)) ||
                    (inGoalX(headPos) && inGoalY(headPos));

    const finalMeters = Math.max(0, Math.round((torsoPos.x - CATAPULT_X) / PIXELS_PER_METER));

    if (isClear) {
      gameState = 'clear';
      showResultOverlay(true, 'CLEAR!', `おじさんは見事にゴールエリア（${finalMeters}m）内に着地しました！おめでとう！`);
    } else {
      gameState = 'failed';
      showResultOverlay(false, 'FAILED...', `記録: ${finalMeters}m。ゴール（${Math.round((GOAL_X - CATAPULT_X) / PIXELS_PER_METER)}m）に届きませんでした。もう一度挑戦しよう！`);
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
    if (boostEffectIndicator) {
      boostEffectIndicator.classList.add('hidden');
    }

    updateUIStatus();
    setupWorld();
  }

  // Custom Drawing for Distance Meter, Ojisan Face, Goal Banner, Effects
  function customRender() {
    const ctx = render.context;

    // Render in World Coordinates (Offset by cameraX)
    ctx.save();
    ctx.translate(-cameraX, 0);

    // 1. Distance Ruler Meter along Ground
    const groundY = 480;
    const goalDistanceMeters = Math.round((GOAL_X - CATAPULT_X) / PIXELS_PER_METER);

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';

    // Draw meter ticks every 5m (150px) up to world end
    for (let meters = 0; meters <= Math.round(WORLD_WIDTH / PIXELS_PER_METER); meters += 5) {
      const x = CATAPULT_X + meters * PIXELS_PER_METER;
      if (x >= cameraX - 100 && x <= cameraX + VIEW_WIDTH + 100) {
        ctx.beginPath();
        ctx.moveTo(x, groundY);
        ctx.lineTo(x, groundY + 12);
        ctx.stroke();

        ctx.fillText(`${meters}m`, x, groundY + 24);
      }
    }
    ctx.restore();

    // 2. Goal Zone Banner & Distance Indicator
    ctx.save();
    ctx.fillStyle = '#ffcc00';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`🏁 GOAL AREA (${goalDistanceMeters}m) 🏁`, GOAL_X, GOAL_Y - 25);

    ctx.strokeStyle = '#ffffff';
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(GOAL_X - GOAL_WIDTH / 2, GOAL_Y - 20, GOAL_WIDTH, GOAL_HEIGHT + 10);
    ctx.restore();

    // 3. Catapult Sling Lines if aiming
    if (gameState === 'aiming' && elasticConstraint && elasticConstraint.bodyB) {
      ctx.save();
      ctx.strokeStyle = '#8b0000';
      ctx.lineWidth = 4;
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

    ctx.restore(); // Restore camera translation
  }

  // Start initialization when page is loaded
  window.addEventListener('load', init);
})();
