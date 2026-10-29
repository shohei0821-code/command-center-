const EMPTY = { tasks: [], events: [], theme: 'dark' };
const MAX_STATE_BYTES = 500_000;
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/tasks';
const APP_URL = 'https://shohei0821-code.github.io/command-center-/';

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

async function ensureGoogleSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS google_oauth (
    id TEXT PRIMARY KEY CHECK (id = 'google'),
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS google_oauth_states (
    state_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  )`).run();
}

function hexBytes(hex) {
  if (!/^[a-f0-9]{64}$/i.test(hex || '')) throw new Error('Google credential encryption key is not configured');
  return Uint8Array.from(hex.match(/.{2}/g), part => parseInt(part, 16));
}

async function credentialKey(env) {
  return crypto.subtle.importKey('raw', hexBytes(env.CREDENTIALS_KEY), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptCredentials(env, credentials) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(credentials));
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM', iv}, await credentialKey(env), data);
  return {iv:btoa(String.fromCharCode(...iv)), ciphertext:btoa(String.fromCharCode(...new Uint8Array(ciphertext)))};
}

async function decryptCredentials(env, row) {
  const ciphertext = Uint8Array.from(atob(row.ciphertext), char => char.charCodeAt(0));
  const iv = Uint8Array.from(atob(row.iv), char => char.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv}, await credentialKey(env), ciphertext);
  return JSON.parse(new TextDecoder().decode(plain));
}

async function googleAccessToken(db, env) {
  const row = await db.prepare("SELECT ciphertext, iv FROM google_oauth WHERE id = 'google'").first();
  if (!row) throw Object.assign(new Error('Google Tasks is not connected'), {status:409});
  const credentials = await decryptCredentials(env, row);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID, client_secret:env.GOOGLE_CLIENT_SECRET, refresh_token:credentials.refresh_token, grant_type:'refresh_token'})
  });
  const token = await response.json().catch(() => ({}));
  if (!response.ok || !token.access_token) throw Object.assign(new Error('Google token refresh failed. Reconnect Google Tasks.'), {status:502});
  return token.access_token;
}

async function googleApi(db, env, path, options = {}) {
  const accessToken = await googleAccessToken(db, env);
  const response = await fetch('https://tasks.googleapis.com/tasks/v1' + path, {
    ...options, headers:{Authorization:'Bearer ' + accessToken, ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers || {})}
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error?.message || 'Google Tasks request failed'), {status:response.status});
  return payload;
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

    if (url.pathname === '/oauth/google/callback' && request.method === 'GET') {
      try {
        await ensureGoogleSchema(env.DB);
        const state = url.searchParams.get('state') || '';
        const stateHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state));
        const encodedHash = btoa(String.fromCharCode(...new Uint8Array(stateHash)));
        const savedState = await env.DB.prepare('SELECT expires_at FROM google_oauth_states WHERE state_hash = ?').bind(encodedHash).first();
        await env.DB.prepare('DELETE FROM google_oauth_states WHERE state_hash = ?').bind(encodedHash).run();
        if (!state || !savedState || savedState.expires_at < Math.floor(Date.now()/1000)) return Response.redirect(APP_URL + '?google=state-error', 302);
        if (url.searchParams.get('error')) return Response.redirect(APP_URL + '?google=cancelled', 302);
        if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.CREDENTIALS_KEY) return Response.redirect(APP_URL + '?google=server-config-error', 302);
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
          method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({code:url.searchParams.get('code') || '', client_id:env.GOOGLE_CLIENT_ID, client_secret:env.GOOGLE_CLIENT_SECRET, redirect_uri:url.origin + '/oauth/google/callback', grant_type:'authorization_code'})
        });
        const token = await tokenResponse.json().catch(() => ({}));
        if (!tokenResponse.ok || !token.access_token) return Response.redirect(APP_URL + '?google=token-error', 302);
        const previous = await env.DB.prepare("SELECT ciphertext, iv FROM google_oauth WHERE id = 'google'").first();
        const existing = previous ? await decryptCredentials(env, previous) : {};
        const credentials = {refresh_token:token.refresh_token || existing.refresh_token, scope:token.scope || GOOGLE_SCOPE, connected_at:new Date().toISOString()};
        if (!credentials.refresh_token) return Response.redirect(APP_URL + '?google=offline-access-error', 302);
        const encrypted = await encryptCredentials(env, credentials);
        await env.DB.prepare("INSERT INTO google_oauth (id, ciphertext, iv, updated_at) VALUES ('google', ?, ?, ?) ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext, iv=excluded.iv, updated_at=excluded.updated_at")
          .bind(encrypted.ciphertext, encrypted.iv, new Date().toISOString()).run();
        return Response.redirect(APP_URL + '?google=connected', 302);
      } catch (_) {
        return Response.redirect(APP_URL + '?google=server-error', 302);
      }
    }

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
      if (parts[1] === 'google') {
        if (!['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','CREDENTIALS_KEY'].every(key => env[key])) return json(request,{error:'Google Tasks integration is not configured'},503);
        await ensureGoogleSchema(env.DB);
        if (parts.length === 3 && parts[2] === 'connect' && request.method === 'POST') {
          const random = crypto.getRandomValues(new Uint8Array(32));
          const state = btoa(String.fromCharCode(...random)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
          const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state));
          const stateHash = btoa(String.fromCharCode(...new Uint8Array(hash)));
          const expiresAt = Math.floor(Date.now()/1000) + 600;
          await env.DB.prepare('DELETE FROM google_oauth_states WHERE expires_at < ?').bind(Math.floor(Date.now()/1000)).run();
          await env.DB.prepare('INSERT INTO google_oauth_states (state_hash, expires_at) VALUES (?, ?)').bind(stateHash, expiresAt).run();
          const callback = url.origin + '/oauth/google/callback';
          const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
          auth.search = new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID, redirect_uri:callback, response_type:'code', scope:GOOGLE_SCOPE, access_type:'offline', prompt:'consent', state}).toString();
          return json(request,{authorizationUrl:auth.toString()});
        }
        if (parts.length === 3 && parts[2] === 'status' && request.method === 'GET') {
          const row = await env.DB.prepare("SELECT updated_at FROM google_oauth WHERE id = 'google'").first();
          return json(request,{connected:!!row, connectedAt:row?.updated_at || null});
        }
        if (parts.length === 3 && parts[2] === 'disconnect' && request.method === 'POST') {
          await env.DB.prepare("DELETE FROM google_oauth WHERE id = 'google'").run();
          return json(request,{connected:false});
        }
        if (parts.length === 3 && parts[2] === 'lists' && request.method === 'GET') {
          const result = await googleApi(env.DB,env,'/users/@me/lists?maxResults=100');
          return json(request,{items:(result.items || []).map(item=>({id:item.id,title:item.title,updated:item.updated}))});
        }
        if (parts.length === 3 && parts[2] === 'tasks' && request.method === 'GET') {
          const listId = url.searchParams.get('listId');
          if (!listId) return json(request,{error:'listId is required'},400);
          const result = await googleApi(env.DB,env,'/lists/' + encodeURIComponent(listId) + '/tasks?maxResults=100&showCompleted=true&showHidden=true');
          return json(request,{items:(result.items || []).map(item=>({id:item.id,title:item.title,status:item.status,due:item.due || '',updated:item.updated,notes:item.notes || '',parent:item.parent || ''}))});
        }
        if (parts.length === 3 && parts[2] === 'tasks' && request.method === 'POST') {
          const body = await bodyJson(request);
          if (!body.listId || !cleanText(body.title,200)) return json(request,{error:'listId and title are required'},400);
          const task = await googleApi(env.DB,env,'/lists/' + encodeURIComponent(body.listId) + '/tasks',{method:'POST',body:JSON.stringify({title:cleanText(body.title,200),notes:cleanText(body.notes,8000),...(body.due && /^\d{4}-\d{2}-\d{2}$/.test(body.due) ? {due:body.due+'T00:00:00.000Z'} : {})})});
          return json(request,{item:task},201);
        }
        if (parts.length === 5 && parts[2] === 'tasks' && ['PATCH','DELETE'].includes(request.method)) {
          const listId = decodeURIComponent(parts[3]), taskId = decodeURIComponent(parts[4]);
          const path = '/lists/' + encodeURIComponent(listId) + '/tasks/' + encodeURIComponent(taskId);
          if (request.method === 'DELETE') { await googleApi(env.DB,env,path,{method:'DELETE'}); return json(request,{deleted:taskId}); }
          const body = await bodyJson(request);
          const updated = await googleApi(env.DB,env,path,{method:'PATCH',body:JSON.stringify({...(body.title !== undefined ? {title:cleanText(body.title,200)} : {}), ...(body.status === 'completed' || body.status === 'needsAction' ? {status:body.status} : {}), ...(body.notes !== undefined ? {notes:cleanText(body.notes,8000)} : {}), ...(body.due !== undefined ? {due:/^\d{4}-\d{2}-\d{2}$/.test(body.due) ? body.due+'T00:00:00.000Z' : null} : {})})});
          return json(request,{item:updated});
        }
      }
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
