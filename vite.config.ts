import { paraglideVitePlugin } from '@inlang/paraglide-js'
import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
        plugins: [
                paraglideVitePlugin({
                        project: './project.inlang',
                        outdir: './src/paraglide',
                        strategy: ['cookie', 'baseLocale']
                }),
                tailwindcss(),
                sveltekit(),
                devtoolsJson()
        ],
        server: {
                host: '0.0.0.0',
                port: parseInt(process.env.PORT || '5000'),
                strictPort: true,
                allowedHosts: true,
                hmr: false
        },
        ssr: {
                noExternal: ['layerchart']
        }
});
