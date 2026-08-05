// mammoth ships no type declarations (plain JS package); declare the minimal
// surface the office.file.analyze docx extractor uses. Scoped to main — the
// renderer never imports mammoth.
declare module 'mammoth' {
  export function extractRawText(input: { path: string }): Promise<{ value: string }>;
}
