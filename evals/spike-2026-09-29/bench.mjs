// usage: node bench.mjs <model> <runs> [extraJSON] [label]
const [,, model, runsArg='5', extraArg='{}', label=''] = process.argv;
const extra = JSON.parse(extraArg);
const KEY = process.env.NEBIUS_API_KEY;
const sys = "You are Sage, a sharp, warm AI-engineer interview coach speaking out loud. Keep replies under 60 words, no markdown.";
const user = "My answer: to reduce hallucinations in our RAG app I would just use a bigger model and a longer prompt. What do you think?";
async function once() {
  const t0 = performance.now();
  const res = await fetch('https://api.tokenfactory.nebius.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: true, stream_options: { include_usage: true }, max_tokens: 400, temperature: 0.6,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], ...extra })
  });
  if (!res.ok) return { err: res.status + ' ' + (await res.text()).slice(0, 200) };
  const dec = new TextDecoder(); let buf = '', tFirstAny = null, tFirstContent = null, tLast = null, usage = null, content = '', reasoningChars = 0;
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i; while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue; const d = line.slice(5).trim(); if (d === '[DONE]') continue;
      let j; try { j = JSON.parse(d); } catch { continue; }
      if (j.usage) usage = j.usage;
      const delta = j.choices?.[0]?.delta || {};
      const r = delta.reasoning_content || delta.reasoning || '';
      const now = performance.now();
      if ((r || delta.content) && tFirstAny === null) tFirstAny = now;
      if (r) reasoningChars += r.length;
      if (delta.content) { if (tFirstContent === null) tFirstContent = now; content += delta.content; tLast = now; }
    }
  }
  const tEnd = performance.now();
  const ct = usage?.completion_tokens ?? null;
  const tps = ct && tFirstAny ? ct / ((tEnd - tFirstAny) / 1000) : null;
  return { ttftAny: tFirstAny - t0, ttftContent: tFirstContent ? tFirstContent - t0 : null, total: tEnd - t0, ct, tps, reasoningChars, content };
}
const out = [];
for (let k = 0; k < +runsArg; k++) out.push(await once());
const ok = out.filter(o => !o.err);
const med = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const f = x => x == null ? 'n/a' : Math.round(x);
console.log(`${model} ${label} runs=${ok.length}/${out.length} | TTFT(content) med ${f(med(ok.map(o=>o.ttftContent)))}ms [${ok.map(o=>f(o.ttftContent)).join(',')}] | TTFT(any) med ${f(med(ok.map(o=>o.ttftAny)))}ms | tok/s med ${f(med(ok.map(o=>o.tps)))} | completion_tokens med ${f(med(ok.map(o=>o.ct)))} | reasoningChars med ${f(med(ok.map(o=>o.reasoningChars)))} | total med ${f(med(ok.map(o=>o.total)))}ms`);
out.filter(o=>o.err).forEach(o=>console.log('  ERR', o.err));
if (ok[0]) console.log('  sample:', ok[0].content.replace(/\s+/g,' ').slice(0, 300));
