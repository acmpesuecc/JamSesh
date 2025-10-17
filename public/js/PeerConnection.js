// Note: replace `signalingSocket` below with the websocket variable used in this file (e.g. `socket`, `ws`, etc.)

// add this after the initial comments/imports and before the chatForm usage
const localDisplayName = new URLSearchParams(window.location.search).get('username') || 'anonymous';

// helper to append message to UI
// ...existing code...
// Replace appendChat here too
function appendChat(sender, text, ts) {
  console.log('CHAT recv:', { sender, text, ts });
  if ((typeof text === 'number' || /^\d{10,}$/.test(String(text))) && !ts) {
    ts = Number(text);
    text = '';
  }
  if (typeof text === 'object') text = JSON.stringify(text);
  const msgs = document.getElementById('chatMessages');
  if (!msgs) return;
  const el = document.createElement('div');
  el.style.marginBottom = '6px';
  const timeStr = ts ? ` <span style="color:#666;font-size:11px">${new Date(Number(ts)).toLocaleTimeString()}</span>` : '';
  el.innerHTML = `<strong>${escapeHtml(sender || 'anon')}</strong>${timeStr}: ${escapeHtml(text || '')}`;
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
}   

// simple escape to avoid injection
function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/[&<>"']/g, function (c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

// wire form submit
const chatForm = document.getElementById('chatForm');
if (chatForm) {
  chatForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const input = document.getElementById('chatInput');
    const text = input && input.value && input.value.trim();
    if (!text) return;
    // create message payload
    const payload = {
      type: 'chat',
      sender: (localDisplayName || 'client'), // replace localDisplayName with your client id variable if any
      text: text
    };

    // send via signaling websocket
    if (typeof ws !== 'undefined' && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    } else {
      console.warn('signaling socket not open, chat not sent');
    }

    // locally echo
    appendChat('You', text, Date.now());
    input.value = '';
  });
}

