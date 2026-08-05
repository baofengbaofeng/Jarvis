export type OfficeFileKind = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'image' | 'other';

export function classifyFile(name: string): OfficeFileKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx' || ext === 'doc') return 'docx';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  if (ext === 'pptx' || ext === 'ppt') return 'pptx';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return 'image';
  return 'other';
}

export type Extractor = (file: { path: string; name: string }) => Promise<string>;

export async function extractFileText(
  file: { path: string; name: string },
  extractors: Partial<Record<OfficeFileKind, Extractor>>,
  deps: { unsupportedError?: () => Error } = {},
): Promise<string> {
  const kind = classifyFile(file.name);
  const fn = extractors[kind];
  if (!fn) throw deps.unsupportedError?.() ?? new Error(`unsupported file type: ${kind}`);
  return fn(file);
}

export function extractPptxText(xml: string): string {
  return (xml.match(/<a:t>([\s\S]*?)<\/a:t>/g) ?? []).map(t => t.replace(/<\/?a:t>/g, '')).join('\n');
}

export async function extractPptx(
  buffer: ArrayBuffer,
  unzip: (b: ArrayBuffer) => Promise<{ file(name: string): Promise<string | null> }>,
): Promise<string> {
  const zip = await unzip(buffer);
  const out: string[] = [];
  for (let i = 1; i <= 50; i++) {
    const xml = await zip.file(`ppt/slides/slide${i}.xml`);
    if (xml != null) out.push(extractPptxText(xml));
  }
  return out.join('\n');
}
