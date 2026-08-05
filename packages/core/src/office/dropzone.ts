import { classifyFile, type OfficeFileKind } from './files';

export interface DropFile { name: string; path: string }
export interface DropDecision { attach: DropFile[]; copyToWorkspace: DropFile[] }

export function decideDrop(files: DropFile[], attachKinds: OfficeFileKind[] = ['image', 'pdf', 'docx', 'xlsx', 'pptx']): DropDecision {
  const attach: DropFile[] = [];
  const copyToWorkspace: DropFile[] = [];
  for (const f of files) {
    if (attachKinds.includes(classifyFile(f.name))) attach.push(f);
    else copyToWorkspace.push(f);
  }
  return { attach, copyToWorkspace };
}
