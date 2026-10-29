const EMPTY = { tasks: [], events: [], theme: 'dark' };
const MAX_STATE_BYTES = 500_000;

function cors(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = origin === 'https://shohei0821-code.github.io' || origin === 'https://chatgpt.com' || origin === 'https://chat.openai.com' || /^http:\/\/localhost(?::\d+)?$/.test(origin);
  return allowed ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type,Accept,MCP-Protocol-Version',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  } : {};
}

function json(request, body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(request), ...extra } });
}

function cleanText(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeTask(input, current = {}) {
  const title = cleanText(input.title ?? current.title);
  if (!title) throw new Error('title is required');
  const priority = ['high', 'medium', 'low'].includes(input.priority ?? current.priority) ? (input.priority ?? current.priority) : 'medium';
  const dueDate = cleanText(input.dueDate ?? current.dueDate, 10);
  return {
    ...current,
    id: current.id || cleanText(input.id, 100) || crypto.randomUUID(),
    title,
    category: cleanText(input.category ?? current.category, 80) || '個人',
    priority,
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : '',
    done: typeof input.done === 'boolean' ? input.done : !!current.done,
    sample: false,
    updatedAt: new Date().toISOString()
  };
}

function normalizeEvent(input, current = {}) {
  const title = cleanText(input.title ?? current.title);
  if (!title) throw new Error('title is required');
  const date = cleanText(input.date ?? current.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date must use YYYY-MM-DD');
  const time = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '') ? value : '';
  return {
    ...current,
    id: current.id || cleanText(input.id, 100) || crypto.randomUUID(),
    title,
    date,
    start: time(cleanText(input.start ?? current.start, 5)),
    end: time(cleanText(input.end ?? current.end, 5)),
    location: cleanText(input.location ?? current.location, 200),
    updatedAt: new Date().toISOString()
  };
}

async function getSnapshot(db) {
  const row = await db.prepare("SELECT payload, revision, updated_at FROM app_state WHERE id = 'main'").first();
  if (!row) throw new Error('Database is not initialized. Apply worker/schema.sql first.');
  let data;
  try { data = JSON.parse(row.payload); } catch (_) { data = EMPTY; }
  return { revision: row.revision, updatedAt: row.updated_at, data: { tasks: Array.isArray(data.tasks) ? data.tasks : [], events: Array.isArray(data.events) ? data.events : [], theme: data.theme === 'light' ? 'light' : 'dark' } };
}

async function replaceSnapshot(db, expectedRevision, data) {
  const serialized = JSON.stringify(data);
  if (new TextEncoder().encode(serialized).length > MAX_STATE_BYTES) throw new Error('State exceeds 500 KB');
  const updatedAt = new Date().toISOString();
  const result = await db.prepare("UPDATE app_state SET payload = ?, revision = revision + 1, updated_at = ? WHERE id = 'main' AND revision = ?")
    .bind(serialized, updatedAt, expectedRevision).run();
  return result.meta?.changes === 1;
}

function safeImportedState(input) {
  if (!input || !Array.isArray(input.tasks) || !Array.isArray(input.events)) throw new Error('tasks and events arrays are required');
  if (input.tasks.some(item => !item || typeof item !== 'object' || Array.isArray(item)) || input.events.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error('Each task and event must be an object');
  return {
    tasks: input.tasks.slice(0, 5000).map(task => normalizeTask(task, { id: cleanText(task?.id, 100) })),
    events: input.events.slice(0, 5000).map(event => normalizeEvent(event, { id: cleanText(event?.id, 100) })),
    theme: input.theme === 'light' ? 'light' : 'dark'
  };
}

async function bodyJson(request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_STATE_BYTES) throw new Error('Request exceeds 500 KB');
  try { return JSON.parse(text || '{}'); } catch (_) { throw new Error('Invalid JSON'); }
}

const MCP_TOOLS = [
  {name:'list_tasks',description:'Use when the user asks to review or find Command Center tasks.',inputSchema:{type:'object',properties:{includeCompleted:{type:'boolean',description:'Include completed tasks.'}}},annotations:{readOnlyHint:true}},
  {name:'create_task',description:'Use when the user asks to add a task. Confirm ambiguous dates or priority before writing.',inputSchema:{type:'object',required:['title'],properties:{title:{type:'string',maxLength:200},category:{type:'string',maxLength:80},dueDate:{type:'string',description:'YYYY-MM-DD'},priority:{type:'string',enum:['high','medium','low']}}}},
  {name:'update_task',description:'Use when the user asks to change an existing task. Identify the task first if the target is ambiguous.',inputSchema:{type:'object',required:['id'],properties:{id:{type:'string'},title:{type:'string',maxLength:200},category:{type:'string',maxLength:80},dueDate:{type:'string',description:'YYYY-MM-DD'},priority:{type:'string',enum:['high','medium','low']},done:{type:'boolean'}}}},
  {name:'delete_task',description:'Use only when the user explicitly asks to delete a task. Confirm which task before deletion.',inputSchema:{type:'object',required:['id'],properties:{id:{type:'string'}}}},
  {name:'list_events',description:'Use when the user asks to review or find Command Center calendar events.',inputSchema:{type:'object',properties:{from:{type:'string',description:'Optional start date, YYYY-MM-DD.'},to:{type:'string',description:'Optional end date, YYYY-MM-DD.'}}},annotations:{readOnlyHint:true}},
  {name:'create_event',description:'Use when the user asks to add a calendar event. Ask about missing or ambiguous date/time before writing.',inputSchema:{type:'object',required:['title','date'],properties:{title:{type:'string',maxLength:200},date:{type:'string',description:'YYYY-MM-DD'},start:{type:'string',description:'24-hour time HH:MM'},end:{type:'string',description:'24-hour time HH:MM'},location:{type:'string',maxLength:200}}}},
  {name:'update_event',description:'Use when the user asks to change an existing event. Identify the event first if the target is ambiguous.',inputSchema:{type:'object',required:['id'],properties:{id:{type:'string'},title:{type:'string',maxLength:200},date:{type:'string',description:'YYYY-MM-DD'},start:{type:'string',description:'24-hour time HH:MM'},end:{type:'string',description:'24-hour time HH:MM'},location:{type:'string',maxLength:200}}}},
  {name:'delete_event',description:'Use only when the user explicitly asks to delete a calendar event. Confirm which event before deletion.',inputSchema:{type:'object',required:['id'],properties:{id:{type:'string'}}}}
];

async function mutateCollection(db, collection, action, id, input = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await getSnapshot(db);
    const list = current.data[collection];
    let nextList, result;
    if (action === 'create') {
      result = collection === 'tasks' ? normalizeTask(input) : normalizeEvent(input);
      nextList = [result, ...list];
    } else {
      const old = list.find(item => item.id === id);
      if (!old) throw Object.assign(new Error('Not found'), {status:404});
      if (action === 'update') {
        result = collection === 'tasks' ? normalizeTask(input, old) : normalizeEvent(input, old);
        nextList = list.map(item => item.id === id ? result : item);
      } else {
        nextList = list.filter(item => item.id !== id); result = {deleted:id};
      }
    }
    const data = {...current.data,[collection]:nextList};
    if (await replaceSnapshot(db, current.revision, data)) return { ...result, revision:current.revision + 1 };
  }
  throw Object.assign(new Error('Concurrent update; retry the request'), {status:409});
}

