// software-factory/providers.mjs
//
// The wire formats the factory speaks. One file, one job: take a neutral
// turn and put it on the wire in whatever dialect the provider wants, then
// take the answer apart again into the same neutral shape.
//
// WHY THIS EXISTS
// ---------------
// MiniMax speaks the Anthropic Messages API. xAI speaks the OpenAI
// Responses API (and Chat Completions, which it has deprecated). OpenCode
// Zen is a gateway whose models sit on three different endpoints depending
// on the family: /messages for Claude and Qwen, /responses for the GPTs,
// /chat/completions for everything else. Google Antigravity speaks neither
// — it is an agent harness on the Interactions API.
//
// So "call a model" is not one request. It is five.
//
// THE NEUTRAL SHAPE
// -----------------
// Everything inside the bridge uses this, and only this:
//
//   { role: 'user',      content: [{ type: 'text', text }] }
//   { role: 'assistant', content: [{ type: 'text' | 'thinking' | 'tool_use', ... }] }
//   { role: 'tool',      content: [{ type: 'tool_result', tool_use_id, content, is_error }] }
//
// Each format converts to and from it. Adding a sixth provider means
// adding a converter here, not touching the CLI.

// ---------------------------------------------------------------- formats ---

export const FORMATS = {
  // Anthropic Messages API. MiniMax direct, and OpenCode Zen's Claude and
  // Qwen models both live here.
  'anthropic-messages': {
    label: 'Anthropic Messages',
    toolLoop: true,
    supportsTools: true,
    build({ provider, model, system, messages, tools, maxTokens, reasoning, effort }) {
      const body = {
        model,
        max_tokens: maxTokens,
        messages: messages.map((m) => ({
          role: m.role === 'tool' ? 'user' : m.role,
          content: m.content.map((block) => {
            if (block.type === 'text') return { type: 'text', text: block.text };
            if (block.type === 'thinking') return { type: 'thinking', thinking: block.text, signature: block.signature };
            if (block.type === 'tool_use') return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
            if (block.type === 'tool_result') {
              return { type: 'tool_result', tool_use_id: block.tool_use_id, content: block.content, is_error: block.is_error };
            }
            return { type: 'text', text: String(block.text ?? '') };
          }),
        })),
      };
      if (system) body.system = system;
      if (tools?.length) {
        body.tools = tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        }));
        body.tool_choice = { type: 'auto' };
      }
      applyAnthropicReasoning(body, reasoning, effort);
      return { url: joinUrl(provider.base_url, provider.messages_path || '/v1/messages'), body };
    },
    parse(json) {
      const content = Array.isArray(json?.content) ? json.content : [];
      const text = content.filter((b) => b.type === 'text').map((b) => b.text || '').join('\n').trim();
      const thinking = content
        .filter((b) => b.type === 'thinking')
        .map((b) => b.thinking || '')
        .join('\n')
        .trim();
      const toolCalls = content
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, input: b.input || {} }));
      return {
        text,
        thinking,
        toolCalls,
        stopReason: json?.stop_reason || null,
        usage: {
          input_tokens: json?.usage?.input_tokens || 0,
          output_tokens: json?.usage?.output_tokens || 0,
          cache_read_input_tokens: json?.usage?.cache_read_input_tokens || 0,
        },
      };
    },
  },

  // OpenAI Chat Completions. OpenCode Zen's "everything else" models.
  // xAI still serves it but has deprecated it in favour of Responses.
  'openai-chat': {
    label: 'OpenAI Chat Completions',
    toolLoop: true,
    supportsTools: true,
    build({ provider, model, system, messages, tools, maxTokens, reasoning, effort }) {
      const out = [];
      if (system) out.push({ role: 'system', content: system });
      for (const m of messages) {
        if (m.role === 'tool') {
          for (const block of m.content) {
            out.push({ role: 'tool', tool_call_id: block.tool_use_id, content: block.content });
          }
          continue;
        }
        const text = m.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n');
        const toolCalls = m.content
          .filter((b) => b.type === 'tool_use')
          .map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } }));
        const message = { role: m.role, content: text || null };
        if (toolCalls.length) message.tool_calls = toolCalls;
        out.push(message);
      }
      const body = { model, messages: out };
      if (maxTokens) body.max_tokens = maxTokens;
      if (tools?.length) {
        body.tools = tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
        body.tool_choice = 'auto';
      }
      if (reasoning?.style === 'openai-effort' && effort) body.reasoning_effort = effort;
      return { url: joinUrl(provider.base_url, provider.chat_path || '/v1/chat/completions'), body };
    },
    parse(json) {
      const message = json?.choices?.[0]?.message || {};
      const toolCalls = (message.tool_calls || []).map((c) => ({
        id: c.id,
        name: c.function?.name,
        input: safeJson(c.function?.arguments),
      }));
      return {
        text: typeof message.content === 'string' ? message.content.trim() : '',
        thinking: typeof message.reasoning_content === 'string' ? message.reasoning_content.trim() : '',
        toolCalls,
        stopReason: json?.choices?.[0]?.finish_reason || null,
        usage: {
          input_tokens: json?.usage?.prompt_tokens || 0,
          output_tokens: json?.usage?.completion_tokens || 0,
          cache_read_input_tokens: json?.usage?.prompt_tokens_details?.cached_tokens || 0,
        },
      };
    },
  },

  // OpenAI Responses API. xAI's recommended surface, and OpenCode Zen's
  // GPT and Muse models.
  'openai-responses': {
    label: 'OpenAI Responses',
    toolLoop: true,
    supportsTools: true,
    build({ provider, model, system, messages, tools, maxTokens, reasoning, effort }) {
      const input = [];
      // xAI's own docs send the system turn as a plain string, so do that
      // rather than an input_text array — one fewer way for the request to
      // be rejected on a shape detail.
      if (system) input.push({ role: 'system', content: system });
      for (const m of messages) {
        if (m.role === 'tool') {
          for (const block of m.content) {
            input.push({ type: 'function_call_output', call_id: block.tool_use_id, output: block.content });
          }
          continue;
        }
        const text = m.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n');
        const calls = m.content.filter((b) => b.type === 'tool_use');
        if (calls.length) {
          for (const c of calls) {
            input.push({ type: 'function_call', call_id: c.id, name: c.name, arguments: JSON.stringify(c.input || {}) });
          }
          if (text) input.push({ role: m.role, content: [{ type: 'output_text', text }] });
          continue;
        }
        input.push({
          role: m.role,
          content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text }],
        });
      }
      const body = { model, input, store: false };
      if (maxTokens) body.max_output_tokens = maxTokens;
      if (tools?.length) {
        body.tools = tools.map((t) => ({
          type: 'function',
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }));
        body.tool_choice = 'auto';
      }
      if (reasoning?.style === 'openai-effort') {
        body.reasoning = { effort: effort || reasoning.default || 'medium' };
        // xAI returns the model's thinking as an encrypted item. Sending it
        // back unchanged is what keeps the model on its plan across a tool
        // loop — drop it and every turn starts from scratch.
        body.include = ['reasoning.encrypted_content'];
      }
      return { url: joinUrl(provider.base_url, provider.responses_path || '/v1/responses'), body };
    },
    parse(json) {
      const output = Array.isArray(json?.output) ? json.output : [];
      const text = output
        .filter((item) => item.type === 'message')
        .flatMap((item) => item.content || [])
        .filter((c) => c.type === 'output_text')
        .map((c) => c.text || '')
        .join('\n')
        .trim();
      const thinking = output
        .filter((item) => item.type === 'reasoning')
        .flatMap((item) => item.summary || [])
        .map((s) => s.text || '')
        .join('\n')
        .trim();
      const toolCalls = output
        .filter((item) => item.type === 'function_call')
        .map((item) => ({ id: item.call_id, name: item.name, input: safeJson(item.arguments) }));
      return {
        text,
        thinking,
        toolCalls,
        stopReason: json?.status || json?.incomplete_details?.reason || null,
        usage: {
          input_tokens: json?.usage?.input_tokens || 0,
          output_tokens: json?.usage?.output_tokens || 0,
          cache_read_input_tokens: json?.usage?.input_tokens_details?.cached_tokens || 0,
        },
      };
    },
  },

  // Google Antigravity on the Gemini Interactions API. This one is not a
  // chat model — it is a managed agent that plans, runs code and browses
  // inside a Google-hosted Linux sandbox. There are no client-side tools
  // to declare, and it cannot touch the local repo.
  'gemini-interactions': {
    label: 'Gemini Interactions (Antigravity agent)',
    toolLoop: false,
    supportsTools: false,
    build({ provider, model, system, messages, tools, maxTokens }) {
      const input = messages
        .map((m) =>
          m.content
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('\n'),
        )
        .filter(Boolean)
        .join('\n\n');
      const body = {
        agent: provider.agent || 'antigravity-preview-09-2026',
        input: system ? `${system}\n\n---\n\n${input}` : input,
        environment: provider.environment || 'remote',
      };
      if (provider.agent_config?.model) {
        body.agent_config = { type: 'antigravity', model: provider.agent_config.model };
      } else {
        body.agent_config = { type: 'antigravity', model: model };
      }
      return { url: joinUrl(provider.base_url, provider.interaction_path || '/v1beta/interactions'), body };
    },
    parse(json) {
      // The Interactions API response shape is not pinned down in the
      // public docs, so this walks a list of the places a final answer can
      // plausibly live rather than betting on one shape. The raw body is
      // still returned in --json mode for anything this misses.
      const text = firstText(json) || '';
      return {
        text,
        thinking: '',
        toolCalls: [],
        stopReason: json?.status || null,
        usage: {
          input_tokens: json?.usage?.input_tokens || json?.usageMetadata?.promptTokenCount || 0,
          output_tokens: json?.usage?.output_tokens || json?.usageMetadata?.candidatesTokenCount || 0,
          cache_read_input_tokens: json?.usage?.cache_read_input_tokens || 0,
        },
      };
    },
  },

  // A local agent CLI. `agy -p` (Antigravity) and `opencode run` both take
  // a prompt and return text. The agent brings its own tools and its own
  // permissions — it runs with the local user's rights, NOT the bridge's
  // allowlist. That is a different safety model and the config says so.
  cli: {
    label: 'Local agent CLI',
    toolLoop: false,
    supportsTools: false,
    build({ provider, model, system, messages }) {
      const prompt = messages
        .map((m) =>
          m.content
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('\n'),
        )
        .filter(Boolean)
        .join('\n\n');
      const args = [...(provider.args || [])];
      if (provider.model_flag && model) args.push(provider.model_flag, model);
      if (provider.effort_flag && provider.effort) args.push(provider.effort_flag, provider.effort);
      return {
        command: provider.command,
        args,
        stdin: system ? `${system}\n\n---\n\n${prompt}` : prompt,
      };
    },
    parse(stdout) {
      return {
        text: String(stdout || '').trim(),
        thinking: '',
        toolCalls: [],
        stopReason: null,
        usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 },
      };
    },
  },
};

