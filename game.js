// 게임 상수
const BOARD_WIDTH = 10;
const BOARD_HEIGHT = 20;
const BOARD_DEPTH = 10;
const BLOCK_SIZE = 1;

// Three.js 변수
let scene, camera, renderer;
let currentPiece = null;
let board = [];
let gameLoop = null;
let dropCounter = 0;
let dropInterval = 1000;
let lastTime = 0;

// 게임 상태
let gameState = {
    score: 0,
    level: 1,
    lines: 0,
    isPaused: false,
    isGameOver: false,
    isStarted: false
};

// 테트로미노 정의 (7가지 형태)
const TETROMINOS = {
    'I': {
        shape: [
            [[1, 1, 1, 1]]
        ],
        color: 0x00ffff
    },
    'O': {
        shape: [
            [[1, 1],
             [1, 1]]
        ],
        color: 0xffff00
    },
    'T': {
        shape: [
            [[0, 1, 0],
             [1, 1, 1]]
        ],
        color: 0x800080
    },
    'S': {
        shape: [
            [[0, 1, 1],
             [1, 1, 0]]
        ],
        color: 0x00ff00
    },
    'Z': {
        shape: [
            [[1, 1, 0],
             [0, 1, 1]]
        ],
        color: 0xff0000
    },
    'J': {
        shape: [
            [[1, 0, 0],
             [1, 1, 1]]
        ],
        color: 0x0000ff
    },
    'L': {
        shape: [
            [[0, 0, 1],
             [1, 1, 1]]
        ],
        color: 0xffa500
    }
};

// Three.js 초기화
function initThree() {
    const canvas = document.getElementById('gameCanvas');
    canvas.width = 800;
    canvas.height = 600;

    // Scene 생성
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    scene.fog = new THREE.Fog(0x1a1a2e, 20, 60);

    // Camera 설정
    camera = new THREE.PerspectiveCamera(75, canvas.width / canvas.height, 0.1, 1000);
    camera.position.set(BOARD_WIDTH / 2, BOARD_HEIGHT / 2, 25);
    camera.lookAt(BOARD_WIDTH / 2, BOARD_HEIGHT / 2, BOARD_DEPTH / 2);

    // Renderer 설정
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(canvas.width, canvas.height);
    renderer.shadowMap.enabled = true;

    // 조명 추가
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    const pointLight = new THREE.PointLight(0xffffff, 0.5);
    pointLight.position.set(-10, 10, 10);
    scene.add(pointLight);

    // 게임 보드 그리드 생성
    createBoardGrid();
}

// 보드 그리드 생성
function createBoardGrid() {
    const gridHelper = new THREE.GridHelper(BOARD_WIDTH, BOARD_WIDTH, 0x444444, 0x222222);
    gridHelper.position.set(BOARD_WIDTH / 2 - 0.5, 0, BOARD_DEPTH / 2 - 0.5);
    gridHelper.rotation.x = Math.PI / 2;
    scene.add(gridHelper);

    // 보드 경계선
    const edges = new THREE.EdgesGeometry(
        new THREE.BoxGeometry(BOARD_WIDTH, BOARD_HEIGHT, BOARD_DEPTH)
    );
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x666666 });
    const wireframe = new THREE.LineSegments(edges, lineMaterial);
    wireframe.position.set(BOARD_WIDTH / 2 - 0.5, BOARD_HEIGHT / 2, BOARD_DEPTH / 2 - 0.5);
    scene.add(wireframe);
}

// 보드 초기화
function initBoard() {
    board = [];
    for (let y = 0; y < BOARD_HEIGHT; y++) {
        board[y] = [];
        for (let x = 0; x < BOARD_WIDTH; x++) {
            board[y][x] = [];
            for (let z = 0; z < BOARD_DEPTH; z++) {
                board[y][x][z] = null;
            }
        }
    }
}

// 새로운 피스 생성
function createNewPiece() {
    const pieces = Object.keys(TETROMINOS);
    const randomPiece = pieces[Math.floor(Math.random() * pieces.length)];
    const tetromino = TETROMINOS[randomPiece];

    const shape = tetromino.shape[0];
    const mesh = new THREE.Group();

    for (let row = 0; row < shape.length; row++) {
        for (let col = 0; col < shape[row].length; col++) {
            if (shape[row][col]) {
                const geometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
                const material = new THREE.MeshPhongMaterial({
                    color: tetromino.color,
                    shininess: 100,
                    specular: 0x444444
                });
                const cube = new THREE.Mesh(geometry, material);
                cube.position.set(col, -row, 0);
                cube.castShadow = true;
                cube.receiveShadow = true;

                // 블록 테두리 추가
                const edgesGeometry = new THREE.EdgesGeometry(geometry);
                const edgesMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
                const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
                cube.add(edges);

                mesh.add(cube);
            }
        }
    }

    currentPiece = {
        mesh: mesh,
        shape: shape,
        position: {
            x: Math.floor(BOARD_WIDTH / 2) - 1,
            y: BOARD_HEIGHT - 1,
            z: Math.floor(BOARD_DEPTH / 2) - 1
        },
        color: tetromino.color
    };

    mesh.position.set(currentPiece.position.x, currentPiece.position.y, currentPiece.position.z);
    scene.add(mesh);

    // 게임 오버 체크
    if (checkCollision(0, 0, 0)) {
        gameOver();
    }
}

