// node tools.mjs <model> <runs> <extraJSON> <lang>
const [,, model, runsArg='5', extraArg='{}', lang='en'] = process.argv;
const extra = JSON.parse(extraArg); const KEY = process.env.NEBIUS_API_KEY;
const sys = `You are Sage, an AI-engineer interview coach speaking out loud${lang==='es'?' in Spanish (Mexico)':''}. The candidate just answered your question "How would you reduce hallucinations in a production RAG system?". Do exactly this: say ONE sharp, specific pushback on their answer in under 40 words (plain speech, no markdown), then call the tool record_pushback with a short summary. Always call the tool.`;
const user = lang==='es' ? "Pues yo usaría un modelo más grande y un prompt más largo, con eso se arregla casi todo." : "I'd use a bigger model and a longer prompt, that fixes most of it.";
const tools = [{ type:'function', function:{ name:'record_pushback', description:'Record the coach pushback for the scorecard', parameters:{ type:'object', properties:{ weakness:{type:'string', description:'the specific weakness in the answer'}, severity:{type:'string', enum:['low','medium','high']} }, required:['weakness','severity'] } } }];
async function once(){
  const t0=performance.now();
  const res=await fetch('https://api.tokenfactory.nebius.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({model,stream:true,max_tokens:500,temperature:0.6,tools,tool_choice:'auto',messages:[{role:'system',content:sys},{role:'user',content:user}],...extra})});
  if(!res.ok) return {err:res.status+' '+(await res.text()).slice(0,200)};
  const dec=new TextDecoder(); let buf='',tFirst=null,content='',args='',name='',reasoning=0;
  for await(const chunk of res.body){buf+=dec.decode(chunk,{stream:true}); let i; while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i).trim();buf=buf.slice(i+1);
    if(!line.startsWith('data:'))continue;const d=line.slice(5).trim();if(d==='[DONE]')continue;let j;try{j=JSON.parse(d)}catch{continue}
    const delta=j.choices?.[0]?.delta||{}; if(delta.reasoning_content||delta.reasoning) reasoning++;
    if((delta.content||delta.tool_calls)&&tFirst===null)tFirst=performance.now()-t0;
    if(delta.content)content+=delta.content;
    for(const tc of delta.tool_calls||[]){if(tc.function?.name)name+=tc.function.name;if(tc.function?.arguments)args+=tc.function.arguments;}}}
  let valid=false; try{const a=JSON.parse(args); valid=name==='record_pushback'&&!!a.weakness&&['low','medium','high'].includes(a.severity)}catch{}
  return {tFirst,content:content.trim(),name,args,valid,reasoning};
}
const out=[];for(let k=0;k<+runsArg;k++)out.push(await once());
const ok=out.filter(o=>!o.err);
console.log(`${model} ${lang} ${extraArg} | valid tool calls ${ok.filter(o=>o.valid).length}/${out.length} | spoke before tool ${ok.filter(o=>o.content.length>10).length}/${out.length} | TTFT(content or tool) [${ok.map(o=>Math.round(o.tFirst)).join(',')}]`);
out.filter(o=>o.err).forEach(o=>console.log('  ERR',o.err));
ok.slice(0,2).forEach(o=>console.log('  said:',o.content.replace(/\s+/g,' ').slice(0,260),'| tool:',o.name,o.args.slice(0,140)));