// ---------------------------------------------------------------- helpers ---

function joinUrl(base, path) {
  const b = String(base || '').replace(/\/+$/, '');
  const p = String(path || '');
  if (/^https?:\/\//i.test(p)) return p;
  return `${b}${p.startsWith('/') ? '' : '/'}${p}`;
}

function safeJson(value) {
  if (typeof value !== 'string') return value || {};
  try {
    return JSON.parse(value);
  } catch {
    return { _raw: value };
  }
}

// Anthropic has three different thinking shapes and one of them is the
// reason the first draft of the router was wrong: output_config.effort
// exists ONLY on MiniMax-M3.1-Flash.
function applyAnthropicReasoning(body, reasoning, effort) {
  if (!reasoning) return;
  if (reasoning.style === 'anthropic-budget') {
    body.thinking = { type: 'enabled', budget_tokens: reasoning.budget_tokens || 4096 };
    return;
  }
  if (reasoning.style === 'anthropic-adaptive') {
    body.thinking = { type: 'adaptive' };
    return;
  }
  if (reasoning.style === 'anthropic-effort') {
    body.thinking = { type: 'adaptive' };
    if (effort) body.output_config = { effort };
  }
}

// The Interactions API does not document one response shape. Walk the
// plausible places for a final answer.
function firstText(json) {
  const candidates = [
    json?.output_text,
    json?.text,
    json?.output,
    json?.result,
    json?.content,
    json?.response,
    json?.final_output,
  ];
  for (const c of candidates) {
    const t = extractTextDeep(c);
    if (t) return t;
  }
  if (Array.isArray(json?.candidates)) {
    for (const cand of json.candidates) {
      const t = extractTextDeep(cand?.content?.parts);
      if (t) return t;
    }
  }
  if (Array.isArray(json?.steps)) {
    for (const step of [...json.steps].reverse()) {
      const t = extractTextDeep(step);
      if (t) return t;
    }
  }
  return '';
}

function extractTextDeep(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    const parts = value.map((v) => extractTextDeep(v)).filter(Boolean);
    return parts.join('\n').trim();
  }
  if (value && typeof value === 'object') {
    for (const key of ['text', 'content', 'message', 'output', 'answer', 'summary']) {
      if (value[key] !== undefined) {
        const t = extractTextDeep(value[key]);
        if (t) return t;
      }
    }
  }
  return '';
}

export { joinUrl };
