// Vercel Function entry: every /api/* request is rewritten here (see vercel.json).
import { waitUntil } from '@vercel/functions';
import { createApp } from '../server/app.js';
import { stayUpUntilConnectionsClose } from '../server/db/client.js';
import { getDeps } from '../server/deps.js';

const app = createApp(getDeps);
const handle = async (req: Request) => {
  try {
    return await app.fetch(req);
  } finally {
    stayUpUntilConnectionsClose(waitUntil);
  }
};

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
