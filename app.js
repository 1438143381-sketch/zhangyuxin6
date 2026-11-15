const MEDIAPIPE_VERSION = '0.10.21';
const TASKS_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/+esm`;
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const stage = document.querySelector('.stage');
const artCanvas = document.querySelector('#artCanvas');
const fxCanvas = document.querySelector('#fxCanvas');
const art = artCanvas.getContext('2d');
const fx = fxCanvas.getContext('2d');
const video = document.querySelector('#video');
const overlay = document.querySelector('#overlay');
const overlayContext = overlay.getContext('2d');
const cursor = document.querySelector('#cursor');
const cameraButton = document.querySelector('#cameraButton');
const preview = document.querySelector('#cameraPreview');
const status = document.querySelector('#status');
const gestureLabel = document.querySelector('#gestureLabel');
const emptyState = document.querySelector('#emptyState');
const strokeCount = document.querySelector('#strokeCount');
const undoButton = document.querySelector('#undoButton');
const sizeInput = document.querySelector('#size');

const state = {
  mode: 'ink', color: '#76f0cf', size: 8, strokes: [], activeStroke: null,
  particles: [], camera: null, handLandmarker: null, cameraRunning: false,
  pinch: false, lastVideoTime: -1, lastDetectAt: 0, pointerId: null,
  width: 0, height: 0, lastHandAt: 0,
};

function setStatus(message, error = false) {
  status.querySelector('span').textContent = message;
  status.classList.toggle('error', error);
}

function setGesture(message) { gestureLabel.textContent = message; }

function canvasPoint(clientX, clientY) {
  const rect = stage.getBoundingClientRect();
  return { x: Math.max(0, Math.min(rect.width, clientX - rect.left)), y: Math.max(0, Math.min(rect.height, clientY - rect.top)) };
}

function moveCursor(point, drawing) {
  cursor.style.display = 'block';
  cursor.style.left = `${point.x}px`;
  cursor.style.top = `${point.y}px`;
  cursor.style.borderColor = state.color;
  cursor.style.backgroundColor = drawing ? `${state.color}55` : 'transparent';
  cursor.style.width = `${Math.max(17, state.size + 8)}px`;
  cursor.style.height = cursor.style.width;
  cursor.classList.toggle('drawing', drawing);
}

function normalized(point) { return { x: point.x / state.width, y: point.y / state.height }; }
function denormalized(point) { return { x: point.x * state.width, y: point.y * state.height }; }

function drawSegment(ctx, a, b, stroke) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke.size;
  ctx.strokeStyle = stroke.color;
  ctx.shadowColor = stroke.color;
  ctx.shadowBlur = stroke.mode === 'spark' ? stroke.size * 2.5 : stroke.size * 0.7;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawDot(ctx, point, stroke) {
  ctx.fillStyle = stroke.color;
  ctx.shadowColor = stroke.color;
  ctx.shadowBlur = stroke.mode === 'spark' ? stroke.size * 2.5 : stroke.size;
  ctx.beginPath();
  ctx.arc(point.x, point.y, stroke.size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function renderStroke(ctx, stroke) {
  if (!stroke.points.length) return;
  if (stroke.points.length === 1) drawDot(ctx, denormalized(stroke.points[0]), stroke);
  for (let i = 1; i < stroke.points.length; i++) {
    drawSegment(ctx, denormalized(stroke.points[i - 1]), denormalized(stroke.points[i]), stroke);
  }
}

function redraw() {
  art.clearRect(0, 0, state.width, state.height);
  state.strokes.forEach(stroke => renderStroke(art, stroke));
  if (state.activeStroke) renderStroke(art, state.activeStroke);
  emptyState.classList.toggle('hidden', state.strokes.length > 0 || Boolean(state.activeStroke));
  strokeCount.textContent = `${state.strokes.length} 笔`;
  undoButton.disabled = state.strokes.length === 0;
}

function resizeCanvases() {
  const rect = stage.getBoundingClientRect();
  state.width = Math.max(1, rect.width);
  state.height = Math.max(1, rect.height);
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  for (const [canvas, ctx] of [[artCanvas, art], [fxCanvas, fx]]) {
    canvas.width = Math.round(state.width * scale);
    canvas.height = Math.round(state.height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }
  redraw();
}

function beginStroke(point) {
  if (state.activeStroke) return;
  state.activeStroke = { mode: state.mode, color: state.color, size: state.size, points: [normalized(point)] };
  drawDot(art, point, state.activeStroke);
  emptyState.classList.add('hidden');
}

function addParticles(point, color, count = 3) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.8 + Math.random() * 2.8;
    state.particles.push({ x: point.x, y: point.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, radius: 1 + Math.random() * 2.5, color });
  }
  if (state.particles.length > 500) state.particles.splice(0, state.particles.length - 500);
}

function continueStroke(point) {
  const stroke = state.activeStroke;
  if (!stroke) return;
  const previous = denormalized(stroke.points[stroke.points.length - 1]);
  if (Math.hypot(point.x - previous.x, point.y - previous.y) < 1.5) return;
  stroke.points.push(normalized(point));
  drawSegment(art, previous, point, stroke);
  if (stroke.mode === 'spark') addParticles(point, stroke.color);
}

function endStroke() {
  if (!state.activeStroke) return;
  state.strokes.push(state.activeStroke);
  state.activeStroke = null;
  redraw();
}

function animateParticles() {
  fx.clearRect(0, 0, state.width, state.height);
  state.particles = state.particles.filter(p => p.life > 0);
  for (const p of state.particles) {
    p.x += p.vx; p.y += p.vy; p.vy += 0.03; p.life -= 0.025;
    fx.globalAlpha = Math.max(0, p.life);
    fx.fillStyle = p.color;
    fx.shadowColor = p.color;
    fx.shadowBlur = 10;
    fx.beginPath(); fx.arc(p.x, p.y, p.radius * p.life, 0, Math.PI * 2); fx.fill();
  }
  fx.globalAlpha = 1;
  fx.shadowBlur = 0;
  requestAnimationFrame(animateParticles);
}

stage.addEventListener('pointerdown', event => {
  if (event.target.closest('.camera-preview')) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  state.pointerId = event.pointerId;
  stage.setPointerCapture(event.pointerId);
  const point = canvasPoint(event.clientX, event.clientY);
  beginStroke(point); moveCursor(point, true); setGesture('绘制中');
});
stage.addEventListener('pointermove', event => {
  if (state.cameraRunning && state.pointerId === null) return;
  const point = canvasPoint(event.clientX, event.clientY);
  if (event.pointerId === state.pointerId) continueStroke(point);
  moveCursor(point, event.pointerId === state.pointerId);
});
function releasePointer(event) {
  if (event.pointerId !== state.pointerId) return;
  state.pointerId = null; endStroke();
  cursor.classList.remove('drawing'); setGesture(state.cameraRunning ? '等待手势' : '等待输入');
}
stage.addEventListener('pointerup', releasePointer);
stage.addEventListener('pointercancel', releasePointer);
stage.addEventListener('pointerleave', () => { if (state.pointerId === null && !state.cameraRunning) cursor.style.display = 'none'; });

document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  state.mode = button.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach(item => {
    const selected = item === button; item.classList.toggle('active', selected); item.setAttribute('aria-pressed', String(selected));
  });
}));
document.querySelectorAll('[data-color]').forEach(button => button.addEventListener('click', () => {
  state.color = button.dataset.color;
  document.querySelectorAll('[data-color]').forEach(item => {
    const selected = item === button; item.classList.toggle('selected', selected); item.setAttribute('aria-pressed', String(selected));
  });
}));
sizeInput.addEventListener('input', () => {
  state.size = Number(sizeInput.value);
  document.querySelector('#sizeValue').value = sizeInput.value;
});
undoButton.addEventListener('click', () => { endStroke(); state.strokes.pop(); redraw(); });
document.querySelector('#clearButton').addEventListener('click', () => {
  state.activeStroke = null; state.strokes = []; state.particles = []; redraw();
});
document.querySelector('#saveButton').addEventListener('click', () => {
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = artCanvas.width; exportCanvas.height = artCanvas.height;
  const context = exportCanvas.getContext('2d');
  context.fillStyle = '#101819'; context.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  context.drawImage(artCanvas, 0, 0);
  const link = document.createElement('a');
  link.href = exportCanvas.toDataURL('image/png');
  link.download = `gesture-studio-${new Date().toISOString().slice(0, 10)}.png`;
  link.click();
});

const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
function drawHand(hand) {
  overlayContext.clearRect(0, 0, overlay.width, overlay.height);
  overlayContext.strokeStyle = '#76f0cf'; overlayContext.lineWidth = 3;
  for (const [a, b] of CONNECTIONS) {
    overlayContext.beginPath();
    overlayContext.moveTo(hand[a].x * overlay.width, hand[a].y * overlay.height);
    overlayContext.lineTo(hand[b].x * overlay.width, hand[b].y * overlay.height);
    overlayContext.stroke();
  }
  overlayContext.fillStyle = '#f3bc71';
  for (const index of [4, 8]) {
    overlayContext.beginPath();
    overlayContext.arc(hand[index].x * overlay.width, hand[index].y * overlay.height, 6, 0, Math.PI * 2);
    overlayContext.fill();
  }
}

function processHand(hand) {
  const index = hand[8], thumb = hand[4], palmWidth = Math.hypot(hand[5].x - hand[17].x, hand[5].y - hand[17].y);
  const ratio = Math.hypot(index.x - thumb.x, index.y - thumb.y) / Math.max(palmWidth, 0.01);
  // Separate close/open thresholds keep tracking noise from repeatedly starting strokes.
  state.pinch = state.pinch ? ratio < 0.58 : ratio < 0.38;
  const point = { x: (1 - index.x) * state.width, y: index.y * state.height };
  moveCursor(point, state.pinch);
  if (state.pinch && state.pointerId === null) {
    if (!state.activeStroke) beginStroke(point);
    else continueStroke(point);
    setGesture('捏合 · 绘制');
  } else {
    if (state.pointerId === null) endStroke();
    setGesture('移动 · 定位');
  }
}

async function trackHands() {
  if (!state.cameraRunning) return;
  const now = performance.now();
  if (video.readyState >= 2 && video.currentTime !== state.lastVideoTime && now - state.lastDetectAt >= 30) {
    state.lastVideoTime = video.currentTime;
    state.lastDetectAt = now;
    try {
      const result = state.handLandmarker.detectForVideo(video, now);
      const hand = result.landmarks?.[0];
      if (hand) {
        state.lastHandAt = now; drawHand(hand); processHand(hand);
      } else if (now - state.lastHandAt > 200) {
        overlayContext.clearRect(0, 0, overlay.width, overlay.height);
        state.pinch = false; if (state.pointerId === null) endStroke();
        cursor.style.display = 'none'; setGesture('等待手势');
      }
    } catch (error) {
      console.error('Hand tracking stopped:', error);
      stopCamera(); setStatus('手势识别失败', true); return;
    }
  }
  requestAnimationFrame(trackHands);
}

function stopCamera() {
  state.cameraRunning = false;
  state.camera?.getTracks().forEach(track => track.stop());
  state.camera = null; video.srcObject = null;
  preview.hidden = true; state.pinch = false; endStroke();
  overlayContext.clearRect(0, 0, overlay.width, overlay.height);
  cameraButton.lastElementChild.textContent = '开启摄像头';
  cameraButton.setAttribute('aria-pressed', 'false');
  document.querySelector('#inputLabel').textContent = '鼠标 / 触控输入';
  document.querySelector('#hint').textContent = '按住鼠标绘画 · 摄像头模式下捏合拇指与食指绘画';
  setGesture('等待输入'); setStatus('鼠标模式');
}

async function startCamera() {
  cameraButton.disabled = true; setStatus('加载手部模型…');
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前环境不支持摄像头。请使用 localhost 或 HTTPS。');
    if (!state.handLandmarker) {
      const { HandLandmarker, FilesetResolver } = await import(TASKS_URL);
      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      state.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
        runningMode: 'VIDEO', numHands: 1,
        minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
    }
    setStatus('请求摄像头权限…');
    state.camera = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } });
    video.srcObject = state.camera;
    await video.play();
    overlay.width = video.videoWidth; overlay.height = video.videoHeight;
    state.lastVideoTime = -1; state.lastHandAt = 0;
    state.cameraRunning = true;
    preview.hidden = false;
    cameraButton.lastElementChild.textContent = '关闭摄像头';
    cameraButton.setAttribute('aria-pressed', 'true');
    document.querySelector('#inputLabel').textContent = 'MediaPipe 手势输入';
    document.querySelector('#hint').textContent = '捏合绘画 · 松开移动 · 鼠标和触控也可使用';
    setStatus('手势识别已开启'); setGesture('等待手势');
    requestAnimationFrame(trackHands);
  } catch (error) {
    console.error('Camera setup failed:', error);
    stopCamera();
    const message = error.name === 'NotAllowedError' ? '摄像头权限被拒绝' : error.name === 'NotFoundError' ? '未找到摄像头' : error.message || '摄像头启动失败';
    setStatus(message, true);
  } finally { cameraButton.disabled = false; }
}

cameraButton.addEventListener('click', () => state.cameraRunning ? stopCamera() : startCamera());
window.addEventListener('beforeunload', () => state.camera?.getTracks().forEach(track => track.stop()));
new ResizeObserver(resizeCanvases).observe(stage);
resizeCanvases();
requestAnimationFrame(animateParticles);
