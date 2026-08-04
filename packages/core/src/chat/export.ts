export function exportSessionMarkdown(messages: Array<{ role: string; content: string }>): string {
  return messages.map(m => `**${m.role}**\n\n${m.content}`).join('\n\n---\n\n');
}
