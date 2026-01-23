import { z } from 'zod';

export const name = 'repeat_last';

export const description = 'Repeat last response without new API calls. Returns cached session state. Use for context recovery or re-referencing previous data.';

export const inputSchema = {};

export async function handler(args, ctx) {
  const { session, chunker } = ctx;
  const lastResponse = session.getLastResponse();

  if (!lastResponse) {
    const response = chunker.wrapResponse(
      { message: 'No previous response in session' },
      { step: 'Repeat failed', nextStep: 'Make a request first, then use repeat_last' }
    );
    return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
  }

  return lastResponse;
}
