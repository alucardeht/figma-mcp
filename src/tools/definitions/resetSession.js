import { z } from 'zod';

export const name = 'reset_session';

export const description = 'Clear all session state for fresh start. Use when switching files, re-exploring from scratch, or fixing corrupted state.';

export const inputSchema = {};

export async function handler(args, ctx) {
  const { session, chunker } = ctx;
  session.reset();

  const response = chunker.wrapResponse(
    { message: 'Session state cleared' },
    { step: 'Session reset', progress: 'Complete', nextStep: 'Start fresh with list_pages(file_key)' }
  );

  return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
}
