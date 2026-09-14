// OpenAI-compatible mock gateway for verifying the Aether persistence pipeline.
// Port configurable via PORT (default 20128). Flow:
//   round 1: write_file tool call
//   round 2: git_commit tool call
//   round 3: save_memory, then a final summary (stop)
// Streams SSE with usage in the final chunk. Never hardcode in app code.
import http from 'node:http';

const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 20128;
const MODEL = process.env.MOCK_MODEL ?? 'mock-coder';
const calls = [];

const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
const chunk = (res, { content, tool_calls, finish, usage, model = MODEL }) => {
  sse(res, {
    id: 'mock',
    object: 'chat.completion.chunk',
    created: Date.now(),
    model,
    choices: [
      {
        index: 0,
        delta: { ...(content ? { content } : {}), ...(tool_calls ? { tool_calls } : {}) },
        finish_reason: finish ?? null,
      },
    ],
    ...(usage ? { usage } : {}),
  });
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: MODEL, object: 'model' }] }));
    return;
  }
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', async () => {
      const parsed = JSON.parse(body);
      const lastMsg = parsed.messages[parsed.messages.length - 1];
      const toolMsgCount = parsed.messages.filter((m) => m.role === 'tool').length;
      calls.push(lastMsg?.role);
      const sysText = parsed.messages
        .filter((m) => m.role === 'system')
        .map((m) => (typeof m.content === 'string' ? m.content : ''))
        .join(' ');

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      // Small delay so UI verification can catch the live run (tool cards,
      // Actions dropdown, step transitions) before completion.
      await new Promise((r) => setTimeout(r, Number(process.env.MOCK_DELAY_MS ?? 0)));

      // Plan-drafting request → return a markdown plan artifact.
      if (sysText.includes('implementation plan')) {
        chunk(res, {
          content:
            '# Plan: add greet helper\n\n1. Create `utils/greeting.ts` exporting `greet(name)`\n2. Add `utils/greeting.test.ts` with two assertions\n3. Run the test to verify\n\n**Why:** smallest change that satisfies the request; pure function, no deps.',
        });
        chunk(res, { finish: 'stop', usage: { prompt_tokens: 350, completion_tokens: 60 } });
        res.end();
        return;
      }
      // Steps-generation request → JSON array of Task List steps.
      if (sysText.includes('JSON array of 2-6 short step strings')) {
        chunk(res, {
          content:
            '["read existing utils files","create utils/greeting.ts with greet(name)","add a test for greet","run the test to verify"]',
        });
        chunk(res, { finish: 'stop', usage: { prompt_tokens: 280, completion_tokens: 40 } });
        res.end();
        return;
      }

      if (lastMsg?.role === 'tool' && toolMsgCount >= 2) {
        // round 3: save memory then finish
        chunk(res, {
          tool_calls: [
            {
              index: 0,
              id: 'call_mem',
              type: 'function',
              function: {
                name: 'save_memory',
                arguments: JSON.stringify({
                  text: 'Pipeline verification ran; db-verify.md committed by the agent',
                }),
              },
            },
          ],
        });
        chunk(res, { finish: 'tool_calls', usage: { prompt_tokens: 500, completion_tokens: 40 } });
      } else if (lastMsg?.role === 'tool' && toolMsgCount === 1) {
        // round 2: commit the file
        chunk(res, {
          tool_calls: [
            {
              index: 0,
              id: 'call_commit',
              type: 'function',
              function: {
                name: 'git_commit',
                arguments: JSON.stringify({ message: 'add db verification note' }),
              },
            },
          ],
        });
        chunk(res, { finish: 'tool_calls', usage: { prompt_tokens: 400, completion_tokens: 60 } });
      } else if (lastMsg?.role === 'tool') {
        // round 4+: wrap up
        chunk(res, { content: 'Verification complete: db-verify.md created and committed.' });
        chunk(res, { finish: 'stop', usage: { prompt_tokens: 300, completion_tokens: 30 } });
      } else {
        // round 1: create the file
        chunk(res, { content: 'Creating db-verify.md, then committing it.' });
        chunk(res, {
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: {
                name: 'write_file',
                arguments: JSON.stringify({
                  path: 'db-verify.md',
                  content:
                    '# Verification\n\nAn autonomous coding agent IDE lets an AI plan, edit, run, and verify code in a real workspace with user approval gates.\nIt records every step — files, actions, model usage, and commits — so the work is auditable afterwards.\n',
                }),
              },
            },
          ],
          finish: 'tool_calls',
          usage: { prompt_tokens: 900, completion_tokens: 80 },
        });
      }
      res.end();
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => console.log(`mock OmniRoute on :${PORT} (model: ${MODEL})`));
