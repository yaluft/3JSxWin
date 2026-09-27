// comms.js — the "Comms" chat panel (the Win+C uplink overlay). Runs inside its own
// WebView2 in CommsWindow, not the wallpaper. It renders the transcript and, for every
// action, posts a JSON message up to the C# host via host.js — the host makes the actual
// LLM/HTTP call (see SceneHost.HandleCommsMessage + LlmClient) and posts results back down.

import { tellHost, onHostMessage } from './host.js?v=6';

// Grab every element comms.html defines once, up front. #drag is the header strip that
// doubles as the window's title bar (the WPF window is chromeless — WindowStyle=None).
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

// history  — the running conversation, OpenAI-style { role, content } records. Only the
//            last 16 are sent per turn (see queue) to keep the prompt bounded.
// pendingUploads — id -> Promise resolver, so an async 'llm-uploaded' reply from the host
//            can wake the exact uploadFiles() call that is waiting on it.
// files    — attachments staged for the NEXT message (cleared once it is sent).
// pending  — the id of the request we are waiting on, or null when idle. Also the "busy"
//            flag: a second submit is ignored while this is set.
// imageModel — the host's configured image model id; used only to know image gen exists.
const history = [];
const pendingUploads = new Map();
let files = [];
let pending = null;
let imageModel = 'sdxl';

// The model id currently picked in the header <select>, or '' if none. The host decides
// what to do with an empty string (falls back to its configured default).
function currentModel() {
  return (modelSel?.value || '').trim();
}

// Append one row to the transcript. role is 'user' | 'system' | 'assistant'; each maps to
// a CSS class and a short call-sign label (YOU / COMMS / UPLINK) for the space theme.
// 'system' lines are local UI notices (errors, "history cleared"), never sent to the LLM.
// We build the DOM by hand rather than innerHTML so model output can never inject markup.
function line(role, text, images = []) {
  const li = document.createElement('li');
  li.className = role === 'user' ? 'you' : role === 'system' ? 'sys' : 'ship';
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = role === 'user' ? 'YOU' : role === 'system' ? 'COMMS' : 'UPLINK';
  li.append(who);
  // textContent, not innerHTML — the reply text is untrusted and must stay inert.
  if (text) li.append(document.createTextNode(text));
  // Image results (from /imagine or an image model) arrive as data: URIs or http URLs.
  for (const src of images) {
    if (!src) continue;
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'uplink image';
    li.appendChild(img);
  }
  // Keep the newest line in view — the log is a fixed-height scroll region.
  log.appendChild(li);
  log.scrollTop = log.scrollHeight;
}

// Redraw the little "attached file" pills under the input from the staged `files` array.
// Hidden entirely when nothing is staged so the strip takes no vertical space.
function renderChips() {
  chips.replaceChildren();
  chips.hidden = files.length === 0;
  for (const f of files) {
    const li = document.createElement('li');
    li.textContent = f.name;
    chips.appendChild(li);
  }
}

// Toggle every control that could start a second request. Called with true when a turn is
// in flight and false when the result comes back, so the user can't stack prompts.
function busy(on) {
  sendBtn.disabled = on;
  imagineBtn.disabled = on;
  attachBtn.disabled = on;
  if (modelSel) modelSel.disabled = on;
  if (newChatBtn) newChatBtn.disabled = on;
}

// Fire one request up to the host and enter the "waiting" state. We mint a UUID as `id`;
// the host echoes it back on the matching 'llm-result' so onHostMessage can tell whose
// reply this is (and drop stale ones). `extra.type` picks the message: 'llm' for chat,
// 'llm-imagine' for image gen. Only the last 16 turns go along to bound the prompt size.
function queue(text, extra = {}) {
  pending = crypto.randomUUID();
  busy(true);
  tellHost({ type: extra.type || 'llm', id: pending, model: currentModel(), ...extra, messages: history.slice(-16) });
}