let jwksCache = null, jwksExpires = 0;
async function verifyMcpToken(request, env, requiredScope) {
  if (!env.AUTH_ISSUER || !env.AUTH_AUDIENCE || !env.AUTH_JWKS_URL) throw new Error('MCP OAuth is not configured');
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return false;
  try {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
    const decode = value => JSON.parse(atob(value.replace(/-/g,'+').replace(/_/g,'/')));
    const header = decode(encodedHeader), claims = decode(encodedPayload);
    if (header.alg !== 'RS256' || !header.kid) return false;
    if (!jwksCache || Date.now() > jwksExpires) {
      const response = await fetch(env.AUTH_JWKS_URL);
      if (!response.ok) return false;
      jwksCache = await response.json(); jwksExpires = Date.now() + 300_000;
    }
    const jwk = jwksCache.keys?.find(key => key.kid === header.kid && key.kty === 'RSA');
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'}, false, ['verify']);
    const signature = Uint8Array.from(atob(encodedSignature.replace(/-/g,'+').replace(/_/g,'/')), char => char.charCodeAt(0));
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, new TextEncoder().encode(encodedHeader + '.' + encodedPayload));
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const scopes = String(claims.scope || '').split(/\s+/);
    return valid && claims.iss === env.AUTH_ISSUER && audiences.includes(env.AUTH_AUDIENCE) && claims.exp > Date.now()/1000 && (!claims.nbf || claims.nbf <= Date.now()/1000) && scopes.includes(requiredScope);
  } catch (_) { return false; }
}

