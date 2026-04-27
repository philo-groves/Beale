import { describe, expect, it } from 'vitest';
import { OpenAiResponsesAdapter } from '../src/main/openaiAdapter';
import { OpenAiAuthService } from '../src/main/openaiAuth';

const runLive = process.env.BEALE_LIVE_OPENAI_TEST === '1';
const maybeIt = runLive ? it : it.skip;

describe('OpenAI live smoke', () => {
  maybeIt('streams a minimal Responses API request through the configured host credential', async () => {
    const auth = new OpenAiAuthService();
    const credential = auth.getCredential();
    if (!credential) {
      throw new Error('Set BEALE_OPENAI_AUTH_COMMAND, BEALE_OPENAI_ACCESS_TOKEN, or OPENAI_API_KEY to run the live OpenAI smoke test.');
    }

    const adapter = new OpenAiResponsesAdapter(auth);
    const body = adapter.buildRequest({
      model: process.env.BEALE_OPENAI_LIVE_MODEL ?? 'gpt-5.5',
      instructions: 'Return exactly BEALE_OK and no other text.',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Return exactly BEALE_OK.' }]
        }
      ],
      tools: [],
      reasoning: { effort: 'low' },
      text: { verbosity: 'low' },
      metadata: { beale_live_smoke: 'true' }
    });

    let output = '';
    for await (const event of adapter.streamResponse({ body })) {
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') output += event.delta;
      if (event.type === 'response.output_text.done' && typeof event.text === 'string') output = event.text;
    }

    expect(output.trim()).toBe('BEALE_OK');
  });
});