// 충돌 감지
function checkCollision(offsetX, offsetY, offsetZ) {
    if (!currentPiece) return false;

    const children = currentPiece.mesh.children;
    for (let i = 0; i < children.length; i++) {
        const block = children[i];
        const worldPos = new THREE.Vector3();
        block.getWorldPosition(worldPos);

        const x = Math.round(worldPos.x + offsetX);
        const y = Math.round(worldPos.y + offsetY);
        const z = Math.round(worldPos.z + offsetZ);

        // 경계 체크
        if (x < 0 || x >= BOARD_WIDTH || y < 0 || y >= BOARD_HEIGHT || z < 0 || z >= BOARD_DEPTH) {
            return true;
        }

        // 기존 블록과 충돌 체크
        if (board[y] && board[y][x] && board[y][x][z] !== null) {
            return true;
        }
    }
    return false;
}

// 피스 이동
function movePiece(dx, dy, dz) {
    if (!currentPiece || gameState.isPaused || gameState.isGameOver) return;

    if (!checkCollision(dx, dy, dz)) {
        currentPiece.position.x += dx;
        currentPiece.position.y += dy;
        currentPiece.position.z += dz;
        currentPiece.mesh.position.set(
            currentPiece.position.x,
            currentPiece.position.y,
            currentPiece.position.z
        );
        return true;
    }
    return false;
}

// 피스 회전
function rotatePiece(axis) {
    if (!currentPiece || gameState.isPaused || gameState.isGameOver) return;

    const rotationAngle = Math.PI / 2;
    const oldRotation = currentPiece.mesh.rotation.clone();

    switch (axis) {
        case 'x':
            currentPiece.mesh.rotation.x += rotationAngle;
            break;
        case 'y':
            currentPiece.mesh.rotation.y += rotationAngle;
            break;
        case 'z':
            currentPiece.mesh.rotation.z += rotationAngle;
            break;
    }

    if (checkCollision(0, 0, 0)) {
        currentPiece.mesh.rotation.copy(oldRotation);
    }
}

// 피스를 보드에 고정
function lockPiece() {
    if (!currentPiece) return;

    const children = currentPiece.mesh.children;
    for (let i = 0; i < children.length; i++) {
        const block = children[i];
        const worldPos = new THREE.Vector3();
        block.getWorldPosition(worldPos);

        const x = Math.round(worldPos.x);
        const y = Math.round(worldPos.y);
        const z = Math.round(worldPos.z);

        if (y >= 0 && y < BOARD_HEIGHT && x >= 0 && x < BOARD_WIDTH && z >= 0 && z < BOARD_DEPTH) {
            const geometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
            const material = new THREE.MeshPhongMaterial({
                color: currentPiece.color,
                shininess: 100,
                specular: 0x444444
            });
            const cube = new THREE.Mesh(geometry, material);
            cube.position.set(x, y, z);
            cube.castShadow = true;
            cube.receiveShadow = true;

            const edgesGeometry = new THREE.EdgesGeometry(geometry);
            const edgesMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
            const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
            cube.add(edges);

            scene.add(cube);
            board[y][x][z] = cube;
        }
    }

    scene.remove(currentPiece.mesh);
    currentPiece = null;

    checkLines();
    createNewPiece();
}

// 라인 클리어 체크
function checkLines() {
    let linesCleared = 0;

    for (let y = 0; y < BOARD_HEIGHT; y++) {
        let isLineFull = true;

        for (let x = 0; x < BOARD_WIDTH && isLineFull; x++) {
            for (let z = 0; z < BOARD_DEPTH && isLineFull; z++) {
                if (board[y][x][z] === null) {
                    isLineFull = false;
                }
            }
        }

        if (isLineFull) {
            clearLine(y);
            linesCleared++;
        }
    }

    if (linesCleared > 0) {
        gameState.lines += linesCleared;
        gameState.score += linesCleared * 100 * gameState.level;
        gameState.level = Math.floor(gameState.lines / 10) + 1;
        dropInterval = Math.max(100, 1000 - (gameState.level - 1) * 100);
        updateUI();
    }
}

