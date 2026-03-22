import Matter from 'matter-js';

export interface PhysicsEngine {
  engine: Matter.Engine;
  render: Matter.Render;
  runner: Matter.Runner;
  hatch: Matter.Body;
  updateZoom: (scale: number) => void;
  getParticleCount: () => number;
  getHighestParticleY: () => number;
  spawnParticle: () => void;
  resetHatch: () => void;
  removeHatch: () => void;
  clearParticles: () => void;
  isHatchOpen: () => boolean;
  getParticles: () => Matter.Body[];
  getSpawnedCount: () => number;
  getWidth: () => number;
  getHeight: () => number;
  addParticles: (particles: Matter.Body[], shiftX: number) => void;
  destroy: () => void;
}

const COLORS = ['#fb7185', '#38bdf8', '#fbbf24', '#34d399', '#818cf8'];

export const initPhysics = (container: HTMLElement, initialParticlesSpawned = 0): PhysicsEngine => {
  const { Engine, Render, Runner, Bodies, Composite, World, Common } = Matter;

  const engine = Engine.create();
  engine.gravity.y = 0.4; // Slower, floatier gravity
  
  // Maximum iterations for extreme stacking stability and zero clipping
  engine.positionIterations = 20;
  engine.velocityIterations = 20;
  // @ts-ignore
  engine.constraintIterations = 10;

  const width = container.clientWidth;
  const height = container.clientHeight;

  const render = Render.create({
    element: container,
    engine: engine,
    options: {
      width,
      height,
      wireframes: false,
      background: '#ffffff',
      pixelRatio: 'auto' as any,
      hasBounds: true
    }
  });

  const runner = Runner.create();

  // Funnel Geometry - Matching the image's proportions
  const wallThickness = 6;
  const funnelTopY = height * 0.1;
  const funnelBottomY = height * 0.85;
  const openingWidth = width * 0.25;
  const funnelWidth = width * 0.9;

  const leftWall = Bodies.rectangle(
    width / 2 - openingWidth / 2 - (funnelWidth - openingWidth) / 4,
    (funnelTopY + funnelBottomY) / 2,
    Math.sqrt(Math.pow((funnelWidth - openingWidth) / 2, 2) + Math.pow(funnelBottomY - funnelTopY, 2)),
    wallThickness,
    {
      isStatic: true,
      angle: Math.atan2(funnelBottomY - funnelTopY, (funnelWidth - openingWidth) / 2),
      render: { fillStyle: '#000000' },
      friction: 0.001,
      restitution: 0.1
    }
  );

  const rightWall = Bodies.rectangle(
    width / 2 + openingWidth / 2 + (funnelWidth - openingWidth) / 4,
    (funnelTopY + funnelBottomY) / 2,
    Math.sqrt(Math.pow((funnelWidth - openingWidth) / 2, 2) + Math.pow(funnelBottomY - funnelTopY, 2)),
    wallThickness,
    {
      isStatic: true,
      angle: -Math.atan2(funnelBottomY - funnelTopY, (funnelWidth - openingWidth) / 2),
      render: { fillStyle: '#000000' },
      friction: 0.001,
      restitution: 0.1
    }
  );

  // Hatch (Lemmen) - Exactly opening width to flush with walls
  const hatchWidth = openingWidth;
  const hatchHeight = wallThickness; 
  const hatchX = width / 2;
  const hatchY = funnelBottomY + hatchHeight / 2;

  const hatch = Bodies.rectangle(hatchX, hatchY, hatchWidth, hatchHeight, {
    isStatic: true,
    render: { fillStyle: '#000000' },
    friction: 0.1,
    label: 'hatch'
  });

  // Invisible thick stopper below the hatch to prevent high-velocity clipping
  const hatchStopper = Bodies.rectangle(hatchX, funnelBottomY + 20, hatchWidth, 40, {
    isStatic: true,
    render: { visible: false },
    label: 'hatch-stopper'
  });

  // Ground to catch particles (much further down so they fall off-screen)
  // Wider ground to catch overflow when zoomed out
  const ground = Bodies.rectangle(width / 2, height + 1000, width * 20, 100, { 
    isStatic: true,
    render: { visible: false }
  });

  // Outer walls to keep particles in view even if they overflow the funnel
  const outerLeft = Bodies.rectangle(-width * 5, height / 2, 100, height * 20, { isStatic: true, render: { visible: false } });
  const outerRight = Bodies.rectangle(width * 6, height / 2, 100, height * 20, { isStatic: true, render: { visible: false } });

  // Cleanup loop to remove particles that fall off-screen
  Matter.Events.on(engine, 'afterUpdate', () => {
    const allBodies = Composite.allBodies(engine.world);
    // Remove particles that fall way below the funnel
    const offScreenParticles = allBodies.filter(body => 
      !body.isStatic && body.position.y > height + 1500
    );
    if (offScreenParticles.length > 0) {
      Composite.remove(engine.world, offScreenParticles);
    }
  });

  World.add(engine.world, [leftWall, rightWall, hatch, hatchStopper, ground, outerLeft, outerRight]);

  Render.run(render);
  Runner.run(runner, engine);
  
  // Initialize bounds
  render.bounds.min.x = 0;
  render.bounds.max.x = width;
  render.bounds.min.y = 0;
  render.bounds.max.y = height;

  let particlesSpawned = initialParticlesSpawned;

  const updateZoom = (scale: number) => {
    const centerX = width / 2;
    const centerY = funnelBottomY; // Lock zoom to bottom of funnel
    
    const zoomWidth = width / scale;
    const zoomHeight = height / scale;
    
    render.bounds.min.x = centerX - zoomWidth / 2;
    render.bounds.max.x = centerX + zoomWidth / 2;
    render.bounds.min.y = centerY - zoomHeight * 0.85; // Keep bottom mostly in view
    render.bounds.max.y = centerY + zoomHeight * 0.15;
  };

  const getParticleCount = () => {
    return Composite.allBodies(engine.world).filter(body => !body.isStatic).length;
  };

  const getHighestParticleY = () => {
    const allBodies = Composite.allBodies(engine.world);
    const particles = allBodies.filter(body => !body.isStatic);
    
    // Don't zoom until we have a substantial pile (at least 60 particles)
    if (particles.length < 60) return height;
    
    // Only consider particles that have settled (low velocity) 
    // OR are clearly part of a pile (below the current spawn area).
    // We dynamically adjust the "ignore zone" based on where we are currently spawning.
    const currentSpawnY = Math.max(-1000, -50 - (particlesSpawned * 2));
    
    const settledParticles = particles.filter(p => 
      p.position.y > currentSpawnY + 150 && 
      (Math.abs(p.velocity.y) < 1.5 || p.position.y > height * 0.2)
    );
    
    if (settledParticles.length === 0) return height;
    
    // Sort by Y and take a percentile to avoid jitter from single bouncing particles
    const sortedY = settledParticles.map(p => p.position.y).sort((a, b) => a - b);
    // Use the 10th percentile (the "top" of the pile, but slightly buffered)
    const percentileIndex = Math.floor(sortedY.length * 0.1);
    return sortedY[percentileIndex];
  };

  const spawnParticle = () => {
    const size = Common.random(14, 22);
    // Wider spawn area to fill the funnel more naturally
    const x = width / 2 + (Math.random() - 0.5) * (width * 0.6);
    // Start spawning just off-screen, then move higher up as more are spawned
    const y = Math.max(-1000, -50 - (particlesSpawned * 2));
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    
    // Jelly-like properties: high restitution, low friction, and chamfer for roundedness
    const commonOptions = {
      restitution: 0.7, // Bouncier
      friction: 0.02,
      frictionAir: 0.02, // More air resistance for "soft" fall
      density: 0.001,
      slop: 0.01,
      render: {
        fillStyle: color,
        strokeStyle: '#000000',
        lineWidth: 1
      }
    };

    const shapeType = Common.choose(['circle', 'rect', 'poly', 'tri']);
    let body;

    if (shapeType === 'circle') {
      body = Bodies.circle(x, y, size / 2, commonOptions);
    } else if (shapeType === 'rect') {
      body = Bodies.rectangle(x, y, size, size, {
        ...commonOptions,
        chamfer: { radius: size * 0.2 } // Rounded corners for jelly feel
      });
    } else if (shapeType === 'tri') {
      body = Bodies.polygon(x, y, 3, size * 0.7, {
        ...commonOptions,
        chamfer: { radius: size * 0.15 }
      });
    } else {
      body = Bodies.polygon(x, y, 5, size * 0.6, {
        ...commonOptions,
        chamfer: { radius: size * 0.15 }
      });
    }

    World.add(engine.world, body);
    particlesSpawned++;
  };

  const removeHatch = () => {
    Composite.remove(engine.world, [hatch, hatchStopper]);
  };

  const resetHatch = () => {
    // Check if already in world to avoid duplicates
    const allBodies = Composite.allBodies(engine.world);
    if (!allBodies.includes(hatch)) {
      World.add(engine.world, [hatch, hatchStopper]);
    }
  };

  const isHatchOpen = () => {
    const allBodies = Composite.allBodies(engine.world);
    return !allBodies.includes(hatch);
  };

  const clearParticles = () => {
    const allBodies = Composite.allBodies(engine.world);
    const particles = allBodies.filter(body => !body.isStatic);
    Composite.remove(engine.world, particles);
    particlesSpawned = 0;
  };

  const getParticles = () => {
    return Composite.allBodies(engine.world).filter(body => !body.isStatic);
  };

  const getSpawnedCount = () => {
    return particlesSpawned;
  };

  const getWidth = () => {
    return width;
  };
  
  const getHeight = () => {
    return height;
  };

  const addParticles = (particles: Matter.Body[], shiftX: number) => {
    particles.forEach(p => {
      Matter.Body.setPosition(p, {
        x: p.position.x + shiftX,
        y: p.position.y
      });
    });
    World.add(engine.world, particles);
  };

  const destroy = () => {
    Render.stop(render);
    Runner.stop(runner);
    Engine.clear(engine);
    render.canvas.remove();
    // @ts-ignore
    render.textures = {};
  };

  return {
    engine,
    render,
    runner,
    hatch,
    getParticleCount,
    getHighestParticleY,
    updateZoom,
    spawnParticle,
    removeHatch,
    resetHatch,
    isHatchOpen,
    clearParticles,
    getParticles,
    getSpawnedCount,
    getWidth,
    getHeight,
    addParticles,
    destroy
  };
};
