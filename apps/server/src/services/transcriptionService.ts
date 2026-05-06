export async function transcribeVideo(_videoId: string) {
  return {
    status: "completed" as const,
    transcriptText: "Transcript placeholder for videos without subtitles."
  };
}
