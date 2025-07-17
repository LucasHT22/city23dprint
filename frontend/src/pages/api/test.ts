import type { APIRoute } from 'astro';

export const get: APIRoute = () => {
  return new Response('API funcionando!', { status: 200 });
};