// 라인 클리어
function clearLine(lineY) {
    // 해당 라인의 모든 블록 제거
    for (let x = 0; x < BOARD_WIDTH; x++) {
        for (let z = 0; z < BOARD_DEPTH; z++) {
            if (board[lineY][x][z]) {
                scene.remove(board[lineY][x][z]);
                board[lineY][x][z] = null;
            }
        }
    }

    // 위의 블록들을 아래로 이동
    for (let y = lineY; y < BOARD_HEIGHT - 1; y++) {
        for (let x = 0; x < BOARD_WIDTH; x++) {
            for (let z = 0; z < BOARD_DEPTH; z++) {
                board[y][x][z] = board[y + 1][x][z];
                if (board[y][x][z]) {
                    board[y][x][z].position.y = y;
                }
            }
        }
    }

    // 맨 위 라인 초기화
    for (let x = 0; x < BOARD_WIDTH; x++) {
        for (let z = 0; z < BOARD_DEPTH; z++) {
            board[BOARD_HEIGHT - 1][x][z] = null;
        }
    }
}

// 빠른 낙하
function hardDrop() {
    if (!currentPiece || gameState.isPaused || gameState.isGameOver) return;

    while (movePiece(0, -1, 0)) {
        gameState.score += 2;
    }
    updateUI();
    lockPiece();
}

// 키보드 입력 처리
document.addEventListener('keydown', (event) => {
    if (!gameState.isStarted || gameState.isGameOver) return;

    switch (event.key) {
        case 'ArrowLeft':
            movePiece(-1, 0, 0);
            break;
        case 'ArrowRight':
            movePiece(1, 0, 0);
            break;
        case 'ArrowUp':
            movePiece(0, 0, 1);
            break;
        case 'ArrowDown':
            movePiece(0, 0, -1);
            break;
        case 'q':
        case 'Q':
            rotatePiece('x');
            break;
        case 'e':
        case 'E':
            rotatePiece('x');
            break;
        case 'a':
        case 'A':
            rotatePiece('y');
            break;
        case 'd':
        case 'D':
            rotatePiece('y');
            break;
        case 'w':
        case 'W':
            rotatePiece('z');
            break;
        case 's':
        case 'S':
            rotatePiece('z');
            break;
        case ' ':
            hardDrop();
            break;
        case 'p':
        case 'P':
            togglePause();
            break;
    }
});

// 일시정지 토글
function togglePause() {
    gameState.isPaused = !gameState.isPaused;
}

// UI 업데이트
function updateUI() {
    document.getElementById('score').textContent = gameState.score;
    document.getElementById('level').textContent = gameState.level;
    document.getElementById('lines').textContent = gameState.lines;
}

// 게임 오버
function gameOver() {
    gameState.isGameOver = true;
    document.getElementById('finalScore').textContent = gameState.score;
    document.getElementById('gameOver').style.display = 'block';
}

// 게임 시작
function startGame() {
    document.getElementById('startScreen').style.display = 'none';
    gameState.isStarted = true;
    initBoard();
    createNewPiece();
    updateUI();
}

// 게임 재시작
function restartGame() {
    document.getElementById('gameOver').style.display = 'none';

    // 보드의 모든 블록 제거
    for (let y = 0; y < BOARD_HEIGHT; y++) {
        for (let x = 0; x < BOARD_WIDTH; x++) {
            for (let z = 0; z < BOARD_DEPTH; z++) {
                if (board[y] && board[y][x] && board[y][x][z]) {
                    scene.remove(board[y][x][z]);
                }
            }
        }
    }

    if (currentPiece) {
        scene.remove(currentPiece.mesh);
        currentPiece = null;
    }

    gameState = {
        score: 0,
        level: 1,
        lines: 0,
        isPaused: false,
        isGameOver: false,
        isStarted: true
    };

    dropInterval = 1000;
    initBoard();
    createNewPiece();
    updateUI();
}

// 게임 루프
function update(time = 0) {
    requestAnimationFrame(update);

    if (!gameState.isStarted || gameState.isPaused || gameState.isGameOver) {
        renderer.render(scene, camera);
        return;
    }

    const deltaTime = time - lastTime;
    lastTime = time;
    dropCounter += deltaTime;

    if (dropCounter > dropInterval) {
        if (!movePiece(0, -1, 0)) {
            lockPiece();
        }
        dropCounter = 0;
    }

    // 카메라 회전 애니메이션
    camera.position.x = BOARD_WIDTH / 2 + Math.sin(time * 0.0001) * 5;
    camera.position.z = 25 + Math.cos(time * 0.0001) * 5;
    camera.lookAt(BOARD_WIDTH / 2, BOARD_HEIGHT / 2, BOARD_DEPTH / 2);

    renderer.render(scene, camera);
}

// 초기화
window.addEventListener('DOMContentLoaded', () => {
    initThree();
    update();
});
