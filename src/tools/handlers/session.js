export function repeatLast(ctx) {
  const { session, chunker } = ctx;

  const lastResponse = session.getLastResponse();
  if (!lastResponse) {
    const response = chunker.wrapResponse(
      { message: "No previous response in session" },
      {
        step: "Repeat failed",
        nextStep: "Make a request first, then use repeat_last",
      }
    );
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }
  return lastResponse;
}

export function getSessionState(ctx) {
  const { session, chunker } = ctx;

  const state = session.getState();
  const response = chunker.wrapResponse(state, {
    step: "Session state retrieved",
    progress: state.currentFile ? "Active session" : "No active session",
    nextStep: "Use reset_session to clear state if needed",
  });
  return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
}

export function resetSession(ctx) {
  const { session, chunker } = ctx;

  session.reset();
  const response = chunker.wrapResponse(
    { message: "Session state cleared" },
    {
      step: "Session reset",
      progress: "Complete",
      nextStep: "Start fresh with list_pages(file_key)",
    }
  );
  return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
}
