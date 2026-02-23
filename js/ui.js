class UI {
  constructor() {
    this.selectedSlot = 0;
    this.hotbarSlots = [];
    this.container = null;
    this.blockInfoEl = null;
    this.coordsEl = null;
    this.pauseOverlay = null;
  }

  init() {
    this._createStyles();
    this._createCrosshair();
    this._createHotbar();
    this._createBlockInfo();
    this._createCoords();
    this._createPauseOverlay();
    this.selectSlot(0);
  }

  _createStyles() {
    const style = document.createElement('style');
    style.textContent = `
      #ui-container { position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; font-family: 'Courier New', monospace; }
      #crosshair { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 24px; font-weight: bold; text-shadow: 0 0 3px black, 1px 1px 0 black; user-select: none; }
      #hotbar { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); display: flex; gap: 4px; background: rgba(0,0,0,0.5); padding: 6px; border-radius: 8px; border: 2px solid rgba(255,255,255,0.2); }
      .hotbar-slot { width: 52px; height: 52px; border: 2px solid rgba(255,255,255,0.3); border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; position: relative; transition: border-color 0.1s; }
      .hotbar-slot.selected { border-color: white; border-width: 3px; background: rgba(255,255,255,0.1); }
      .slot-color { width: 30px; height: 30px; border-radius: 4px; border: 1px solid rgba(0,0,0,0.3); }
      .slot-num { position: absolute; top: 2px; left: 4px; color: rgba(255,255,255,0.7); font-size: 10px; font-weight: bold; }
      .slot-name { position: absolute; bottom: 2px; color: rgba(255,255,255,0.6); font-size: 7px; text-align: center; white-space: nowrap; overflow: hidden; width: 100%; padding: 0 2px; box-sizing: border-box; }
      #block-info { position: absolute; bottom: 90px; left: 50%; transform: translateX(-50%); color: white; font-size: 13px; text-shadow: 1px 1px 2px black; background: rgba(0,0,0,0.4); padding: 4px 10px; border-radius: 4px; }
      #coords { position: absolute; top: 10px; left: 10px; color: white; font-size: 13px; text-shadow: 1px 1px 2px black; background: rgba(0,0,0,0.4); padding: 6px 10px; border-radius: 4px; line-height: 1.6; }
      #pause-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; flex-direction: column; align-items: center; justify-content: center; color: white; }
      #pause-overlay h1 { font-size: 48px; margin-bottom: 20px; text-shadow: 2px 2px 4px black; }
      #pause-overlay p { font-size: 18px; color: rgba(255,255,255,0.8); text-align: center; line-height: 2; }
      #pause-overlay .controls { background: rgba(255,255,255,0.1); border-radius: 10px; padding: 20px 30px; margin-top: 10px; }
      kbd { background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.4); border-radius: 4px; padding: 2px 8px; font-family: monospace; font-size: 14px; }
    `;
    document.head.appendChild(style);
  }

  _createCrosshair() {
    this.container = document.createElement('div');
    this.container.id = 'ui-container';
    document.body.appendChild(this.container);

    const crosshair = document.createElement('div');
    crosshair.id = 'crosshair';
    crosshair.textContent = '+';
    this.container.appendChild(crosshair);
  }

  _createHotbar() {
    const hotbar = document.createElement('div');
    hotbar.id = 'hotbar';

    HOTBAR_BLOCKS.forEach((blockType, i) => {
      const slot = document.createElement('div');
      slot.className = 'hotbar-slot';

      const num = document.createElement('span');
      num.className = 'slot-num';
      num.textContent = i + 1;

      const colorEl = document.createElement('div');
      colorEl.className = 'slot-color';
      const color = getBlockColor(blockType, 'top');
      colorEl.style.background = '#' + color.toString(16).padStart(6, '0');

      const nameEl = document.createElement('span');
      nameEl.className = 'slot-name';
      nameEl.textContent = getBlockName(blockType);

      slot.appendChild(num);
      slot.appendChild(colorEl);
      slot.appendChild(nameEl);
      hotbar.appendChild(slot);
      this.hotbarSlots.push(slot);
    });

    this.container.appendChild(hotbar);
  }

  _createBlockInfo() {
    this.blockInfoEl = document.createElement('div');
    this.blockInfoEl.id = 'block-info';
    this.blockInfoEl.textContent = '';
    this.container.appendChild(this.blockInfoEl);
  }

  _createCoords() {
    this.coordsEl = document.createElement('div');
    this.coordsEl.id = 'coords';
    this.coordsEl.innerHTML = 'X: 0 | Y: 0 | Z: 0';
    this.container.appendChild(this.coordsEl);
  }

  _createPauseOverlay() {
    this.pauseOverlay = document.createElement('div');
    this.pauseOverlay.id = 'pause-overlay';
    this.pauseOverlay.innerHTML = `
      <h1>3D Block Game</h1>
      <p>Click to start playing</p>
      <div class="controls">
        <p><kbd>WASD</kbd> Move &nbsp;&nbsp; <kbd>Space</kbd> Jump &nbsp;&nbsp; <kbd>Shift</kbd> Sprint</p>
        <p><kbd>Left Click</kbd> Break Block &nbsp;&nbsp; <kbd>Right Click</kbd> Place Block</p>
        <p><kbd>1-8</kbd> or <kbd>Scroll</kbd> Select Block</p>
        <p><kbd>Esc</kbd> Pause / Menu</p>
      </div>
    `;
    document.body.appendChild(this.pauseOverlay);

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement) {
        this.pauseOverlay.style.display = 'none';
      } else {
        this.pauseOverlay.style.display = 'flex';
      }
    });
  }

  selectSlot(idx) {
    this.hotbarSlots.forEach((slot, i) => {
      slot.classList.toggle('selected', i === idx);
    });
    this.selectedSlot = idx;
    const blockType = HOTBAR_BLOCKS[idx];
    if (this.blockInfoEl) {
      this.blockInfoEl.textContent = getBlockName(blockType);
    }
  }

  updateCoords(x, y, z) {
    if (this.coordsEl) {
      this.coordsEl.innerHTML = `X: ${Math.floor(x)} &nbsp; Y: ${Math.floor(y)} &nbsp; Z: ${Math.floor(z)}`;
    }
  }

  getSelectedBlockType() {
    return HOTBAR_BLOCKS[this.selectedSlot];
  }
}

window.UI = UI;