// Rebuild the header model picker from the list the host sends in 'llm-models'. Items are
// either bare id strings or { id, kind } objects; kind:'image' models are split into their
// own <optgroup> so image gen is visually separate from chat. `current` is the host's
// default. We try to preserve the user's existing pick, then fall back to the host default.
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
  // Build one <optgroup> per non-empty bucket; skip a bucket with nothing in it.
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
  // Re-select: keep the user's current choice if the new list still has it, otherwise the
  // host default. If neither matches, the <select> just shows its first option.
  const ids = [...modelSel.options].map((o) => o.value);
  if (keep && ids.includes(keep)) modelSel.value = keep;
  else if (current && ids.includes(current)) modelSel.value = current;
}

// The NEW button: wipe the conversation and transcript and start fresh. Refused mid-turn
// (`pending`) so we don't clear state the in-flight reply is about to land in.
function newChat() {
  if (pending) return;
  history.length = 0;
  files = [];
  renderChips();
  log.replaceChildren();
  line('system', 'New uplink. History cleared.');
  input.focus();
}

// The single host -> page inbox. C# (CommsWindow.Send -> PostWebMessageAsJson) pushes one
// JSON object at a time; host.js hands it here already parsed. We switch on data.type:
//   llm-models   — model list + defaults for the header picker (sent after comms-hello).
//   llm-status   — free text for the "NO CARRIER" status line (carrier/model info).
//   llm-uploaded — ack for one 'llm-upload'; resolves the Promise uploadFiles() is awaiting.
//   llm-result   — the reply to an 'llm'/'llm-imagine' turn, matched back by id.
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
    // Look up the resolver we parked under this id in uploadFiles(), fire it with the
    // ack (which carries either { file } or { error }), and forget it.
    const wait = pendingUploads.get(data.id);
    pendingUploads.delete(data.id);
    wait?.(data);
    return;
  }
  if (data.type !== 'llm-result') return;
  // Drop a result whose id isn't the one we're waiting on — a leftover from a turn the
  // user already replaced (e.g. hit NEW, or the host answered twice).
  if (pending && data.id !== pending) return;
  pending = null;
  busy(false);
  // A reply can be text, image(s), or both. Record a compact placeholder in history for an
  // image-only reply so the next prompt still has a coherent turn sequence.
  const images = Array.isArray(data.images) ? data.images : [];
  const text = data.text || (images.length ? '' : '(empty)');
  history.push({ role: 'assistant', content: text || '[image]' });
  line('assistant', text, images);
});

// Send files to the host one at a time and stage the ones that upload cleanly. The page
// can't reach the LLM's file API directly (no CORS, no key), so each file goes up as an
// 'llm-upload' message (base64) and the host does the real upload via LlmClient.
// Capped at 4 files per drop and 8 MB each — a web message is a poor transport for bulk.
async function uploadFiles(list) {
  const incoming = [...list].slice(0, 4);
  for (const file of incoming) {
    if (file.size > 8 * 1024 * 1024) {
      line('system', `${file.name} is over 8 MB.`);
      continue;
    }
    const data = await readBase64(file);
    const id = crypto.randomUUID();
    // Park a resolver under `id`, post the upload, and await it. onHostMessage fires this
    // resolver when the matching 'llm-uploaded' ack arrives — turns the async round-trip
    // into a plain await here.
    const result = await new Promise((resolve) => {
      pendingUploads.set(id, resolve);
      tellHost({ type: 'llm-upload', id, name: file.name, mime: file.type || 'application/octet-stream', data });
    });
    if (result.error) {
      line('system', result.error);
      continue;
    }
    // Keep the host's file handle (id + name) to attach to the next outgoing message.
    files.push({ id: result.file.id, type: 'file', name: result.file.name });
  }
  renderChips();
}

// Read a File as base64 with no data: URI prefix. FileReader gives us
// "data:<mime>;base64,<payload>"; we slice off everything up to and including the comma so
// the host receives just the raw base64 body.
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

