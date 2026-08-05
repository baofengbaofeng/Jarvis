// isImageUrl is a pure office module, so import it from the renderer-safe entry
// (@jarvis/core/renderer) rather than the full barrel, which pulls Node deps.
// This is a RUNTIME import (not type-only) — the component calls isImageUrl.
import { isImageUrl } from '@jarvis/core/renderer';

// Data-URL image preview with a remove button (L23). Renders nothing for
// non-image sources so a plain string message never shows a broken attachment.
// No user-facing strings (the × is a literal glyph), so no i18n keys are needed.
export function ImageAttachment({ src, onRemove }: { src: string; onRemove: (src: string) => void }) {
  if (!isImageUrl(src)) return null;
  return (
    <span data-testid="image-attachment" className="image-attachment">
      <img src={src} alt="attachment" width={120} />
      <button data-testid="image-attachment-remove" onClick={() => onRemove(src)}>×</button>
    </span>
  );
}
