// Image resizing runs on Vercel only: the local dev server and `vite preview` have no /_vercel/image.
export const RESIZE_IMAGES = import.meta.env.PROD && typeof location !== 'undefined' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