// SEND (or Enter in the text field). This is the main "transmit" path.
// (The old transparency bug — keystrokes never reaching this handler while
// CommsWindow was a layered AllowsTransparency window — is fixed on the C# side:
// the window is opaque again and every activation forwards focus into the
// WebView2 child. See CommsWindow.xaml.cs.)
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (pending) return;
  let text = input.value.trim();
  // "/imagine <prompt>" is a typed shortcut for the IMG button — route it to image gen.
  if (text.toLowerCase().startsWith('/imagine ')) {
    const prompt = text.slice(9).trim();   // 9 = length of "/imagine "
    if (!prompt) return;
    input.value = '';
    line('user', `imagine: ${prompt}`);
    history.push({ role: 'user', content: prompt });
    queue(prompt, { type: 'llm-imagine', prompt });
    return;
  }
  // Nothing to send if there's neither text nor a staged attachment.
  if (!text && files.length === 0) return;
  input.value = '';
  // splice(0) empties `files` and hands us the batch to attach to THIS turn.
  const attached = files.splice(0);
  renderChips();
  const label = text || attached.map((f) => f.name).join(', ');
  history.push({ role: 'user', content: text || `attached ${attached.length} file(s)` });
  line('user', label);
  queue(text, { files: attached });
});

// IMG button — image generation. Takes whatever is in the input as the prompt (tolerating
// a leading "/imagine " the user may have typed) and sends an 'llm-imagine' turn.
imagineBtn.addEventListener('click', () => {
  const prompt = input.value.trim().replace(/^\/imagine\s+/i, '');
  if (!prompt || pending) return;
  input.value = '';
  line('user', `imagine: ${prompt}`);
  history.push({ role: 'user', content: prompt });
  queue(prompt, { type: 'llm-imagine', prompt });
});

// 📎 button opens the hidden native file picker; its change event hands the chosen files to
// uploadFiles(). We clear .value afterwards so picking the same file twice still fires.
attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) void uploadFiles(fileInput.files);
  fileInput.value = '';
});

// Drag-and-drop files onto the compose form. preventDefault on dragover is required or the
// browser refuses the drop; preventDefault on drop stops it navigating away to the file.
form.addEventListener('dragover', (event) => {
  event.preventDefault();
});
form.addEventListener('drop', (event) => {
  event.preventDefault();
  if (event.dataTransfer?.files?.length) void uploadFiles(event.dataTransfer.files);
});

// ✕ button — ask the host to close the window. The page can't close its own top-level WPF
// window, so SceneHost handles 'close' by calling _comms.Close().
close.addEventListener('click', () => tellHost({ type: 'close' }));
newChatBtn.addEventListener('click', newChat);

// When the model changes, prepend/replace a "CARRIER <model>" token on the status line so
// the current model is always visible. The line is a " · "-joined list of tokens; we only
// touch the first slot.
modelSel.addEventListener('change', () => {
  const m = currentModel();
  const bits = (meta.textContent || '').split(' · ');
  if (bits[0]?.startsWith('CARRIER ')) bits[0] = `CARRIER ${m}`;
  else bits.unshift(`CARRIER ${m}`);
  meta.textContent = bits.join(' · ');
});

// The drag handle. #drag is the header strip; comms.html uses it as the title bar because
// the WPF window is chromeless. On a left-press anywhere but an actual control, we post
// {type:"drag"} and the host runs the OS window-move loop (CommsWindow.BeginDrag ->
// ReleaseCapture + WM_NCLBUTTONDOWN/HTCAPTION). With the window back to opaque (the
// transparency experiment reverted) and the non-client frame recomputed after the
// ex-style rewrite, this round-trip is reliable again.
dragBar.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;   // left button only
  // Don't hijack a press that landed on a real control in the header (model select, NEW, ✕).
  if (event.target.closest('button, select, input, option')) return;
  tellHost({ type: 'drag' });
});

// Boot sequence, runs once on load:
//   1. print the local help line,
//   2. send 'comms-hello' so the host replies with 'llm-models' + 'llm-status',
//   3. focus the input so the user can type straight away (see the transparency bug note
//      on the form submit handler — this focus() call may not actually stick).
line('system', 'NEW clears the thread. Switch model in the header. Attach (📎) or IMG / /imagine …');
tellHost({ type: 'comms-hello' });
input.focus();
