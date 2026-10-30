import type { Attachment } from 'discord.js';

import { CIV_SAVE, expectedExt, type CivEdition } from '../config/constants.js';
import { refuse } from '../ui/reply.js';
import { editionName } from './edition.js';

// The upload as Discord describes it: not empty, under the cap, and named as
// a save of the channel's edition.
export function validateSaveAttachment(attachment: Attachment, edition: CivEdition): void {
  if (attachment.size <= 0) refuse('Empty file. Please upload a valid save.');
  if (attachment.size > CIV_SAVE.MAX_BYTES) refuse('Your save file is too large. Please upload a file under 12MB.');
  const ext = expectedExt(edition);
  if (!(attachment.name ?? '').trim().toLowerCase().endsWith(ext)) {
    refuse(`Invalid file type. Please upload a ${editionName(edition)} save file ending in ${ext}.`);
  }
}

export async function downloadAttachment(url: string): Promise<Buffer> {
  const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Failed to download attachment: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
