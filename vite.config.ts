import {defineConfig} from 'vite'

// Compila a /docs para que GitHub Pages lo publique directo desde la rama main.
// base './' para que funcione bajo /<repo>/
export default defineConfig({base: './', build: {outDir: 'docs', emptyOutDir: true}})