async function callMcpTool(db, name, args) {
  if (name === 'list_tasks') {
    const items = (await getSnapshot(db)).data.tasks.filter(item => args.includeCompleted || !item.done);
    return {items};
  }
  if (name === 'list_events') {
    const items = (await getSnapshot(db)).data.events.filter(item => (!args.from || item.date >= args.from) && (!args.to || item.date <= args.to));
    return {items};
  }
  const operations = {
    create_task:['tasks','create','',args], update_task:['tasks','update',args.id,args], delete_task:['tasks','delete',args.id,{}],
    create_event:['events','create','',args], update_event:['events','update',args.id,args], delete_event:['events','delete',args.id,{}]
  };
  const operation = operations[name];
  if (!operation) throw Object.assign(new Error('Unknown tool'), {status:404});
  const result = await mutateCollection(db, ...operation);
  return {item:result};
}

function rpc(request, id, result, error) {
  return json(request, {jsonrpc:'2.0', id:id ?? null, ...(error ? {error:{code:error.code || -32603,message:error.message || 'Request failed'}} : {result})});
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
    const url = new URL(request.url);
    const parts = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    const origin = request.headers.get('Origin');
    if (origin && !cors(request)['Access-Control-Allow-Origin']) return json(request, {error:'Origin is not allowed'}, 403);
    if (url.pathname === '/.well-known/oauth-protected-resource' && request.method === 'GET') {
      if (!env.AUTH_ISSUER) return json(request, {error:'MCP OAuth is not configured'}, 503);
      return json(request, {resource:url.origin + '/mcp', authorization_servers:[env.AUTH_ISSUER], scopes_supported:['cc:read','cc:write'], bearer_methods_supported:['header']});
    }
    if (!env.DB) return json(request, {error:'Database is not configured'}, 503);

    if (parts[0] === 'mcp') {
      const challenge = { 'WWW-Authenticate': `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource", scope="cc:read"` };
      if (!['AUTH_ISSUER','AUTH_AUDIENCE','AUTH_JWKS_URL'].every(key => env[key])) return json(request, {error:'MCP OAuth is not configured'}, 503);
      if (request.method !== 'POST') return json(request, {error:'MCP accepts POST requests'}, 405, {'Allow':'POST'});
      if (!await verifyMcpToken(request, env, 'cc:read')) return json(request, {error:'Unauthorized'}, 401, challenge);
      try {
        const message = await bodyJson(request);
        if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') return rpc(request, message.id, null, {code:-32600,message:'Invalid JSON-RPC request'});
        if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') return new Response(null,{status:202,headers:cors(request)});
        if (message.method === 'initialize') return rpc(request, message.id, {
          protocolVersion:message.params?.protocolVersion || '2025-03-26',
          capabilities:{tools:{listChanged:false}},
          serverInfo:{name:'command-center',version:'1.0.0'},
          instructions:'Use this server to manage the user’s Command Center tasks and events. Ask a brief clarification when dates or targets are ambiguous. Confirm before deleting. Report every completed write.'
        });
        if (message.method === 'ping') return rpc(request, message.id, {});
        if (message.method === 'tools/list') return rpc(request, message.id, {tools:MCP_TOOLS.map(tool => ({...tool,inputSchema:tool.inputSchema}) )});
        if (message.method === 'tools/call') {
          const name = message.params?.name, args = message.params?.arguments || {};
          const tool = MCP_TOOLS.find(item => item.name === name);
          if (!tool) return rpc(request, message.id, null, {code:-32602,message:'Unknown tool'});
          if (!tool.annotations?.readOnlyHint && !await verifyMcpToken(request, env, 'cc:write')) return json(request,{error:'Insufficient scope'},403,{'WWW-Authenticate':`Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource", scope="cc:read cc:write"`});
          try {
            const result = await callMcpTool(env.DB, name, args);
            return rpc(request, message.id, {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result});
          } catch (error) {
            return rpc(request, message.id, {isError:true,content:[{type:'text',text:error.message || 'Tool failed'}]});
          }
        }
        return rpc(request, message.id, null, {code:-32601,message:'Method not found'});
      } catch (error) { return json(request,{error:error.message || 'Invalid request'},400); }
    }

    if (!env.API_TOKEN || env.API_TOKEN.length < 32) return json(request, { error: 'PWA sync key is not configured' }, 503);
    if (request.headers.get('Authorization') !== `Bearer ${env.API_TOKEN}`) return json(request, { error: 'Unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' });
    if (parts[0] !== 'v1') return json(request, { error: 'Not found' }, 404);
    try {
      if (parts.length === 2 && parts[1] === 'state' && request.method === 'GET') return json(request, await getSnapshot(env.DB));

      if (parts.length === 2 && parts[1] === 'state' && request.method === 'PUT') {
        const body = await bodyJson(request);
        if (!Number.isInteger(body.expectedRevision)) return json(request, { error: 'expectedRevision is required' }, 400);
        const data = safeImportedState(body.data);
        const current = await getSnapshot(env.DB);
        if (current.revision !== body.expectedRevision) return json(request, { error: 'Revision conflict', ...current }, 409);
        if (!await replaceSnapshot(env.DB, current.revision, data)) return json(request, { error: 'Revision conflict', ...(await getSnapshot(env.DB)) }, 409);
        return json(request, await getSnapshot(env.DB));
      }

      if (parts.length >= 2 && ['tasks', 'events'].includes(parts[1])) {
        const collection = parts[1];
        const itemId = parts[2] ? decodeURIComponent(parts[2]) : '';
        if (!itemId && request.method === 'GET') return json(request, { items: (await getSnapshot(env.DB)).data[collection] });
        const body = ['POST', 'PATCH'].includes(request.method) ? await bodyJson(request) : {};
        for (let attempt = 0; attempt < 4; attempt++) {
          const current = await getSnapshot(env.DB);
          const data = current.data;
          const list = data[collection];
          if (!itemId && request.method === 'POST') {
            const item = collection === 'tasks' ? normalizeTask(body) : normalizeEvent(body);
            const next = { ...data, [collection]: [item, ...list] };
            if (await replaceSnapshot(env.DB, current.revision, next)) return json(request, { item, revision: current.revision + 1 }, 201);
          } else if (itemId && request.method === 'PATCH') {
            const old = list.find(item => item.id === itemId);
            if (!old) return json(request, { error: 'Not found' }, 404);
            const item = collection === 'tasks' ? normalizeTask(body, old) : normalizeEvent(body, old);
            const next = { ...data, [collection]: list.map(entry => entry.id === itemId ? item : entry) };
            if (await replaceSnapshot(env.DB, current.revision, next)) return json(request, { item, revision: current.revision + 1 });
          } else if (itemId && request.method === 'DELETE') {
            if (!list.some(item => item.id === itemId)) return json(request, { error: 'Not found' }, 404);
            const next = { ...data, [collection]: list.filter(item => item.id !== itemId) };
            if (await replaceSnapshot(env.DB, current.revision, next)) return json(request, { deleted: itemId, revision: current.revision + 1 });
          } else return json(request, { error: 'Method not allowed' }, 405);
        }
        return json(request, { error: 'Concurrent update; retry the request' }, 409);
      }
      return json(request, { error: 'Not found' }, 404);
    } catch (error) {
      const message = error?.message || 'Request failed';
      return json(request, { error: message }, /required|must use|Invalid JSON|500 KB/.test(message) ? 400 : 500);
    }
  }
};
