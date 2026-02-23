class Game {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.world = null;
    this.player = null;
    this.ui = null;
    this.clock = new THREE.Clock();
    this.lastTime = 0;
  }

  init() {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87CEEB); // sky blue
    this.scene.fog = new THREE.Fog(0x87CEEB, 40, 80);

    // Camera
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 200);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false;
    document.body.appendChild(this.renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
    sunLight.position.set(50, 100, 50);
    this.scene.add(sunLight);

    // UI
    this.ui = new UI();
    this.ui.init();
    window.ui = this.ui;

    // Show loading screen during world generation
    const loadingEl = document.getElementById('loading');
    if (loadingEl) {
      loadingEl.style.display = 'flex';
      const bar = document.getElementById('loading-bar');
      if (bar) bar.style.width = '30%';
    }

    // Use setTimeout to allow the loading screen to render
    setTimeout(() => {
      // World
      this.world = new World(64, 64, 64);
      if (loadingEl) {
        const bar = document.getElementById('loading-bar');
        if (bar) bar.style.width = '60%';
      }
      this.world.generate();
      if (loadingEl) {
        const bar = document.getElementById('loading-bar');
        if (bar) bar.style.width = '80%';
      }
      this.world.buildMesh(this.scene);
      if (loadingEl) {
        const bar = document.getElementById('loading-bar');
        if (bar) bar.style.width = '100%';
      }

      // Player
      this.player = new Player(this.camera, this.world, this.renderer.domElement);
      this.player.init(this.scene);
      this.player.selectedBlock = window.HOTBAR_BLOCKS[0];

      // Window resize
      window.addEventListener('resize', () => {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
      });

      // Hide loading screen and start
      setTimeout(() => {
        if (loadingEl) loadingEl.style.display = 'none';
        this.renderer.setAnimationLoop((time) => this.gameLoop(time));
        console.log('Game ready! Click to play.');
      }, 100);
    }, 50);
  }

  gameLoop(time) {
    const delta = Math.min(this.clock.getDelta(), 0.05); // cap delta to 50ms

    // Update player
    if (!this.player) return;
    this.player.update(delta);

    // Sync selected block between player and UI
    this.player.selectedBlock = this.ui.getSelectedBlockType();

    // Update UI coords
    const pos = this.player.getPosition();
    this.ui.updateCoords(pos.x, pos.y, pos.z);

    // Render
    this.renderer.render(this.scene, this.camera);
  }
}

// Start game when DOM is ready
window.addEventListener('load', () => {
  const game = new Game();
  game.init();
  window.game = game;
});
