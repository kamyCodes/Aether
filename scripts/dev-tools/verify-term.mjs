// E2E verify: shell-integrated terminal session over the app's WS.
import WebSocket from 'ws';
import { configDefault, hostDefault } from '../read-config.mjs';

const ws = new WebSocket(`ws://${hostDefault()}:${configDefault('PORT')}/ws`);
let created = null;
let integrated = null;
let raw = '';
const commands = [];
let cwdEvents = 0;
let sawC = false; // 633;C seen (command-executed marker)

ws.on('open', () =>
  ws.send(JSON.stringify({ type: 'term:create', payload: { cwd: process.cwd() } })),
);
ws.on('message', (m) => {
  const { type, payload } = JSON.parse(m);
  if (type === 'term:created') {
    created = payload.id;
    integrated = payload.integrated;
    setTimeout(
      () =>
        ws.send(
          JSON.stringify({
            type: 'term:input',
            payload: { id: created, data: 'echo aether-e2e-ok\r' },
          }),
        ),
      2000,
    );
    setTimeout(
      () =>
        ws.send(
          JSON.stringify({
            type: 'term:input',
            payload: { id: created, data: 'node -e "process.exit(3)"\r' },
          }),
        ),
      4000,
    );
  }
  if (type === 'term:data') {
    raw += payload.data;
    if (/\x1b\]633;C/.test(payload.data)) sawC = true;
  }
  if (type === 'term:command') commands.push(payload.command ?? payload);
  if (type === 'term:cwd') cwdEvents++;
});

setTimeout(() => {
  console.log('integration flag:', integrated);
  console.log('633;A markers:', /\x1b\]633;A/.test(raw));
  console.log('633;C markers (command executed):', sawC);
  console.log('633;D markers:', (raw.match(/\x1b\]633;D/g) || []).length);
  console.log(
    'structured commands received:',
    JSON.stringify(
      commands.map((c) => ({ cmd: c.command, code: c.exitCode, cwd: c.cwd?.split('\\').pop() })),
    ),
  );
  console.log('cwd events:', cwdEvents);
  // The leak check: visible >> after stripping complete OSC sequences.
  const stripped = raw.replace(/\x1b\]633;[^\x07\x1b]*(\x07|\x1b\\)?/g, '');
  console.log('visible >>> artifact:', />{3,}/.test(stripped));
  const idx = stripped.indexOf('>>');
  if (idx >= 0)
    console.log('context:', JSON.stringify(stripped.slice(Math.max(0, idx - 80), idx + 40)));
  ws.send(JSON.stringify({ type: 'term:kill', payload: { id: created } }));
  setTimeout(() => process.exit(0), 300);
}, 12000);
