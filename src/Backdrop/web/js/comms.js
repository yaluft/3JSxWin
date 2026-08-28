import { tellHost, onHostMessage } from './host.js?v=6';

const log = document.getElementById('log');
const form = document.getElementById('form');
const input = document.getElementById('input');
const meta = document.getElementById('meta');
const close = document.getElementById('close');
const fileInput = document.getElementById('file');
const attachBtn = document.getElementById('attach');
const imagineBtn = document.getElementById('imagine');
const chips = document.getElementById('chips');
const sendBtn = form.querySelector('button[type="submit"]');
const modelSel = document.getElementById('model');
const newChatBtn = document.getElementById('newchat');
const dragBar = document.getElementById('drag');

const history = [];
const pendingUploads = new Map();
let files = [];
let pending = null;
let imageModel = 'sdxl';

function currentModel() {
  return (modelSel?.value || '').trim();
}

function line(role, text, images = []) {
  const li = document.createElement('li');
  li.className = role === 'user' ? 'you' : role === 'system' ? 'sys' : 'ship';
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = role === 'user' ? 'YOU' : role === 'system' ? 'COMMS' : 'UPLINK';
  li.append(who);
  if (text) li.append(document.createTextNode(text));
  for (const src of images) {
    if (!src) continue;
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'uplink image';
    li.appendChild(img);
  }
  log.appendChild(li);
  log.scrollTop = log.scrollHeight;
}

function renderChips() {
  chips.replaceChildren();
  chips.hidden = files.length === 0;
  for (const f of files) {
    const li = document.createElement('li');
    li.textContent = f.name;
    chips.appendChild(li);
  }
}

function busy(on) {
  sendBtn.disabled = on;
  imagineBtn.disabled = on;
  attachBtn.disabled = on;
  if (modelSel) modelSel.disabled = on;
  if (newChatBtn) newChatBtn.disabled = on;
}

function queue(text, extra = {}) {
  pending = crypto.randomUUID();
  busy(true);
  tellHost({ type: extra.type || 'llm', id: pending, model: currentModel(), ...extra, messages: history.slice(-16) });
}

function fillModels(models, current) {
  if (!modelSel || !Array.isArray(models) || models.length === 0) return;
  const keep = currentModel() || current || '';
  const chat = [];
  const image = [];
  for (const item of models) {
    const id = typeof item === 'string' ? item : item?.id;
    if (!id) continue;
    const kind = typeof item === 'object' && item.kind === 'image' ? 'image' : 'chat';
    (kind === 'image' ? image : chat).push(id);
  }
  modelSel.replaceChildren();
  const addGroup = (label, ids) => {
    if (ids.length === 0) return;
    const g = document.createElement('optgroup');
    g.label = label;
    for (const id of ids) {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = id;
      g.appendChild(o);
    }
    modelSel.appendChild(g);
  };
  addGroup('Chat', chat);
  addGroup('Image', image);
  const ids = [...modelSel.options].map((o) => o.value);
  if (keep && ids.includes(keep)) modelSel.value = keep;
  else if (current && ids.includes(current)) modelSel.value = current;
}

function newChat() {
  if (pending) return;
  history.length = 0;
  files = [];
  renderChips();
  log.replaceChildren();
  line('system', 'New uplink. History cleared.');
  input.focus();
}

onHostMessage((data) => {
  if (data.type === 'llm-models') {
    if (data.imageModel) imageModel = data.imageModel;
    fillModels(data.models, data.current);
    return;
  }
  if (data.type === 'llm-status') {
    meta.textContent = data.text || '';
    return;
  }
  if (data.type === 'llm-uploaded') {
    const wait = pendingUploads.get(data.id);
    pendingUploads.delete(data.id);
    wait?.(data);
    return;
  }
  if (data.type !== 'llm-result') return;
  if (pending && data.id !== pending) return;
  pending = null;
  busy(false);
  const images = Array.isArray(data.images) ? data.images : [];
  const text = data.text || (images.length ? '' : '(empty)');
  history.push({ role: 'assistant', content: text || '[image]' });
  line('assistant', text, images);
});

async function uploadFiles(list) {
  const incoming = [...list].slice(0, 4);
  for (const file of incoming) {
    if (file.size > 8 * 1024 * 1024) {
      line('system', `${file.name} is over 8 MB.`);
      continue;
    }
    const data = await readBase64(file);
    const id = crypto.randomUUID();
    const result = await new Promise((resolve) => {
      pendingUploads.set(id, resolve);
      tellHost({ type: 'llm-upload', id, name: file.name, mime: file.type || 'application/octet-stream', data });
    });
    if (result.error) {
      line('system', result.error);
      continue;
    }
    files.push({ id: result.file.id, type: 'file', name: result.file.name });
  }
  renderChips();
}

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || '');
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (pending) return;
  let text = input.value.trim();
  if (text.toLowerCase().startsWith('/imagine ')) {
    const prompt = text.slice(9).trim();
    if (!prompt) return;
    input.value = '';
    line('user', `imagine: ${prompt}`);
    history.push({ role: 'user', content: prompt });
    queue(prompt, { type: 'llm-imagine', prompt });
    return;
  }
  if (!text && files.length === 0) return;
  input.value = '';
  const attached = files.splice(0);
  renderChips();
  const label = text || attached.map((f) => f.name).join(', ');
  history.push({ role: 'user', content: text || `attached ${attached.length} file(s)` });
  line('user', label);
  queue(text, { files: attached });
});

imagineBtn.addEventListener('click', () => {
  const prompt = input.value.trim().replace(/^\/imagine\s+/i, '');
  if (!prompt || pending) return;
  input.value = '';
  line('user', `imagine: ${prompt}`);
  history.push({ role: 'user', content: prompt });
  queue(prompt, { type: 'llm-imagine', prompt });
});

attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) void uploadFiles(fileInput.files);
  fileInput.value = '';
});

form.addEventListener('dragover', (event) => {
  event.preventDefault();
});
form.addEventListener('drop', (event) => {
  event.preventDefault();
  if (event.dataTransfer?.files?.length) void uploadFiles(event.dataTransfer.files);
});

close.addEventListener('click', () => tellHost({ type: 'close' }));
newChatBtn.addEventListener('click', newChat);
modelSel.addEventListener('change', () => {
  const m = currentModel();
  const bits = (meta.textContent || '').split(' · ');
  if (bits[0]?.startsWith('CARRIER ')) bits[0] = `CARRIER ${m}`;
  else bits.unshift(`CARRIER ${m}`);
  meta.textContent = bits.join(' · ');
});
dragBar.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  if (event.target.closest('button, select, input, option')) return;
  tellHost({ type: 'drag' });
});

line('system', 'NEW clears the thread. Switch model in the header. Attach (📎) or IMG / /imagine …');
tellHost({ type: 'comms-hello' });
input.focus();
