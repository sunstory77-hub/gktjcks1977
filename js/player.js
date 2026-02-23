class Player {
  constructor(camera, world, domElement) {
    this.camera = camera;
    this.world = world;
    this.domElement = domElement;

    // Position & physics
    this.position = new THREE.Vector3(32, 40, 32); // start above terrain
    this.velocity = new THREE.Vector3();
    this.onGround = false;
    this.height = 1.7; // player height in blocks
    this.width = 0.4;  // collision radius

    // Look angles
    this.yaw = 0;   // left/right (Y axis)
    this.pitch = 0; // up/down (X axis)

    // Input state
    this.keys = {};
    this.mouseButtons = {};
    this.locked = false;
    this.selectedBlock = 1; // BLOCK.GRASS

    // Constants
    this.SPEED = 5.0;
    this.JUMP_FORCE = 8.0;
    this.GRAVITY = -20.0;
    this.MAX_FALL_SPEED = -40.0;

    // Target block highlight
    this.highlightMesh = null;
    this._createHighlight();
  }

  _createHighlight() {
    const geo = new THREE.BoxGeometry(1.01, 1.01, 1.01);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      wireframe: true,
      transparent: true,
      opacity: 0.5,
    });
    this.highlightMesh = new THREE.Mesh(geo, mat);
    this.highlightMesh.visible = false;
  }

  init(scene) {
    scene.add(this.highlightMesh);

    // Pointer lock
    this.domElement.addEventListener('click', () => {
      if (!this.locked) {
        this.domElement.requestPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.domElement;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const sensitivity = 0.002;
      this.yaw -= e.movementX * sensitivity;
      this.pitch -= e.movementY * sensitivity;
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
    });

    document.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      // Hotbar keys 1-8
      if (e.code.startsWith('Digit')) {
        const num = parseInt(e.code.replace('Digit', '')) - 1;
        if (num >= 0 && num < window.HOTBAR_BLOCKS.length) {
          this.selectedBlock = window.HOTBAR_BLOCKS[num];
          if (window.ui) window.ui.selectSlot(num);
        }
      }
    });

    document.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    // Mouse click: place/break blocks
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.mouseButtons[e.button] = true;
      const target = this.getTargetBlock();
      if (e.button === 0 && target) {
        // Left click: break block
        this.world.setBlock(target.blockPos.x, target.blockPos.y, target.blockPos.z, BLOCK.AIR);
        this.world.rebuild(this._scene);
      } else if (e.button === 2 && target) {
        // Right click: place block
        const placePos = target.blockPos.clone().add(target.normal);
        // Don't place inside player
        const px = Math.floor(this.position.x);
        const py = Math.floor(this.position.y);
        const pz = Math.floor(this.position.z);
        if (placePos.x === px && placePos.z === pz && (placePos.y === py || placePos.y === py - 1)) return;
        this.world.setBlock(placePos.x, placePos.y, placePos.z, this.selectedBlock);
        this.world.rebuild(this._scene);
      }
      e.preventDefault();
    });

    document.addEventListener('contextmenu', (e) => e.preventDefault());

    // Scroll wheel to change block
    document.addEventListener('wheel', (e) => {
      const hotbar = window.HOTBAR_BLOCKS;
      let idx = hotbar.indexOf(this.selectedBlock);
      if (e.deltaY > 0) idx = (idx + 1) % hotbar.length;
      else idx = (idx - 1 + hotbar.length) % hotbar.length;
      this.selectedBlock = hotbar[idx];
      if (window.ui) window.ui.selectSlot(idx);
    });

    this._scene = scene;
  }

  update(delta) {
    if (!this._scene) return;

    // Get movement direction from keys
    const moveDir = new THREE.Vector3();
    if (this.keys['KeyW'] || this.keys['ArrowUp'])    moveDir.z -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown'])  moveDir.z += 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft'])  moveDir.x -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) moveDir.x += 1;

    if (moveDir.length() > 0) moveDir.normalize();

    // Apply yaw rotation to movement
    const cosYaw = Math.cos(this.yaw);
    const sinYaw = Math.sin(this.yaw);
    const worldMove = new THREE.Vector3(
      moveDir.x * cosYaw - moveDir.z * sinYaw,
      0,
      moveDir.x * sinYaw + moveDir.z * cosYaw
    );

    const speed = this.keys['ShiftLeft'] ? this.SPEED * 1.8 : this.SPEED;
    this.velocity.x = worldMove.x * speed;
    this.velocity.z = worldMove.z * speed;

    // Ground check (always test each frame)
    this.onGround = this._isOnGround();

    // Jump
    if ((this.keys['Space']) && this.onGround) {
      this.velocity.y = this.JUMP_FORCE;
    }

    // Gravity
    if (!this.onGround) {
      this.velocity.y += this.GRAVITY * delta;
      this.velocity.y = Math.max(this.velocity.y, this.MAX_FALL_SPEED);
    } else if (this.velocity.y < 0) {
      this.velocity.y = 0;
    }

    // Move with collision
    this._moveWithCollision(delta);

    // Update camera
    this.camera.position.copy(this.position);
    this.camera.position.y += this.height - 0.1;
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    // Update block highlight
    this._updateHighlight();
  }

  _moveWithCollision(delta) {
    const dx = this.velocity.x * delta;
    const dy = this.velocity.y * delta;
    const dz = this.velocity.z * delta;

    // Move X
    this.position.x += dx;
    if (this._checkCollision()) {
      this.position.x -= dx;
      this.velocity.x = 0;
    }

    // Move Z
    this.position.z += dz;
    if (this._checkCollision()) {
      this.position.z -= dz;
      this.velocity.z = 0;
    }

    // Move Y
    this.position.y += dy;
    if (this._checkCollision()) {
      this.position.y -= dy;
      this.velocity.y = 0;
    }
  }

  _isOnGround() {
    const w = this.width;
    const testY = this.position.y - 0.05;
    for (let x = Math.floor(this.position.x - w); x <= Math.floor(this.position.x + w); x++) {
      for (let z = Math.floor(this.position.z - w); z <= Math.floor(this.position.z + w); z++) {
        if (isSolid(this.world.getBlock(x, Math.floor(testY), z))) return true;
      }
    }
    return false;
  }

  _checkCollision() {
    const w = this.width;
    const minX = this.position.x - w;
    const maxX = this.position.x + w;
    const minY = this.position.y;
    const maxY = this.position.y + this.height;
    const minZ = this.position.z - w;
    const maxZ = this.position.z + w;

    for (let x = Math.floor(minX); x <= Math.floor(maxX); x++) {
      for (let y = Math.floor(minY); y <= Math.floor(maxY); y++) {
        for (let z = Math.floor(minZ); z <= Math.floor(maxZ); z++) {
          const block = this.world.getBlock(x, y, z);
          if (isSolid(block) && block !== BLOCK.WATER) {
            return true;
          }
        }
      }
    }
    return false;
  }

  getTargetBlock() {
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const eye = this.camera.position.clone();
    return this.world.raycast(eye, dir, 6);
  }

  _updateHighlight() {
    const target = this.getTargetBlock();
    if (target) {
      this.highlightMesh.position.copy(target.blockPos).addScalar(0.5);
      this.highlightMesh.visible = true;
    } else {
      this.highlightMesh.visible = false;
    }
  }

  getPosition() {
    return this.position.clone();
  }
}

window.Player = Player;
