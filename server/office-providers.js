// Conversa com cada IA. Só o necessário: manda o briefing e devolve o texto. Quem valida é o escritório.
// As chaves vêm de variáveis de ambiente (Secrets do GitHub), nunca do repositório.
'use strict';

const KEY_ENV = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  xai: 'XAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY'
};
// Modelo usado quando o agente não define um. Confira os nomes atuais no site de cada provedor.
const DEFAULT_MODEL = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-5',
  gemini: 'gemini-2.5-pro',
  xai: 'grok-4',
  deepseek: 'deepseek-chat'
};
const CHAT = {
  openai: 'https://api.openai.com/v1/chat/completions',
  xai: 'https://api.x.ai/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions'
};

function keyName(agent) { return agent.keyEnv || KEY_ENV[agent.provider] || ''; }
function modelOf(agent) { return agent.model || DEFAULT_MODEL[agent.provider] || ''; }

function build(agent, key, system, user, maxTokens) {
  const model = modelOf(agent);
  if (agent.provider === 'anthropic') {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] },
      read: (j) => ({
        text: (j.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('\n'),
        inTok: j.usage && j.usage.input_tokens, outTok: j.usage && j.usage.output_tokens
      })
    };
  }
  if (agent.provider === 'gemini') {
    return {
      url: 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
      headers: { 'x-goog-api-key': key },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens }
      },
      read: (j) => {
        const c = j.candidates && j.candidates[0];
        return {
          text: ((c && c.content && c.content.parts) || []).map((p) => p.text || '').join('\n'),
          inTok: j.usageMetadata && j.usageMetadata.promptTokenCount, outTok: j.usageMetadata && j.usageMetadata.candidatesTokenCount
        };
      }
    };
  }
  if (CHAT[agent.provider]) {
    return {
      url: CHAT[agent.provider],
      headers: { authorization: 'Bearer ' + key },
      body: { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_object' } },
      read: (j) => ({
        text: j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '',
        inTok: j.usage && j.usage.prompt_tokens, outTok: j.usage && j.usage.completion_tokens
      })
    };
  }
  throw new Error('Provedor sem adaptador: ' + agent.provider);
}

// Devolve {text, inTok, outTok}. Lança Error (sem a chave na mensagem) em qualquer falha.
async function ask(agent, key, system, user, fetchImpl, opts) {
  const o = Object.assign({ timeoutMs: 60000, maxTokens: 1500 }, opts);
  const req = build(agent, key, system, user, o.maxTokens);
  const hide = (s) => String(s).split(key).join('***');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs);
  try {
    const res = await fetchImpl(req.url, {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json' }, req.headers),
      body: JSON.stringify(req.body),
      signal: ctl.signal
    });
    if (!res.ok) {
      let why = '';
      try { const j = await res.json(); why = (j.error && (j.error.message || j.error)) || j.message || ''; } catch (e) { /* sem corpo */ }
      throw new Error('HTTP ' + res.status + (why ? ': ' + String(why).slice(0, 160) : ''));
    }
    const out = req.read(await res.json());
    if (!out.text) throw new Error('resposta vazia');
    return { text: out.text, inTok: out.inTok || 0, outTok: out.outTok || 0 };
  } catch (e) {
    throw new Error(hide(e.name === 'AbortError' ? 'tempo esgotado (' + o.timeoutMs / 1000 + ' s)' : (e.message || e)));
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { KEY_ENV, DEFAULT_MODEL, keyName, modelOf, ask };
