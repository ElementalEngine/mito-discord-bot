export const SMOKE_PAGE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Activity Smoke Test</title>
    <style>
      :root { color-scheme: dark; }
      body {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        background: #12141a; color: #d6dae2; margin: 0; padding: 16px;
        font-size: 13px; line-height: 1.5;
      }
      h1 { font-size: 15px; margin: 0 0 12px; color: #8ab4f8; }
      fieldset { border: 1px solid #2a2f3a; border-radius: 6px; margin: 0 0 12px; padding: 10px 12px; }
      legend { color: #9aa4b2; padding: 0 6px; }
      label { display: inline-block; min-width: 78px; color: #9aa4b2; }
      input, select { background: #1b1e26; color: #d6dae2; border: 1px solid #2a2f3a;
        border-radius: 4px; padding: 4px 6px; font: inherit; margin: 2px 0; }
      input[type="text"] { width: 220px; }
      button { background: #2a2f3a; color: #d6dae2; border: 1px solid #3a4150;
        border-radius: 4px; padding: 5px 10px; font: inherit; cursor: pointer; margin: 2px 4px 2px 0; }
      button:hover { background: #343b48; }
      button:disabled { opacity: 0.4; cursor: not-allowed; }
      .row { margin: 4px 0; }
      .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      #status { font-weight: bold; }
      .ok { color: #7ee787; } .bad { color: #ff7b72; } .warn { color: #e3b341; }
      pre { background: #0d0f14; border: 1px solid #2a2f3a; border-radius: 6px;
        padding: 10px; overflow: auto; max-height: 46vh; margin: 6px 0 0; white-space: pre-wrap; word-break: break-word; }
      #log { max-height: 22vh; font-size: 12px; color: #9aa4b2; }
      .pill { display:inline-block; padding:1px 6px; border-radius:10px; background:#1b1e26; border:1px solid #2a2f3a; margin-left:6px; }
    </style>
  </head>
  <body>
    <h1>🎮 Activity Smoke Test <span class="pill" id="conn">disconnected</span></h1>

    <fieldset>
      <legend>1 · Session</legend>
      <div class="row">
        <label>Edition</label>
        <select id="edition"><option>CIV6</option><option>CIV7</option></select>
        <label>Game type</label>
        <select id="gameType"><option>FFA</option><option>Teamer</option><option>Duel</option></select>
        <label>Draft mode</label>
        <select id="draftMode"><option>standard</option><option>snake</option><option>blind</option><option>cwc</option></select>
      </div>
      <div class="row">
        <button id="btnCreate">Create session</button>
        <label>Session id</label>
        <input type="text" id="sessionId" placeholder="paste or create" />
      </div>
    </fieldset>

    <fieldset>
      <legend>2 · Identity + connect</legend>
      <div class="row">
        <label>User id</label>
        <input type="text" id="userId" value="u1" />
        <label>Staff</label>
        <input type="checkbox" id="staff" />
        <button id="btnConnect">Get tokens + connect</button>
        <button id="btnDisconnect" disabled>Disconnect</button>
      </div>
      <div class="row"><span id="status" class="warn">idle</span></div>
    </fieldset>

    <fieldset>
      <legend>3 · Commands</legend>
      <div class="row">
        <button data-cmd="JOIN">JOIN</button>
        <button data-cmd="LEAVE">LEAVE</button>
        <button data-cmd='{"type":"SET_READY","ready":true}'>READY +</button>
        <button data-cmd='{"type":"SET_READY","ready":false}'>READY −</button>
        <button data-cmd="ADVANCE">ADVANCE</button>
        <button data-cmd="RANDOMIZE_BALLOT">RANDOMIZE_BALLOT</button>
        <button data-cmd='{"type":"CANCEL","reason":"smoke"}'>CANCEL</button>
      </div>
      <div class="row">
        <label>Custom</label>
        <input type="text" id="customCmd" placeholder='{"type":"CAST_VOTE","questionId":"draft_mode","optionIds":["standard"]}' style="width: 420px" />
        <button id="btnSend">Send</button>
      </div>
    </fieldset>

    <div class="cols">
      <div>
        <strong>Projected state (this recipient)</strong>
        <pre id="state">—</pre>
      </div>
      <div>
        <strong>Log</strong>
        <pre id="log"></pre>
      </div>
    </div>

    <script>
      const $ = (id) => document.getElementById(id);
      let ws = null;
      let tokens = null;

      function log(msg, cls) {
        const el = $('log');
        const line = document.createElement('div');
        if (cls) line.className = cls;
        line.textContent = new Date().toLocaleTimeString() + '  ' + msg;
        el.prepend(line);
      }
      function setStatus(text, cls) { const s = $('status'); s.textContent = text; s.className = cls || ''; }
      function setConn(text, cls) { const c = $('conn'); c.textContent = text; c.className = 'pill ' + (cls || ''); }

      async function post(path, body) {
        const res = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body || {}),
        });
        if (!res.ok) throw new Error(path + ' → ' + res.status + ' ' + (await res.text()));
        return res.json();
      }

      $('btnCreate').onclick = async () => {
        try {
          const r = await post('/dev/session', {
            edition: $('edition').value,
            gameType: $('gameType').value,
            draftMode: $('draftMode').value,
          });
          $('sessionId').value = r.sessionId;
          log('session created: ' + r.sessionId + ' (' + r.edition + '/' + r.gameType + '/' + r.draftMode + ')', 'ok');
        } catch (e) { log(String(e), 'bad'); }
      };

      $('btnConnect').onclick = async () => {
        const sessionId = $('sessionId').value.trim();
        const userId = $('userId').value.trim();
        if (!sessionId || !userId) { log('need sessionId + userId', 'bad'); return; }
        try {
          tokens = await post('/dev/token', { userId, sessionId, staff: $('staff').checked });
          log('tokens minted for ' + userId + (tokens.staff ? ' (staff)' : ''), 'ok');
          connect(sessionId);
        } catch (e) { log(String(e), 'bad'); }
      };

      function connect(sessionId) {
        if (ws) { ws.close(); ws = null; }
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const url = proto + '://' + location.host + '/session/' + encodeURIComponent(sessionId)
          + '?identity=' + encodeURIComponent(tokens.identity)
          + '&access=' + encodeURIComponent(tokens.access);
        ws = new WebSocket(url);
        setStatus('connecting…', 'warn');
        ws.onopen = () => { setStatus('connected', 'ok'); setConn('connected', 'ok'); $('btnDisconnect').disabled = false; };
        ws.onclose = (e) => {
          setStatus('closed (' + e.code + (e.reason ? ' ' + e.reason : '') + ')', e.code === 1000 ? 'warn' : 'bad');
          setConn('disconnected'); $('btnDisconnect').disabled = true; ws = null;
        };
        ws.onerror = () => { log('ws error', 'bad'); };
        ws.onmessage = (ev) => {
          let m; try { m = JSON.parse(ev.data); } catch { log('non-JSON frame: ' + ev.data, 'bad'); return; }
          if (m.type === 'snapshot' || m.type === 'update') {
            $('state').textContent = JSON.stringify(m.snapshot, null, 2);
            if (m.type === 'update') log('update' + (m.events && m.events.length ? ' (+' + m.events.length + ' events)' : ''));
          } else if (m.type === 'ack') {
            log('ack', 'ok');
          } else if (m.type === 'reject') {
            log('reject: ' + m.code + ' — ' + m.message, 'bad');
          } else if (m.type === 'notify') {
            log('notify: ' + m.message, 'warn');
          } else if (m.type === 'closed') {
            log('session closed: ' + m.reason, 'warn');
          } else {
            log('frame: ' + ev.data);
          }
        };
      }

      $('btnDisconnect').onclick = () => { if (ws) ws.close(1000, 'user'); };

      function send(payload) {
        if (!ws || ws.readyState !== WebSocket.OPEN) { log('not connected', 'bad'); return; }
        ws.send(JSON.stringify(payload));
        log('→ ' + JSON.stringify(payload));
      }

      document.querySelectorAll('button[data-cmd]').forEach((b) => {
        b.onclick = () => {
          const raw = b.getAttribute('data-cmd');
          send(raw.startsWith('{') ? JSON.parse(raw) : { type: raw });
        };
      });

      $('btnSend').onclick = () => {
        const raw = $('customCmd').value.trim();
        if (!raw) return;
        try { send(JSON.parse(raw)); } catch (e) { log('bad JSON: ' + e, 'bad'); }
      };
    </script>
  </body>
</html>
`;
