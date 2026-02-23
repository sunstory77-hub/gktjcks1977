// Block type IDs
const BLOCK = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WOOD: 5,
  LEAVES: 6,
  WATER: 7,
  BRICK: 8,
  SNOW: 9,
  GLASS: 10,
  COAL_ORE: 11,
};

// Block colors (top, side, bottom faces)
// Each entry: { top, side, bottom } or just a number for uniform color
const BLOCK_COLORS = {
  [BLOCK.GRASS]: { top: 0x4CAF50, side: 0x795548, bottom: 0x795548 },
  [BLOCK.DIRT]:  { top: 0x795548, side: 0x795548, bottom: 0x795548 },
  [BLOCK.STONE]: { top: 0x9E9E9E, side: 0x9E9E9E, bottom: 0x9E9E9E },
  [BLOCK.SAND]:  { top: 0xF5DEB3, side: 0xF5DEB3, bottom: 0xF5DEB3 },
  [BLOCK.WOOD]:  { top: 0x8B4513, side: 0xA0522D, bottom: 0x8B4513 },
  [BLOCK.LEAVES]:{ top: 0x228B22, side: 0x228B22, bottom: 0x228B22 },
  [BLOCK.WATER]: { top: 0x1565C0, side: 0x1565C0, bottom: 0x1565C0 },
  [BLOCK.BRICK]: { top: 0xB71C1C, side: 0xC62828, bottom: 0xB71C1C },
  [BLOCK.SNOW]:  { top: 0xFFFFFF, side: 0xEEEEEE, bottom: 0x795548 },
  [BLOCK.GLASS]: { top: 0xB3E5FC, side: 0xB3E5FC, bottom: 0xB3E5FC },
  [BLOCK.COAL_ORE]: { top: 0x757575, side: 0x616161, bottom: 0x757575 },
};

// Block display names
const BLOCK_NAMES = {
  [BLOCK.AIR]:      'Air',
  [BLOCK.GRASS]:    'Grass',
  [BLOCK.DIRT]:     'Dirt',
  [BLOCK.STONE]:    'Stone',
  [BLOCK.SAND]:     'Sand',
  [BLOCK.WOOD]:     'Wood',
  [BLOCK.LEAVES]:   'Leaves',
  [BLOCK.WATER]:    'Water',
  [BLOCK.BRICK]:    'Brick',
  [BLOCK.SNOW]:     'Snow',
  [BLOCK.GLASS]:    'Glass',
  [BLOCK.COAL_ORE]: 'Coal Ore',
};

// Transparent blocks (don't cull neighbor faces)
const TRANSPARENT_BLOCKS = new Set([BLOCK.AIR, BLOCK.WATER, BLOCK.GLASS, BLOCK.LEAVES]);

// Solid blocks (have collision)
const SOLID_BLOCKS = new Set([
  BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.SAND,
  BLOCK.WOOD, BLOCK.LEAVES, BLOCK.BRICK, BLOCK.SNOW,
  BLOCK.GLASS, BLOCK.COAL_ORE
]);

// Blocks available in hotbar (player can place these)
const HOTBAR_BLOCKS = [
  BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.SAND,
  BLOCK.WOOD, BLOCK.BRICK, BLOCK.GLASS, BLOCK.SNOW
];

function getBlockColor(type, face) {
  const colors = BLOCK_COLORS[type];
  if (!colors) return 0xFFFFFF;
  if (typeof colors === 'number') return colors;
  if (face === 'top') return colors.top;
  if (face === 'bottom') return colors.bottom;
  return colors.side;
}

function isTransparent(type) {
  return TRANSPARENT_BLOCKS.has(type);
}

function isSolid(type) {
  return SOLID_BLOCKS.has(type);
}

function getBlockName(type) {
  return BLOCK_NAMES[type] || 'Unknown';
}

// Make available globally
window.BLOCK = BLOCK;
window.BLOCK_COLORS = BLOCK_COLORS;
window.BLOCK_NAMES = BLOCK_NAMES;
window.HOTBAR_BLOCKS = HOTBAR_BLOCKS;
window.getBlockColor = getBlockColor;
window.isTransparent = isTransparent;
window.isSolid = isSolid;
window.getBlockName = getBlockName;
