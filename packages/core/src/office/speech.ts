// Pure Web Speech API helpers for the office voice-input channel (D11).
// Renderer-safe (no node:* imports): the SpeechRecognition constructor only
// exists in browser/Electron-renderer globals, so this module only touches
// `window` inside isWebSpeechAvailable and never pulls Node deps. Whisper-local
// ASR is explicitly out of scope; this is the built-in browser engine path.
export interface SpeechRecognitionLike {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((ev: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  start(): void; stop(): void;
}

export function isWebSpeechAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function createSpeechRecognition(getCtor: () => new () => SpeechRecognitionLike, lang = 'zh-CN'): SpeechRecognitionLike {
  const rec = new (getCtor())();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  return rec;
}

export function attachTranscriptListener(rec: SpeechRecognitionLike, onFinal: (text: string) => void): void {
  rec.onresult = (ev) => {
    let text = '';
    for (let i = 0; i < ev.results.length; i++) text += ev.results[i][0].transcript;
    const last = ev.results[ev.results.length - 1];
    if (last && last.isFinal) onFinal(text.trim());
  };
}
