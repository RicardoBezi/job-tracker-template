// Flat deployment entrypoint. vercel.json rewrites every nested /api path here
// because bare filesystem functions do not consistently expand catch-all names.
export { default } from "./[...path].mjs";
