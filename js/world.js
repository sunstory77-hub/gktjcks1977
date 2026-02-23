class World {
  constructor(width = 64, depth = 64, height = 64) {
    this.width = width;
    this.depth = depth;
    this.height = height;
    // 3D array stored as flat Uint8Array
    this.blocks = new Uint8Array(width * depth * height);
    this.meshGroup = new THREE.Group();
    this.chunkMeshes = {};  // store meshes to dispose later
    this.noise = new SimplexNoise(Math.random());
  }

  idx(x, y, z) {
    return x + this.width * (z + this.depth * y);
  }

  getBlock(x, y, z) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height || z < 0 || z >= this.depth) return BLOCK.STONE;
    return this.blocks[this.idx(x, y, z)];
  }

  setBlock(x, y, z, type) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height || z < 0 || z >= this.depth) return;
    this.blocks[this.idx(x, y, z)] = type;
  }

  generate() {
    // Terrain generation:
    // 1. Height map with simplex noise (layered octaves)
    // 2. Layers: bedrock at y=0, stone up to height-4, dirt 3 layers, grass on top
    // 3. Sand near water level (y <= 6)
    // 4. Water fills up to y=6 if terrain is below
    // 5. Trees: randomly place on grass blocks (trunk=WOOD, leaves=LEAVES)
    // 6. Coal ore: randomly scattered in stone
    // Water level = 6
    // Max terrain height = 30, base = 10

    const WATER_LEVEL = 6;
    const noise = this.noise;
    
    for (let x = 0; x < this.width; x++) {
      for (let z = 0; z < this.depth; z++) {
        // Multi-octave noise for height
        const nx = x / this.width;
        const nz = z / this.depth;
        let h = noise.noise2D(nx * 3, nz * 3) * 0.5
                + noise.noise2D(nx * 6, nz * 6) * 0.25
                + noise.noise2D(nx * 12, nz * 12) * 0.125;
        h = (h + 1) / 2; // normalize to [0,1]
        const terrainHeight = Math.floor(8 + h * 20); // 8 to 28

        for (let y = 0; y < this.height; y++) {
          let blockType = BLOCK.AIR;
          if (y === 0) {
            blockType = BLOCK.STONE; // bedrock
          } else if (y < terrainHeight - 3) {
            blockType = BLOCK.STONE;
            // Coal ore
            if (Math.random() < 0.02) blockType = BLOCK.COAL_ORE;
          } else if (y < terrainHeight) {
            blockType = BLOCK.DIRT;
          } else if (y === terrainHeight) {
            if (terrainHeight <= WATER_LEVEL + 1) {
              blockType = BLOCK.SAND;
            } else if (h > 0.8) {
              blockType = BLOCK.SNOW; // mountain tops
            } else {
              blockType = BLOCK.GRASS;
            }
          } else if (y <= WATER_LEVEL && terrainHeight < WATER_LEVEL) {
            blockType = BLOCK.WATER;
          }
          this.setBlock(x, y, z, blockType);
        }

        // Trees on grass blocks (not near water)
        if (this.getBlock(x, terrainHeight, z) === BLOCK.GRASS && Math.random() < 0.02) {
          this._placeTree(x, terrainHeight + 1, z);
        }
      }
    }
  }

  _placeTree(x, y, z) {
    const trunkHeight = 4 + Math.floor(Math.random() * 2);
    for (let i = 0; i < trunkHeight; i++) {
      this.setBlock(x, y + i, z, BLOCK.WOOD);
    }
    // Leaves
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dy = -1; dy <= 2; dy++) {
          if (Math.abs(dx) + Math.abs(dz) + Math.abs(dy) <= 3) {
            const lx = x + dx, ly = y + trunkHeight + dy, lz = z + dz;
            if (this.getBlock(lx, ly, lz) === BLOCK.AIR) {
              this.setBlock(lx, ly, lz, BLOCK.LEAVES);
            }
          }
        }
      }
    }
  }

  // Build visible geometry - merges all visible block faces
  buildMesh(scene) {
    // Clear old meshes
    while (this.meshGroup.children.length > 0) {
      const m = this.meshGroup.children[0];
      this.meshGroup.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }

    // Build geometry for opaque and transparent blocks separately
    this._buildGeometry(scene, false); // opaque
    this._buildGeometry(scene, true);  // transparent (water, glass, leaves)
  }

  _buildGeometry(scene, transparent) {
    // Face directions: right, left, top, bottom, front, back
    const FACES = [
      { dir: [1,0,0], corners: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]], face: 'side' },
      { dir: [-1,0,0], corners: [[0,1,0],[0,0,0],[0,0,1],[0,1,1]], face: 'side' },
      { dir: [0,1,0], corners: [[0,1,0],[1,1,0],[1,1,1],[0,1,1]], face: 'top' },
      { dir: [0,-1,0], corners: [[1,0,0],[0,0,0],[0,0,1],[1,0,1]], face: 'bottom' },
      { dir: [0,0,1], corners: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], face: 'side' },
      { dir: [0,0,-1], corners: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], face: 'side' },
    ];

    const positions = [];
    const colors = [];
    const indices = [];
    let vertexCount = 0;

    for (let y = 0; y < this.height; y++) {
      for (let z = 0; z < this.depth; z++) {
        for (let x = 0; x < this.width; x++) {
          const type = this.getBlock(x, y, z);
          if (type === BLOCK.AIR) continue;
          const isBlockTransparent = isTransparent(type);
          if (isBlockTransparent !== transparent) continue;

          for (const face of FACES) {
            const nx = x + face.dir[0];
            const ny = y + face.dir[1];
            const nz = z + face.dir[2];
            const neighbor = this.getBlock(nx, ny, nz);
            
            // Show face if neighbor is transparent (and different from current for water)
            if (!isTransparent(neighbor)) continue;
            if (transparent && neighbor === type) continue;

            const color = new THREE.Color(getBlockColor(type, face.face));
            // Add slight variation to make terrain look more natural
            const shade = 0.85 + Math.random() * 0.15;
            if (face.face === 'top') { /* brighter */ }
            else if (face.face === 'bottom') { color.multiplyScalar(0.7); }
            else { color.multiplyScalar(0.85); }

            for (const corner of face.corners) {
              positions.push(x + corner[0], y + corner[1], z + corner[2]);
              colors.push(color.r, color.g, color.b);
            }

            // Two triangles per face
            indices.push(vertexCount, vertexCount+1, vertexCount+2);
            indices.push(vertexCount, vertexCount+2, vertexCount+3);
            vertexCount += 4;
          }
        }
      }
    }

    if (positions.length === 0) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      transparent: transparent,
      opacity: transparent ? 0.7 : 1.0,
      side: transparent ? THREE.DoubleSide : THREE.FrontSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    this.meshGroup.add(mesh);
    scene.add(this.meshGroup);
  }

  // Raycast: returns {blockPos, normal, face} of targeted block
  raycast(origin, direction, maxDist = 6) {
    // DDA algorithm for voxel raycast
    const pos = origin.clone();
    const step = new THREE.Vector3(
      Math.sign(direction.x) || 1,
      Math.sign(direction.y) || 1,
      Math.sign(direction.z) || 1
    );
    const tDelta = new THREE.Vector3(
      Math.abs(1 / direction.x),
      Math.abs(1 / direction.y),
      Math.abs(1 / direction.z)
    );
    
    let x = Math.floor(pos.x);
    let y = Math.floor(pos.y);
    let z = Math.floor(pos.z);

    const tMax = new THREE.Vector3(
      step.x > 0 ? (x + 1 - pos.x) * tDelta.x : (pos.x - x) * tDelta.x,
      step.y > 0 ? (y + 1 - pos.y) * tDelta.y : (pos.y - y) * tDelta.y,
      step.z > 0 ? (z + 1 - pos.z) * tDelta.z : (pos.z - z) * tDelta.z
    );

    let lastNormal = new THREE.Vector3();
    let dist = 0;

    while (dist < maxDist) {
      const block = this.getBlock(x, y, z);
      if (block !== BLOCK.AIR && block !== BLOCK.WATER) {
        return {
          blockPos: new THREE.Vector3(x, y, z),
          normal: lastNormal.clone(),
          blockType: block
        };
      }

      if (tMax.x < tMax.y && tMax.x < tMax.z) {
        dist = tMax.x;
        x += step.x;
        tMax.x += tDelta.x;
        lastNormal.set(-step.x, 0, 0);
      } else if (tMax.y < tMax.z) {
        dist = tMax.y;
        y += step.y;
        tMax.y += tDelta.y;
        lastNormal.set(0, -step.y, 0);
      } else {
        dist = tMax.z;
        z += step.z;
        tMax.z += tDelta.z;
        lastNormal.set(0, 0, -step.z);
      }
    }
    return null;
  }

  // Rebuild mesh after block change
  rebuild(scene) {
    this.buildMesh(scene);
  }
}

window.World = World;
