// Upload routes reply 413 with Connection: close before reading the body; Windows then resets the still-writing client socket.
export async function tooLargeStatus(request: PromiseLike<{ status: number }>) {
  try { return (await request).status; }
  catch (e) { if (process.platform === "win32" && (e as { code?: string }).code === "ECONNRESET") return 413; throw e; }
}
