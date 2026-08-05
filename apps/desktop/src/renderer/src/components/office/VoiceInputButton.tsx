import { useRef, useState } from 'react';
// office/speech is a pure renderer-safe module, so import it from the
// renderer-safe entry (@jarvis/core/renderer) rather than the full barrel,
// which pulls Node deps. These are RUNTIME imports (not type-only) because the
// component calls isWebSpeechAvailable/createSpeechRecognition/attachTranscriptListener.
import { isWebSpeechAvailable, createSpeechRecognition, attachTranscriptListener, type SpeechRecognitionLike } from '@jarvis/core/renderer';

// Push-to-talk voice input (D11). No user-facing strings: the mic glyph is an
// emoji, so no i18n keys are needed here. Press-and-hold to record; releasing
// (or recognition ending) delivers the final transcript via onText. This is a
// chat-input helper — it is intentionally not mounted yet (see report).
export function VoiceInputButton({ onText }: { onText: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  const start = () => {
    // No Web Speech engine in this runtime (e.g. Electron < certain versions,
    // or a headless test): no-op so the button does nothing instead of throwing.
    if (!isWebSpeechAvailable()) return;
    const ctor = () => {
      const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
      return (w.SpeechRecognition ?? w.webkitSpeechRecognition)!;
    };
    const rec = createSpeechRecognition(ctor);
    attachTranscriptListener(rec, (t) => { if (t) onText(t); });
    rec.onend = () => setListening(false);
    // The browser fires onerror (not onend) when recognition fails (no mic
    // permission, aborted service, etc.); without this, `listening` would stick
    // true and the button would be stuck in the "recording" glyph.
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };
  const stop = () => { recRef.current?.stop(); setListening(false); };

  return (
    <button data-testid="voice-input" onMouseDown={start} onMouseUp={stop} className={listening ? 'is-listening' : ''}>
      {listening ? '●' : '🎙'}
    </button>
  );
}
