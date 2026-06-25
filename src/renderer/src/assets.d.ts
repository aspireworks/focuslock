// Ambient types for static asset imports handled by Vite (e.g. import logo from './x.png').
// Kept import-free so it stays a global script and these wildcard module declarations apply.
declare module '*.png' {
  const src: string
  export default src
}

declare module '*.svg' {
  const src: string
  export default src
}
