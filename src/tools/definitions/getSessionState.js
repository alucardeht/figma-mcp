import { z } from 'zod';

export const name = 'get_session_state';

export const description = 'Get current session state for debugging. Returns current file, pages/frames sent, pending operations, and last update timestamp.';

export const inputSchema = {};

export async function handler(args, ctx) {
  const { session, chunker } = ctx;
  const state = session.getState();

  const response = chunker.wrapResponse(state, {
    step: 'Session state retrieved',
    progress: state.currentFile ? 'Active session' : 'No active session',
    nextStep: 'Use reset_session to clear state if needed'
  });

  return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
}
