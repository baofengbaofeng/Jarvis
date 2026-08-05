import { describe, it, expect } from 'vitest';
import { isWebSpeechAvailable, attachTranscriptListener, type SpeechRecognitionLike } from './speech';

describe('speech', () => {
  it('detects absence of Web Speech in node', () => {
    expect(isWebSpeechAvailable()).toBe(false);
  });

  it('forwards final transcript via listener', () => {
    const rec: SpeechRecognitionLike = {
      lang: 'zh-CN', interimResults: true, continuous: false,
      onresult: null, onend: null, onerror: null,
      start() {}, stop() {}
    };
    attachTranscriptListener(rec, (t) => captured.push(t));
    const captured: string[] = [];
    // attach 后再触发
    if (rec.onresult) rec.onresult({ results: [{ 0: { transcript: '你好' }, isFinal: true }] });
    expect(captured).toEqual(['你好']);
  });
});
